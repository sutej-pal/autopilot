import type { Workflow } from "@autopilot/shared";
import { launchChromium } from "./launch.js";
import { replayWorkflow, type ReplayOptions, type ReplayResult } from "./replay.js";

export { RecordingSession } from "./record.js";
export type { CapturedDraft, ClientEvent } from "./record.js";
export { replayWorkflow } from "./replay.js";
export type { ReplayResult, StepResult, ReplayOptions } from "./replay.js";

export { LiveRun } from "./live-run.js";
export type { LiveRunResult } from "./live-run.js";

export async function runWorkflow(workflow: Workflow, options: ReplayOptions = {}): Promise<ReplayResult> {
  const headed = options.headed === true && process.env.RENDER !== "true";
  const browser = await launchChromium(headed);
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const steps = options.url
      ? workflow.steps.map((step, index) => (index === 0 && step.type === "goto" ? { ...step, url: options.url } : step))
      : workflow.steps;
    const result = await replayWorkflow(page, { ...workflow, startUrl: options.url || workflow.startUrl, steps }, options);
    if (headed && !page.isClosed()) await page.waitForTimeout(4000).catch(() => undefined);
    return result;
  } finally {
    await browser.close();
  }
}
