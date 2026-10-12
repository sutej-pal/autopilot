# Phase 1 — local recorder and replayer

This runs on your machine. No cloud account is used. Server deployment is deferred.

## Run it

From the repo root, once:

```powershell
pnpm install
pnpm --filter @autopilot/browser exec playwright install chromium
```

Then:

```powershell
pnpm dev
```

Open http://127.0.0.1:3000 . Record starts a Chromium process on this PC and streams it into the page. Stop and save writes the workflow under `.data/store.json`. The password and email values are encrypted in that file. The workflow steps store `{{credentials.username}}` and `{{credentials.password}}`, not the typed text.

`pnpm dev` listens on 127.0.0.1:3001 (API) and localhost:3000 (web). There is no login. Do not expose those ports.

## Tests

```powershell
pnpm test
```

## What was actually run on 2026-10-12

Passed on this machine:

- Record a local timesheet fixture, replay it, and mark a step healed when the first locator is wrong.
- A second create does not click submit when the page already shows today's hours. The total stays 8, not 16.
- A datepicker click is flagged `date-widget`. An iframe click keeps the frame name.
- A screencast frame arrives as a JPEG.
- Public site: https://www.saucedemo.com/ was recorded and replayed. The workflow JSON does not contain `secret_sauce`.
- In the browser: Record showed the fixture, a click and a typed character became steps, the email step was saved as `{{credentials.username}}`, and Run now finished `succeeded verified`.

Not run, and not claimed:

- The real timesheet portal. The URL is still unknown, and its datepicker will not pick "today" correctly until a later phase.
- https://the-internet.herokuapp.com/login timed out from this network. It was replaced with Sauce Demo for the public check.
- Schedules, failure email, Postgres, Redis, and Docker. The API runs the replay in this process.

## Limits you will notice

The remote page is a 1280×800 viewport, so a short form sits at the top of a large canvas. Password fields are masked in the step list by replacing the value with a credential token. The live picture can still show what you type, because it is your own session.
