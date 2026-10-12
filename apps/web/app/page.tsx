"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const api = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001";

type Workflow = {
  id: string;
  name: string;
  startUrl: string;
  stepCount: number;
};

type RunResult = {
  status: string;
  outcome: string | null;
  error?: string;
  steps: { stepId: string; status: string; error?: string }[];
};

export default function HomePage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const response = await fetch(`${api}/workflows`);
    if (!response.ok) throw new Error(`API ${response.status}`);
    setWorkflows(await response.json());
  }

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function run(id: string) {
    setResult(null);
    setError(null);
    const response = await fetch(`${api}/workflows/${id}/runs`, { method: "POST" });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "Run failed to start");
      return;
    }
    setResult(body);
    await load();
  }

  return (
    <main className="wrap">
      <div className="top">
        <div>
          <h1>AutoPilot</h1>
          <p className="muted">Local rehearsal on this computer. Nothing is sent to a cloud account.</p>
        </div>
        <Link href="/record">Record</Link>
      </div>
      {error ? <p>{error}</p> : null}
      {workflows.length === 0 ? <p className="muted">No saved workflows yet.</p> : null}
      {workflows.map((workflow) => (
        <article className="card" key={workflow.id}>
          <div className="row">
            <strong>{workflow.name}</strong>
            <span className="muted">{workflow.stepCount} steps</span>
            <button className="primary" onClick={() => run(workflow.id)}>Run now</button>
          </div>
          <div className="muted">{workflow.startUrl}</div>
        </article>
      ))}
      {result ? (
        <pre>
          {result.status} {result.outcome || ""}
          {result.error ? `\n${result.error}` : ""}
          {"\n"}
          {result.steps.map((step) => `${step.stepId} ${step.status}${step.error ? ` ${step.error}` : ""}`).join("\n")}
        </pre>
      ) : null}
    </main>
  );
}
