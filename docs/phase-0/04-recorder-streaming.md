# Recorder streaming

## Recommendation

Use **CDP screencast** for the live view in Phase 1 and after. Do not run noVNC on the hosted platform.

Chromium stays headless. `Page.startScreencast` sends JPEG frames. The web UI paints them on a canvas and sends pointer, keyboard, wheel, paste, and resize events back. Playwright remains the control and capture API. A headed Xvfb display is a fallback only if a Phase 1 portal cannot be operated through CDP input, and that fallback is a decision to revisit, not the default image.

## Comparison

| | CDP screencast | noVNC (Xvfb + x11vnc + websockify) |
| --- | --- | --- |
| What the user sees | The page viewport | The whole X desktop, including browser chrome |
| Extra processes | None beyond Chromium | Xvfb, a window manager, x11vnc, websockify |
| Bandwidth | Tunable JPEG, target 5–8 fps at quality 50, max width 1280 | Raw or tight VNC, usually heavier |
| Input | CDP `Input.*` or Playwright mouse/keyboard | VNC pointer and keys, pixel-accurate |
| IME, drag-select, native dialogs | Weak. Composition and OS dialogs are the known gaps | Stronger, because the real widgets are on screen |
| File picker | Do not remote it. Flag `needs-file` | Still a bad idea to expose an OS dialog in a container |
| Attack surface | CDP over a private socket | VNC plus an X server. A second remote-desktop protocol to harden |
| Headless cost | No X server RAM | Extra memory on every session |
| Fit with capture | Same Playwright context that records steps | Capture still needs Playwright, so VNC is a second stack |

The product needs a faithful **step list**, not a remote desktop. CDP is the smaller system that still lets someone fill a form. The gaps (IME, rich drag-and-drop, native print or file dialogs) are flagged on the step when they happen, not papered over with VNC.

## Wire protocol

Browser connects to `wss://<host>/ws/sessions/<id>` with the session cookie. The API proxies to the recorder task.

Client to API:

- `input.mouse` — move, down, up, button, canvas coordinates
- `input.wheel` — deltas
- `input.key` — keydown/keyup for Enter, Tab, Escape, shortcuts
- `input.text` — composed text and paste
- `input.resize` — CSS pixel size of the canvas
- `control.pause` / `control.resume` / `control.stop`
- `control.addAssert` — next click captures an assertion instead of a click
- `control.markVariable` — next fill binds a named variable

API to client:

- Binary JPEG frame
- `step.captured` — the redacted step (no password bytes)
- `session.status`

Coordinates are converted using the screencast metadata (`deviceWidth`, `pageScaleFactor`) so a click on the canvas hits the viewport point Chromium expects.

Target frame rate is 8 fps while the pointer is moving, 2 fps when idle. This is a cost and latency knob, not a correctness requirement.

## Capture

Installed once per context:

- `context.addInitScript` installs listeners in every document the context creates, including documents created later.
- `page.exposeBinding` delivers events to Node.
- `context.on('page')` attaches the same binding on popups.
- `page.on('framenavigated')` records `goto` when the top frame URL changes.
- `page.on('dialog')` records accept or dismiss. Default recording action is to accept `alert`/`beforeunload` and to fail closed on `prompt` unless the user typed a value.
- `page.on('filechooser')` records `upload` with `needsFile: true` and does not set files during recording.

Events stored:

| User action | Step |
| --- | --- |
| Click, double-click | `click` or `dblclick` with locators and description |
| Typing that settles | `fill` with the final value, debounced about 400 ms |
| `<select>` | `select` |
| Checkbox, radio | `click` or `fill` with the checked state, whichever Playwright will replay more reliably; pick one in Phase 1 and test it |
| Enter, Tab, Escape | `press` |
| Top-frame navigation | `goto` |
| Element off-screen before click | `scrollIntoView: true` on that step, not a separate delay |

Scroll position itself is not recorded. Hover-only menus are a known gap: if a click fails replay because a menu never opened, the fix is an explicit hover step added in the editor, not a recorded delay.

### Locators captured for each element

Build all that apply, stored in fallback order:

1. `role` + accessible name
2. `label`
3. `placeholder`
4. visible text (only when the string is short and unique in the frame)
5. `data-testid`
6. `id`
7. `name`
8. CSS (a short stable path, not a full absolute path of nth-child indexes)
9. XPath as a last resort

Plus `framePath` and a human description such as `Click "Submit timesheet"`. The description is what the failure email quotes.

At replay, each locator gets a short timeout (design default 3 seconds, not yet tuned). The first that becomes visible and actionable wins. Index 0 is a normal pass. A later index is `healed`. If none match, the step fails.

### Templating at capture time

- `input[type=password]`: value goes to the vault. The step value is `{{credentials.password}}`. The side panel shows that token, never the characters.
- A field whose name, id, autocomplete, or label looks like a username or email: value becomes `{{credentials.username}}`, with undo on the step.
- A value equal to today's date in a few common formats (`YYYY-MM-DD`, `DD/MM/YYYY`, `MM/DD/YYYY`, `D MMM YYYY`): replaced with `{{today|FORMAT}}`, with undo.
- Custom date widgets (a popup grid of days, or a library root the recorder recognizes): keep the clicks, set `flags: ["date-widget"]`. Do not invent `pick-date` yet.

### Cross-origin frames and shadow DOM

Playwright applies init scripts to child frames, including out-of-process iframes, but this is a **documented intent, not a tested result**. Phase 1 must try a cross-origin iframe and a popup on a demo page before anyone claims it works. Shadow DOM is why role and label come first: Playwright's role locators pierce open shadow roots; CSS and XPath often do not.

Closed shadow roots and canvas-drawn UI will not yield locators. The step should record `flags: ["weak-locator"]` when only CSS or XPath exists, so the editor can warn.

## Screenshots and the live view

Password glyphs in Chromium are usually bullets, but a "show password" control, or a script that copies the value into the DOM, would put the secret on the canvas.

- Stored screenshots use Playwright's `mask` on `input[type=password]` and on any element marked secret.
- Traces are off for steps whose value is a credential template, because a trace records the filled string.
- The live screencast during the user's own recording is the user's typing. It is not written to S3 as a video in Phase 1. Run video, if enabled later, is masked the same way as screenshots and is a tenant artifact, never an email attachment.

## What Phase 1 must prove before a real portal

Record and replay against a public demo form first (a stable site we do not have to log into). Measure frame latency and whether healed locators work when the primary locator is edited to be wrong. Only then try the real timesheet portal. Do not report either result as working until that run has been executed.
