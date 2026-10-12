import { EventEmitter } from "node:events";
import type { CDPSession, Page } from "playwright";
import type { Browser } from "playwright";
import type { Workflow } from "@autopilot/shared";
import { launchChromium } from "./launch.js";
import { replayWorkflow, type ReplayOptions, type ReplayResult } from "./replay.js";

export type LiveRunResult = {
  status: ReplayResult["status"];
  outcome: ReplayResult["outcome"];
  error?: string;
};

export class LiveRun extends EventEmitter {
  readonly id = crypto.randomUUID();
  private started = false;
  private closed = false;
  private cdp: CDPSession | null = null;

  private constructor(
    private readonly browser: Browser,
    private readonly page: Page,
    private readonly workflow: Workflow,
    private readonly options: ReplayOptions,
  ) {
    super();
  }

  static async open(workflow: Workflow, options: ReplayOptions = {}): Promise<LiveRun> {
    const browser = await launchChromium(false);
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      const run = new LiveRun(browser, page, workflow, options);
      await run.startScreencast();
      return run;
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  play(): void {
    if (this.started || this.closed) return;
    this.started = true;
    void this.execute();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.browser.close().catch(() => undefined);
  }

  private async execute(): Promise<void> {
    try {
      const result = await replayWorkflow(this.page, this.workflow, {
        ...this.options,
        onStep: (step) => {
          this.emit("step", { id: step.id, description: step.description || step.type });
        },
      });
      this.emit("result", { status: result.status, outcome: result.outcome, error: result.error } satisfies LiveRunResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit("result", { status: "failed", outcome: null, error: message } satisfies LiveRunResult);
    } finally {
      setTimeout(() => void this.close(), 1500);
    }
  }

  private async startScreencast(): Promise<void> {
    this.cdp = await this.page.context().newCDPSession(this.page);
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
}
