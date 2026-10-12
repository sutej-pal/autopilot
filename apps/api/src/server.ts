import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { RecordingSession, runWorkflow, type ClientEvent } from "@autopilot/browser";
import { FileStore, LOCAL_TENANT_ID, devVaultKey, parseWorkflow, type Workflow } from "@autopilot/shared";

const sessions = new Map<string, RecordingSession>();
const dataFile = process.env.DATA_FILE || fileURLToPath(new URL("../../../.data/store.json", import.meta.url));
const fixturePath = fileURLToPath(new URL("../../../packages/browser/fixtures/timesheet.html", import.meta.url));

export async function buildServer() {
  const app = Fastify({ logger: true });
  const store = new FileStore(dataFile, devVaultKey());
  await app.register(cors, { origin: true });
  await app.register(websocket);

  const accessToken = process.env.AUTOPILOT_TOKEN;
  if (accessToken) {
    app.addHook("onRequest", async (request, reply) => {
      if (request.method === "OPTIONS") return;
      const requestPath = request.url.split("?")[0];
      if (requestPath === "/health" || requestPath === "/auth") return;
      const header = request.headers.authorization;
      const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
      const cookie = readCookie(request.headers.cookie, "autopilot_token");
      const presented = bearer || cookie || "";
      const expected = Buffer.from(accessToken);
      const actual = Buffer.from(presented);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
    });
  }

  app.get("/health", async () => ({ ok: true, mode: process.env.RENDER === "true" ? "render" : "local" }));

  app.post("/auth", async (request, reply) => {
    if (!accessToken) return { ok: true };
    const body = request.body as { token?: string };
    const presented = body?.token || "";
    const expected = Buffer.from(accessToken);
    const actual = Buffer.from(presented);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const secure = process.env.RENDER === "true" ? "; Secure" : "";
    reply.header("set-cookie", `autopilot_token=${encodeURIComponent(presented)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${secure}`);
    return { ok: true };
  });

  app.get("/fixture/timesheet.html", async (_request, reply) => {
    return reply.type("text/html").send(readFileSync(fixturePath));
  });

  app.get("/workflows", async () => store.list().map(publicWorkflow));

  app.patch("/workflows/:id", async (request, reply) => {
    const body = request.body as { name?: string };
    if (!body?.name?.trim()) return reply.code(400).send({ error: "Name is required" });
    const workflow = store.rename((request.params as { id: string }).id, body.name);
    if (!workflow) return reply.code(404).send({ error: "Workflow not found" });
    return publicWorkflow(workflow);
  });

  app.delete("/workflows/:id", async (request, reply) => {
    const removed = store.remove((request.params as { id: string }).id);
    if (!removed) return reply.code(404).send({ error: "Workflow not found" });
    return { ok: true };
  });

  app.post("/sessions", async (request, reply) => {
    const body = request.body as { startUrl?: string };
    if (!body?.startUrl || !/^https?:\/\//.test(body.startUrl)) {
      return reply.code(400).send({ error: "startUrl must be an http(s) URL" });
    }
    const session = await RecordingSession.open({ startUrl: body.startUrl });
    sessions.set(session.id, session);
    return { id: session.id };
  });

  app.get("/sessions/:id/stream", { websocket: true }, (socket, request) => {
    const session = sessions.get((request.params as { id: string }).id);
    if (!session) {
      socket.close();
      return;
    }
    const sendSteps = (steps: unknown) => socket.send(JSON.stringify({ type: "steps", steps }));
    const onFrame = (frame: Buffer) => socket.send(frame);
    const onMeta = (meta: { width: number; height: number }) => socket.send(JSON.stringify({ type: "meta", ...meta }));
    session.on("frame", onFrame);
    session.on("meta", onMeta);
    session.on("steps", sendSteps);
    sendSteps(session.snapshot().steps);
    socket.on("message", (raw: Buffer | string) => {
      try {
        const text = typeof raw === "string" ? raw : raw.toString();
        void session.handleInput(JSON.parse(text) as ClientEvent);
      } catch {
        // Ignore malformed client frames. They are not workflow data.
      }
    });
    socket.on("close", () => {
      session.off("frame", onFrame);
      session.off("meta", onMeta);
      session.off("steps", sendSteps);
    });
  });

  app.post("/sessions/:id/stop", async (request, reply) => {
    const session = sessions.get((request.params as { id: string }).id);
    if (!session) return reply.code(404).send({ error: "Session not found" });
    const body = (request.body as { name?: string } | undefined) ?? {};
    const draft = session.snapshot();
    const workflow = parseWorkflow({
      id: randomUUID(),
      tenantId: LOCAL_TENANT_ID,
      name: body.name?.trim() || "Recorded workflow",
      startUrl: draft.startUrl,
      timezone: "Asia/Kolkata",
      variables: draft.variables,
      steps: draft.steps,
    });
    store.save(workflow, draft.secrets);
    sessions.delete(session.id);
    await session.close();
    return publicWorkflow(workflow);
  });

  app.post("/workflows/:id/runs", async (request, reply) => {
    const workflow = store.get((request.params as { id: string }).id);
    if (!workflow) return reply.code(404).send({ error: "Workflow not found" });
    const body = (request.body as { url?: string } | undefined) ?? {};
    const url = body.url && /^https?:\/\//.test(body.url) ? body.url : undefined;
    const result = await runWorkflow(workflow, {
      credentials: store.secrets(workflow.id),
      headed: process.env.RENDER !== "true",
      url,
    });
    store.saveRun({
      id: randomUUID(),
      workflowId: workflow.id,
      status: result.status,
      outcome: result.outcome,
      error: result.error,
      steps: result.steps,
      createdAt: new Date().toISOString(),
    });
    return { status: result.status, outcome: result.outcome, error: result.error };
  });

  return app;
}

function publicWorkflow(workflow: Workflow) {
  return {
    id: workflow.id,
    name: workflow.name,
    startUrl: workflow.startUrl,
    timezone: workflow.timezone,
    stepCount: workflow.steps.length,
    variables: workflow.variables,
    steps: workflow.steps,
  };
}

export function dataDirectory(): string {
  return path.dirname(dataFile);
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}
