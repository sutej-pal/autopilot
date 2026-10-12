"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiBase, apiFetch, apiSocket } from "../../lib/api";
import { TokenForm } from "../token-form";

type Step = { id: string; type: string; description?: string; value?: string; flags?: string[] };

export default function RecordPage() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const metaRef = useRef({ width: 1280, height: 800 });
  const [startUrl, setStartUrl] = useState("");
  const [locked, setLocked] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [name, setName] = useState("Daily timesheet");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStartUrl(`${apiBase()}/fixture/timesheet.html`);
  }, []);
  useEffect(() => () => socketRef.current?.close(), []);

  async function start() {
    setError(null);
    setBusy(true);
    try {
      const response = await apiFetch("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startUrl }),
      });
      const body = await response.json();
      if (response.status === 401) {
        setLocked(true);
        return;
      }
      if (!response.ok) throw new Error(body.error || "Could not start the recorder");
      setSessionId(body.id);
      const socket = new WebSocket(apiSocket(`/sessions/${body.id}/stream`));
      socket.binaryType = "arraybuffer";
      socket.onmessage = (event) => {
        if (typeof event.data === "string") {
          const message = JSON.parse(event.data) as { type: string; steps?: Step[]; width?: number; height?: number };
          if (message.type === "steps" && message.steps) setSteps(message.steps);
          if (message.type === "meta" && message.width && message.height) metaRef.current = { width: message.width, height: message.height };
          return;
        }
        const blob = new Blob([event.data], { type: "image/jpeg" });
        const image = new Image();
        const objectUrl = URL.createObjectURL(blob);
        image.onload = () => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          canvas.getContext("2d")?.drawImage(image, 0, 0);
          URL.revokeObjectURL(objectUrl);
        };
        image.src = objectUrl;
      };
      socketRef.current = socket;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function send(payload: unknown) {
    socketRef.current?.send(JSON.stringify(payload));
  }

  function point(event: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * metaRef.current.width,
      y: ((event.clientY - rect.top) / rect.height) * metaRef.current.height,
    };
  }

  async function save() {
    if (!sessionId) return;
    setBusy(true);
    try {
      const response = await apiFetch(`/sessions/${sessionId}/stop`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Save failed");
      socketRef.current?.close();
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wrap">
      <div className="top">
        <div>
          <h1>Record</h1>
          <p className="muted">Password fields are stored as a credential token, not as text in the workflow.</p>
        </div>
        <Link href="/">Workflows</Link>
      </div>
      <div className="row">
        <input className="url" value={startUrl} onChange={(event) => setStartUrl(event.target.value)} disabled={Boolean(sessionId)} />
        <button className="primary" onClick={start} disabled={busy || Boolean(sessionId)}>Record</button>
        <button onClick={() => send({ type: "control", action: "pause" })} disabled={!sessionId}>Pause</button>
        <button onClick={() => send({ type: "control", action: "resume" })} disabled={!sessionId}>Resume</button>
        <button onClick={() => send({ type: "control", action: "arm-assert" })} disabled={!sessionId}>Add success check</button>
        <button onClick={() => send({ type: "control", action: "mark-variable", name: "hours" })} disabled={!sessionId}>Mark last fill as hours</button>
      </div>
      {locked ? <TokenForm onUnlocked={() => setLocked(false)} /> : null}
      {error ? <p>{error}</p> : null}
      <div className="layout">
        <div className="stage">
          <canvas
            ref={canvasRef}
            tabIndex={0}
            width={1280}
            height={800}
            onMouseMove={(event) => send({ type: "input.mouse", action: "move", ...point(event) })}
            onMouseDown={(event) => {
              canvasRef.current?.focus();
              send({ type: "input.mouse", action: "down", ...point(event) });
            }}
            onMouseUp={(event) => send({ type: "input.mouse", action: "up", ...point(event) })}
            onWheel={(event) => {
              event.preventDefault();
              send({ type: "input.wheel", ...point(event), dx: event.deltaX, dy: event.deltaY });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "Tab" || event.key === "Escape" || event.key === "Backspace") {
                event.preventDefault();
                send({ type: "input.key", key: event.key });
                return;
              }
              if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
                event.preventDefault();
                send({ type: "input.text", text: event.key });
              }
            }}
            onPaste={(event) => {
              event.preventDefault();
              send({ type: "input.text", text: event.clipboardData.getData("text") });
            }}
          />
        </div>
        <aside className="card steps">
          <strong>Captured steps</strong>
          {steps.length === 0 ? <p className="muted">Steps show up here as you use the page.</p> : null}
          {steps.map((step) => (
            <div className="step" key={step.id}>
              <div>{step.description || step.type}</div>
              {step.value ? <code>{step.value}</code> : null}
              {step.flags?.length ? <div className="muted">{step.flags.join(", ")}</div> : null}
            </div>
          ))}
          <div className="row" style={{ marginTop: 12 }}>
            <input value={name} onChange={(event) => setName(event.target.value)} />
            <button className="primary" onClick={save} disabled={!sessionId || busy}>Stop and save</button>
          </div>
        </aside>
      </div>
    </main>
  );
}
