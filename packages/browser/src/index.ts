import { chromium } from "playwright";
import type { Workflow } from "@autopilot/shared";
import { replayWorkflow, type ReplayOptions, type ReplayResult } from "./replay.js";

export { RecordingSession } from "./record.js";
export type { CapturedDraft, ClientEvent } from "./record.js";
export { replayWorkflow } from "./replay.js";
export type { ReplayResult, StepResult, ReplayOptions } from "./replay.js";

export async function runWorkflow(workflow: Workflow, options: ReplayOptions = {}): Promise<ReplayResult> {
  const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    return await replayWorkflow(page, workflow, options);
  } finally {
    await browser.close();
  }
}
