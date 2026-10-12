import assert from "node:assert/strict";
import test from "node:test";
import { LOCAL_TENANT_ID, formatDate, parseWorkflow, type Workflow } from "@autopilot/shared";
import { RecordingSession, replayWorkflow, runWorkflow } from "../src/index.js";
import { startFixture } from "./fixture-server.js";

const now = new Date("2026-10-12T12:30:00.000Z");
const timezone = "Asia/Kolkata";

test("record then replay a timesheet, keep the password out of the workflow, and heal a broken locator", { timeout: 60_000 }, async () => {
  const fixture = await startFixture();
  const recording = await RecordingSession.open({
    startUrl: fixture.url,
    screencast: false,
    now,
    timezone,
  });
  try {
    const page = recording.activePage;
    await page.getByLabel("Email").fill("user@example.com");
    await page.getByLabel("Password").fill("s3cret-password");
    await page.getByLabel("Day").fill(formatDate(now, timezone, "YYYY-MM-DD"));
    await page.getByLabel("Hours").fill("8");
    await page.getByRole("button", { name: "Submit timesheet" }).click();
    await page.getByText("Timesheet submitted").waitFor();
    await recording.handleInput({ type: "control", action: "arm-assert" });
    await page.getByText("Timesheet submitted").click();

    const draft = recording.snapshot();
    const serialized = JSON.stringify(draft.steps);
    assert.equal(serialized.includes("s3cret-password"), false);
    assert.equal(serialized.includes("user@example.com"), false);
    const day = draft.steps.find((step) => step.type === "fill" && step.description?.includes("Day"));
    assert.equal(day?.value, "{{today|YYYY-MM-DD}}");
    const submit = draft.steps.find((step) => step.description === 'Click "Submit timesheet"');
    assert.ok(submit);
    assert.ok(submit.locators.length >= 2);
    assert.equal(submit.locators[0]?.strategy, "role");
    submit.locators[0] = { strategy: "role", role: "button", name: "Missing submit button" };
    submit.commit = true;

    const workflow: Workflow = parseWorkflow({
      id: "00000000-0000-4000-8000-0000000000aa",
      tenantId: LOCAL_TENANT_ID,
      name: "Fixture timesheet",
      startUrl: fixture.url,
      timezone,
      variables: draft.variables,
      steps: draft.steps,
    });

    const replay = await runWorkflow(workflow, { now, credentials: draft.secrets });
    assert.equal(replay.status, "succeeded", replay.error);
    assert.equal(replay.outcome, "verified");
    assert.equal(replay.steps.some((step) => step.status === "healed"), true);
  } finally {
    await recording.close();
    await fixture.close();
  }
});

test("a second create is not submitted when today's entry already exists", { timeout: 60_000 }, async () => {
  const fixture = await startFixture();
  const browser = await import("playwright").then((playwright) =>
    playwright.chromium.launch({ headless: true }),
  );
  try {
    const page = await (await browser.newContext()).newPage();
    const workflow: Workflow = parseWorkflow({
      id: "00000000-0000-4000-8000-0000000000bb",
      tenantId: LOCAL_TENANT_ID,
      name: "Guard",
      startUrl: `${fixture.url}?existing=1`,
      timezone,
      variables: [],
      steps: [
        {
          id: "s1",
          type: "goto",
          url: `${fixture.url}?existing=1`,
          framePath: [],
          locators: [],
        },
        {
          id: "s2",
          type: "guard",
          description: "Today's entry is absent",
          framePath: [],
          locators: [],
          expect: { textAbsent: "Hours today:" },
          onFail: "already-done",
        },
        {
          id: "s3",
          type: "click",
          description: 'Click "Submit timesheet"',
          commit: true,
          framePath: [],
          locators: [{ strategy: "id", value: "submit" }],
        },
      ],
    });
    const result = await replayWorkflow(page, workflow, { now, locatorTimeoutMs: 1000 });
    assert.equal(result.status, "succeeded", result.error);
    assert.equal(result.outcome, "already-satisfied");
    assert.equal(result.commitReached, false);
    assert.equal(await page.locator("#existing").innerText(), "Hours today: 8");
    assert.equal(await page.locator("#result").isVisible(), false);
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("datepicker clicks are flagged and an iframe click keeps its frame", { timeout: 60_000 }, async () => {
  const fixture = await startFixture();
  const recording = await RecordingSession.open({ startUrl: fixture.url, screencast: false, now, timezone });
  try {
    const page = recording.activePage;
    await page.getByRole("button", { name: "Open calendar" }).click();
    await page.locator("#day-btn").click();
    await page.frameLocator('iframe[name="inner"]').getByRole("button", { name: "Inside frame" }).click();
    const draft = recording.snapshot();
    const day = draft.steps.find((step) => step.description === 'Click "12"');
    assert.ok(day?.flags?.includes("date-widget"));
    const inner = draft.steps.find((step) => step.description === 'Click "Inside frame"');
    assert.deepEqual(inner?.framePath, ["inner"]);
  } finally {
    await recording.close();
    await fixture.close();
  }
});

test("screencast emits a jpeg frame", { timeout: 60_000 }, async () => {
  const fixture = await startFixture();
  const recording = await RecordingSession.open({ startUrl: fixture.url, screencast: true, now, timezone });
  try {
    const frame = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("No screencast frame arrived")), 15000);
      recording.once("frame", (buffer: Buffer) => {
        clearTimeout(timer);
        resolve(buffer);
      });
    });
    assert.ok(frame.length > 100);
    assert.equal(frame[0], 0xff);
    assert.equal(frame[1], 0xd8);
  } finally {
    await recording.close();
    await fixture.close();
  }
});
