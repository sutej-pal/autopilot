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

type RunView = {
  status: string;
  error?: string;
};

export default function HomePage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [watching, setWatching] = useState(false);
  const [runView, setRunView] = useState<RunView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  async function load() {
    const response = await fetch(`${api}/workflows`);
    if (!response.ok) throw new Error(`API ${response.status}`);
    const body = (await response.json()) as Workflow[];
    setWorkflows(body);
    setNames(Object.fromEntries(body.map((workflow) => [workflow.id, workflow.name])));
  }

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function rename(id: string) {
    const name = names[id]?.trim();
    if (!name) {
      setError("Name is required");
      return;
    }
    setError(null);
    const response = await fetch(`${api}/workflows/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "Rename failed");
      return;
    }
    await load();
  }

  async function remove(workflow: Workflow) {
    setError(null);
    const response = await fetch(`${api}/workflows/${workflow.id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error || "Delete failed");
      return;
    }
    setPendingDeleteId(null);
    await load();
  }

  async function run(id: string) {
    setError(null);
    setRunView({ status: "A browser window is opening. The macro runs there." });
    setWatching(true);
    const response = await fetch(`${api}/workflows/${id}/runs`, { method: "POST" });
    const body = await response.json();
    setWatching(false);
    if (!response.ok) {
      setError(body.error || "Run failed to start");
      return;
    }
    setRunView({ status: body.status === "succeeded" ? "Macro finished." : "Macro failed.", error: body.error });
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
      {runView ? (
        <p>
          <strong>{runView.status}</strong>
          {runView.error ? ` ${runView.error}` : ""}
        </p>
      ) : null}
      <p className="muted">{workflows.length === 0 ? "No saved workflows yet." : `${workflows.length} workflows, newest first.`}</p>
      <div className="workflow-list">
      {workflows.map((workflow) => (
        <article className="card" key={workflow.id}>
          <div className="row">
            <input
              aria-label={`Name for ${workflow.name}`}
              value={names[workflow.id] ?? workflow.name}
              onChange={(event) => setNames((current) => ({ ...current, [workflow.id]: event.target.value }))}
            />
            <button onClick={() => rename(workflow.id)}>Rename</button>
            <span className="muted">{workflow.stepCount} steps</span>
            <button className="primary" onClick={() => run(workflow.id)} disabled={watching}>Run now</button>
            {pendingDeleteId === workflow.id ? (
              <>
                <button onClick={() => remove(workflow)}>Confirm delete</button>
                <button onClick={() => setPendingDeleteId(null)}>Cancel</button>
              </>
            ) : (
              <button onClick={() => setPendingDeleteId(workflow.id)}>Delete</button>
            )}
          </div>
          <div className="muted">{workflow.startUrl}</div>
        </article>
      ))}
      </div>
    </main>
  );
}
