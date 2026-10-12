import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readFileSync } from "node:fs";
import { FileStore } from "../src/store.js";
import { decryptJson, encryptJson, vaultKeyFromSecret } from "../src/vault.js";
import { LOCAL_TENANT_ID, type Workflow } from "../src/workflow.js";

test("vault round-trips and the workflow file does not contain the password", () => {
  const key = vaultKeyFromSecret("test-key");
  const encrypted = encryptJson(key, { password: "s3cret-password" });
  assert.equal(encrypted.includes("s3cret-password"), false);
  assert.deepEqual(decryptJson(key, encrypted), { password: "s3cret-password" });

  const dir = mkdtempSync(path.join(tmpdir(), "autopilot-"));
  const file = path.join(dir, "store.json");
  const store = new FileStore(file, key);
  const workflow: Workflow = {
    id: "00000000-0000-4000-8000-0000000000aa",
    tenantId: LOCAL_TENANT_ID,
    name: "Daily timesheet",
    startUrl: "http://127.0.0.1/timesheet",
    timezone: "Asia/Kolkata",
    variables: [{ name: "hours", type: "string", default: "8" }],
    steps: [
      {
        id: "s1",
        type: "fill",
        description: "Fill password",
        framePath: [],
        locators: [],
        value: "{{credentials.password}}",
      },
    ],
  };
  store.save(workflow, { password: "s3cret-password" });
  const raw = readFileSync(file, "utf8");
  assert.equal(raw.includes("s3cret-password"), false);
  assert.equal(store.secrets(workflow.id).password, "s3cret-password");
  assert.equal(store.get(workflow.id)?.steps[0]?.value, "{{credentials.password}}");
  assert.equal(store.rename(workflow.id, "Morning timesheet")?.name, "Morning timesheet");
  assert.equal(store.remove(workflow.id), true);
  assert.equal(store.get(workflow.id), null);
  assert.deepEqual(store.secrets(workflow.id), {});
});
