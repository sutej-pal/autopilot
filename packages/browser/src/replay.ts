import type { Page } from "playwright";
import {
  renderTemplate,
  type RenderContext,
  type Step,
  type Workflow,
} from "@autopilot/shared";
import { scopeFor, toLocator } from "./locators.js";

export type StepResult = {
  stepId: string;
  status: "passed" | "healed" | "failed" | "skipped";
  locatorIndex: number | null;
  error?: string;
};

export type ReplayResult = {
  status: "succeeded" | "failed";
  outcome: "verified" | "already-satisfied" | null;
  commitReached: boolean;
  steps: StepResult[];
  error?: string;
};

export type ReplayOptions = {
  now?: Date;
  locatorTimeoutMs?: number;
  credentials?: Record<string, string>;
  variables?: Record<string, string>;
  onStep?: (step: Step) => void;
  headed?: boolean;
  url?: string;
};

type Resolved = { index: number };

export async function replayWorkflow(page: Page, workflow: Workflow, options: ReplayOptions = {}): Promise<ReplayResult> {
  const ctx: RenderContext = {
    now: options.now ?? new Date(),
    timezone: workflow.timezone,
    credentials: options.credentials ?? {},
    variables: Object.fromEntries(workflow.variables.map((variable) => [variable.name, variable.default])),
  };
  Object.assign(ctx.variables, options.variables ?? {});
  const timeout = options.locatorTimeoutMs ?? 3000;
  const results: StepResult[] = [];
  let commitReached = false;
  let outcome: ReplayResult["outcome"] = "verified";

  page.on("dialog", (dialog) => {
    void dialog.accept();
  });

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i]!;
    options.onStep?.(step);
    if (step.commit) commitReached = true;
    try {
      if (step.type === "guard") {
        const ok = await checkExpect(page, step, ctx, timeout);
        if (!ok && step.onFail === "already-done") {
          results.push({ stepId: step.id, status: "passed", locatorIndex: null });
          for (const rest of workflow.steps.slice(i + 1)) {
            results.push({ stepId: rest.id, status: "skipped", locatorIndex: null });
          }
          outcome = "already-satisfied";
          break;
        }
        if (!ok) throw new Error(step.description || "Guard failed");
        results.push({ stepId: step.id, status: "passed", locatorIndex: null });
        continue;
      }
      if (step.type === "upload" || step.needsFile) {
        throw new Error("This step needs a file before the workflow can run");
      }
      const resolved = await runStep(page, step, ctx, timeout);
      results.push({
        stepId: step.id,
        status: resolved && resolved.index > 0 ? "healed" : "passed",
        locatorIndex: resolved ? resolved.index : null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ stepId: step.id, status: "failed", locatorIndex: null, error: message });
      for (const rest of workflow.steps.slice(i + 1)) {
        results.push({ stepId: rest.id, status: "skipped", locatorIndex: null });
      }
      return {
        status: "failed",
        outcome: null,
        commitReached,
        steps: results,
        error: `${step.description || step.type}: ${message}`,
      };
    }
  }

  return { status: "succeeded", outcome, commitReached, steps: results };
}

async function runStep(page: Page, step: Step, ctx: RenderContext, timeout: number): Promise<Resolved | null> {
  if (step.type === "goto") {
    const url = renderTemplate(step.url || "", ctx);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    return null;
  }
  if (step.type === "dialog") return null;
  if (step.type === "assert") {
    const ok = await checkExpect(page, step, ctx, timeout);
    if (!ok) throw new Error(step.description || "Assertion failed");
    return null;
  }

  const resolved = await firstLocator(page, step, timeout);
  const target = resolved.locator;
  if (step.scrollIntoView || step.flags?.includes("scroll")) await target.scrollIntoViewIfNeeded();
  if (step.type === "click") await target.click({ timeout });
  else if (step.type === "dblclick") await target.dblclick({ timeout });
  else if (step.type === "fill") await target.fill(renderTemplate(step.value || "", ctx), { timeout });
  else if (step.type === "select") await target.selectOption(renderTemplate(step.value || "", ctx), { timeout });
  else if (step.type === "press") await target.press(step.key || step.value || "Enter");
  else throw new Error(`Unsupported step type: ${step.type}`);
  return { index: resolved.index };
}

async function firstLocator(page: Page, step: Step, timeout: number): Promise<{ locator: ReturnType<typeof toLocator>; index: number }> {
  const scope = scopeFor(page, step.framePath);
  if (step.locators.length === 0) throw new Error(`No locators for ${step.description || step.id}`);
  let lastError = "no locator matched";
  for (let index = 0; index < step.locators.length; index++) {
    const locator = toLocator(scope, step.locators[index]!);
    try {
      await locator.waitFor({ state: "visible", timeout });
      return { locator, index };
    } catch (error) {
      lastError = error instanceof Error ? error.message.split("\n")[0]! : String(error);
    }
  }
  throw new Error(lastError);
}

async function checkExpect(page: Page, step: Step, ctx: RenderContext, timeout: number): Promise<boolean> {
  const expect = step.expect;
  if (!expect) throw new Error("Missing expect");
  if (expect.textAbsent) {
    const text = renderTemplate(expect.textAbsent, ctx);
    try {
      await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: Math.min(timeout, 1500) });
      return false;
    } catch {
      return true;
    }
  }
  if (expect.textContains) {
    const text = renderTemplate(expect.textContains, ctx);
    const scope = step.locators.length > 0 ? (await firstLocator(page, step, timeout)).locator : page.getByText(text, { exact: false }).first();
    try {
      await scope.waitFor({ state: "visible", timeout });
      const body = await scope.innerText();
      return body.includes(text);
    } catch {
      return false;
    }
  }
  if (expect.visible) {
    const resolved = await firstLocator(page, step, timeout);
    return resolved.locator.isVisible();
  }
  return false;
}
