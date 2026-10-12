import assert from "node:assert/strict";
import test from "node:test";
import { LOCAL_TENANT_ID, parseWorkflow, type Workflow } from "@autopilot/shared";
import { RecordingSession, runWorkflow } from "../src/index.js";

const now = new Date("2026-10-12T12:30:00.000Z");

test("public demo: record a login and replay it without the password in the workflow", { timeout: 90_000 }, async () => {
  const startUrl = "https://www.saucedemo.com/";
  const recording = await RecordingSession.open({
    startUrl,
    screencast: false,
    now,
    timezone: "Asia/Kolkata",
  });
  try {
    const page = recording.activePage;
    await page.locator("#user-name").fill("standard_user");
    await page.locator("#password").fill("secret_sauce");
    await page.locator("#login-button").click();
    await page.getByText("Products", { exact: true }).waitFor({ timeout: 20000 });
    await recording.handleInput({ type: "control", action: "arm-assert" });
    await page.getByText("Products", { exact: true }).click();
    const draft = recording.snapshot();
    const serialized = JSON.stringify(draft.steps);
    assert.equal(serialized.includes("secret_sauce"), false);
    assert.equal(draft.secrets.password, "secret_sauce");

    const workflow: Workflow = parseWorkflow({
      id: "00000000-0000-4000-8000-0000000000cc",
      tenantId: LOCAL_TENANT_ID,
      name: "Public login demo",
      startUrl,
      timezone: "Asia/Kolkata",
      variables: [],
      steps: draft.steps,
    });
    const replay = await runWorkflow(workflow, { now, credentials: draft.secrets });
    assert.equal(replay.status, "succeeded", replay.error);
    assert.equal(replay.outcome, "verified");
  } finally {
    await recording.close();
  }
});
