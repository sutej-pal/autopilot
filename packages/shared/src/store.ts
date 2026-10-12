import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { decryptJson, encryptJson, vaultKeyFromSecret } from "./vault.js";
import { parseWorkflow, type Workflow } from "./workflow.js";

type Disk = {
  workflows: Workflow[];
  runs: SavedRun[];
  vault: Record<string, string>;
};

export type SavedRun = {
  id: string;
  workflowId: string;
  status: string;
  outcome: string | null;
  error?: string;
  steps: unknown[];
  createdAt: string;
};

export class FileStore {
  constructor(
    private readonly file: string,
    private readonly key: Buffer,
  ) {
    mkdirSync(path.dirname(file), { recursive: true });
    if (!existsSync(file)) this.write({ workflows: [], runs: [], vault: {} });
  }

  list(): Workflow[] {
    return this.read().workflows;
  }

  get(id: string): Workflow | null {
    return this.read().workflows.find((workflow) => workflow.id === id) ?? null;
  }

  save(workflow: Workflow, secrets: Record<string, string>): void {
    const parsed = parseWorkflow(workflow);
    const disk = this.read();
    const index = disk.workflows.findIndex((item) => item.id === parsed.id);
    if (index >= 0) disk.workflows[index] = parsed;
    else disk.workflows.push(parsed);
    disk.vault[parsed.id] = encryptJson(this.key, secrets);
    this.write(disk);
  }

  secrets(workflowId: string): Record<string, string> {
    const payload = this.read().vault[workflowId];
    if (!payload) return {};
    return decryptJson<Record<string, string>>(this.key, payload);
  }

  saveRun(run: SavedRun): void {
    const disk = this.read();
    disk.runs.unshift(run);
    disk.runs = disk.runs.slice(0, 50);
    this.write(disk);
  }

  private read(): Disk {
    const disk = JSON.parse(readFileSync(this.file, "utf8")) as Disk;
    return { workflows: disk.workflows ?? [], runs: disk.runs ?? [], vault: disk.vault ?? {} };
  }

  private write(disk: Disk): void {
    writeFileSync(this.file, JSON.stringify(disk, null, 2));
  }
}

export function devVaultKey(): Buffer {
  const secret = process.env.LOCAL_VAULT_KEY || "dev-only-change-me";
  if (process.env.NODE_ENV === "production" && secret === "dev-only-change-me") {
    throw new Error("Refusing the built-in vault key when NODE_ENV=production");
  }
  return vaultKeyFromSecret(secret);
}
