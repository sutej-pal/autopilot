import { fileURLToPath } from "node:url";
import { FileStore, devVaultKey, type Workflow } from "@autopilot/shared";
import { runWorkflow } from "@autopilot/browser";

const store = new FileStore(fileURLToPath(new URL("../../../.data/store.json", import.meta.url)), devVaultKey());
const arg = process.argv[2];
const workflows = store.list();

function pick(workflows: Workflow[], arg: string | undefined): { workflow: Workflow; url?: string } | null {
  if (workflows.length === 0) return null;
  if (!arg) {
    if (workflows.length === 1) return { workflow: workflows[0]! };
    return null;
  }
  if (/^https?:\/\//.test(arg)) {
    const workflow = workflows[0];
    if (!workflow || workflows.length !== 1) return null;
    return { workflow, url: arg };
  }
  const workflow = workflows.find((item) => item.id === arg || item.name.toLowerCase() === arg.toLowerCase());
  return workflow ? { workflow } : null;
}

const chosen = pick(workflows, arg);
if (!chosen) {
  console.error("Usage: pnpm macro");
  console.error("       pnpm macro -- <workflow name or id>");
  console.error("       pnpm macro -- https://example.com");
  if (workflows.length === 0) console.error("No saved macros.");
  else console.error(workflows.map((workflow) => `${workflow.name}  ${workflow.id}  ${workflow.startUrl}`).join("\n"));
  process.exit(1);
}

console.log(`Opening ${chosen.url || chosen.workflow.startUrl}`);
console.log(`Running macro "${chosen.workflow.name}"`);
const result = await runWorkflow(chosen.workflow, {
  credentials: store.secrets(chosen.workflow.id),
  headed: true,
  url: chosen.url,
  onStep: (step) => console.log(step.description || step.type),
});
console.log(result.status === "succeeded" ? "Macro finished." : `Macro failed: ${result.error}`);
process.exit(result.status === "succeeded" ? 0 : 1);
