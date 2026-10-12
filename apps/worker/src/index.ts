import { fileURLToPath } from "node:url";
import { FileStore, devVaultKey } from "@autopilot/shared";
import { runWorkflow } from "@autopilot/browser";

const workflowId = process.argv[2];
if (!workflowId) {
  console.error("Usage: pnpm --filter @autopilot/worker start <workflow-id>");
  process.exit(1);
}

const store = new FileStore(fileURLToPath(new URL("../../../.data/store.json", import.meta.url)), devVaultKey());
const workflow = store.get(workflowId);
if (!workflow) {
  console.error(`No workflow ${workflowId}`);
  process.exit(1);
}

const result = await runWorkflow(workflow, { credentials: store.secrets(workflow.id) });
console.log(JSON.stringify({ status: result.status, outcome: result.outcome, error: result.error, steps: result.steps }, null, 2));
process.exit(result.status === "succeeded" ? 0 : 1);
