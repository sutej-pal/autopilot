import { EventEmitter } from "node:events";
import type { CDPSession, Frame, Page } from "playwright";
import { chromium, type Browser, type BrowserContext } from "playwright";
import {
  credentialNameForField,
  templatizeValue,
  type Locator,
  type Step,
} from "@autopilot/shared";
import { CAPTURE_SCRIPT } from "./capture-script.js";

export type CapturedDraft = {
  startUrl: string;
  steps: Step[];
  secrets: Record<string, string>;
  variables: { name: string; type: "string"; default: string }[];
};

type RawEvent = {
  kind: "click" | "dblclick" | "fill" | "select";
  eid: string;
  locators: Locator[];
  description: string;
  flags?: string[];
  value?: string;
  fieldType?: string;
  fieldName?: string;
  fieldId?: string;
  label?: string;
  autocomplete?: string;
  text?: string;
};

export type ClientEvent =
  | { type: "input.mouse"; action: "move" | "down" | "up"; x: number; y: number; button?: "left" | "right" }
  | { type: "input.wheel"; x: number; y: number; dx: number; dy: number }
  | { type: "input.text"; text: string }
  | { type: "input.key"; key: string }
  | { type: "control"; action: "pause" | "resume" | "arm-assert" | "mark-variable"; name?: string };

export class RecordingSession extends EventEmitter {
  readonly id = crypto.randomUUID();
  private steps: Step[] = [];
  private secrets: Record<string, string> = {};
  private variables: CapturedDraft["variables"] = [];
  private paused = false;
  private armAssert = false;
  private cdp: CDPSession | null = null;
  private page: Page | null = null;
  private closed = false;

  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly startUrl: string,
    private readonly now: Date,
    private readonly timezone: string,
  ) {
    super();
  }

  static async open(options: {
    startUrl: string;
    screencast?: boolean;
    now?: Date;
    timezone?: string;
  }): Promise<RecordingSession> {
    const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
    try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const session = new RecordingSession(
      browser,
      context,
      options.startUrl,
      options.now ?? new Date(),
      options.timezone ?? "Asia/Kolkata",
    );
    await context.exposeBinding("__autopilotRecord", async (source, payload: RawEvent) => {
      session.ingest(payload, source.frame);
    });
    await context.addInitScript(CAPTURE_SCRIPT);
    const page = await context.newPage();
    session.page = page;
    page.on("dialog", async (dialog) => {
      session.pushStep({
        id: session.nextId(),
        type: "dialog",
        description: `Dialog: ${dialog.message().slice(0, 80)}`,
        framePath: [],
        locators: [],
        value: dialog.message(),
      });
      await dialog.accept();
    });
    page.on("filechooser", async (chooser) => {
      session.pushStep({
        id: session.nextId(),
        type: "upload",
        description: "File upload needs a file",
        framePath: [],
        locators: [],
        needsFile: true,
        flags: ["needs-file"],
      });
      await chooser.setFiles({ name: "unset.txt", mimeType: "text/plain", buffer: Buffer.from("") });
    });
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      const url = frame.url();
      if (!url || url === "about:blank") return;
      const last = session.steps[session.steps.length - 1];
      if (last?.type === "goto" && last.url === url) return;
      session.pushStep({
        id: session.nextId(),
        type: "goto",
        description: `Go to ${url}`,
        url,
        framePath: [],
        locators: [],
      });
    });
    if (options.screencast !== false) await session.startScreencast(page);
    await page.goto(options.startUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    return session;
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  get activePage(): Page {
    if (!this.page) throw new Error("Recording page is not open");
    return this.page;
  }

  snapshot(): CapturedDraft {
    return {
      startUrl: this.startUrl,
      steps: this.steps.map((step) => ({ ...step })),
      secrets: { ...this.secrets },
      variables: this.variables.map((variable) => ({ ...variable })),
    };
  }

  async handleInput(event: ClientEvent): Promise<void> {
    if (this.closed) return;
    if (event.type === "control") {
      if (event.action === "pause") this.paused = true;
      if (event.action === "resume") this.paused = false;
      if (event.action === "arm-assert") this.armAssert = true;
      if (event.action === "mark-variable") this.markLastFill(event.name || "hours");
      this.emit("steps", this.snapshot().steps);
      return;
    }
    if (this.paused || !this.cdp) return;
    if (event.type === "input.mouse") {
      const type = event.action === "move" ? "mouseMoved" : event.action === "down" ? "mousePressed" : "mouseReleased";
      await this.cdp.send("Input.dispatchMouseEvent", {
        type,
        x: event.x,
        y: event.y,
        button: event.button === "right" ? "right" : "left",
        clickCount: 1,
      });
      return;
    }
    if (event.type === "input.wheel") {
      await this.cdp.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: event.x,
        y: event.y,
        deltaX: event.dx,
        deltaY: event.dy,
      });
      return;
    }
    if (event.type === "input.text") {
      await this.cdp.send("Input.insertText", { text: event.text });
      return;
    }
    const code = KEY_CODES[event.key] ?? 0;
    await this.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: event.key, code: event.key, windowsVirtualKeyCode: code });
    await this.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: event.key, code: event.key, windowsVirtualKeyCode: code });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.browser.close();
  }

  private async startScreencast(page: Page): Promise<void> {
    this.cdp = await this.context.newCDPSession(page);
    this.cdp.on("Page.screencastFrame", (event) => {
      const frame = event as { data: string; sessionId: number; metadata: { deviceWidth: number; deviceHeight: number } };
      this.emit("frame", Buffer.from(frame.data, "base64"));
      this.emit("meta", { width: frame.metadata.deviceWidth, height: frame.metadata.deviceHeight });
      void this.cdp?.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
    });
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 55,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 1,
    });
  }

  private ingest(payload: RawEvent, frame: Frame): void {
    if (this.paused || this.closed) return;
    const framePath = frame === this.page?.mainFrame() || !frame.name() ? [] : [frame.name()];
    if (frame !== this.page?.mainFrame() && frame.name()) framePath.splice(0, framePath.length, frame.name());

    if (payload.kind === "fill" || payload.kind === "select") {
      let value = payload.value ?? "";
      const credential = credentialNameForField({
        type: payload.fieldType,
        name: payload.fieldName,
        id: payload.fieldId,
        label: payload.label,
        autocomplete: payload.autocomplete,
      });
      if (credential && value) {
        this.secrets[credential] = value;
        value = `{{credentials.${credential}}}`;
      } else {
        value = templatizeValue(value, this.now, this.timezone);
      }
      const step: Step = {
        id: this.nextId(),
        type: payload.kind,
        description: payload.description,
        framePath,
        locators: payload.locators,
        value,
      };
      const previous = [...this.steps].reverse().find((item) => item.type === payload.kind && item.description === payload.description);
      if (previous && previous.type === payload.kind) {
        previous.value = value;
        previous.locators = payload.locators;
        this.emit("steps", this.snapshot().steps);
        return;
      }
      this.pushStep(step);
      return;
    }

    if (payload.kind === "click" && this.armAssert) {
      this.armAssert = false;
      this.pushStep({
        id: this.nextId(),
        type: "assert",
        description: payload.text ? `Assert "${payload.text}"` : payload.description,
        framePath,
        locators: payload.locators,
        expect: payload.text ? { textContains: payload.text } : { visible: true },
      });
      return;
    }

    const step: Step = {
      id: this.nextId(),
      type: payload.kind,
      description: payload.description,
      framePath,
      locators: payload.locators,
      flags: payload.flags,
      scrollIntoView: payload.flags?.includes("scroll") || false,
    };
    this.pushStep(step);
  }

  private markLastFill(name: string): void {
    const fill = [...this.steps].reverse().find((step) => step.type === "fill" && step.value && !step.value.startsWith("{{"));
    if (!fill) return;
    const current = fill.value || "";
    fill.value = `{{${name}}}`;
    if (!this.variables.some((variable) => variable.name === name)) {
      this.variables.push({ name, type: "string", default: current });
    }
  }

  private pushStep(step: Step): void {
    this.steps.push(step);
    this.emit("steps", this.snapshot().steps);
  }

  private nextId(): string {
    return `s${this.steps.length + 1}`;
  }
}

const KEY_CODES: Record<string, number> = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8 };
