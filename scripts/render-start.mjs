import http from "node:http";
import { spawn } from "node:child_process";

const port = Number(process.env.PORT || 10000);
const apiPrefixes = ["/health", "/auth", "/workflows", "/sessions", "/runs", "/fixture"];

function isApi(url = "/") {
  const path = url.split("?")[0];
  return apiPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function start(args, env) {
  const child = spawn("pnpm", args, { stdio: "inherit", env: { ...process.env, ...env } });
  child.on("exit", (code) => {
    console.error("pnpm", args.join(" "), "exited", code);
    process.exit(code ?? 1);
  });
}

start(["--filter", "@autopilot/api", "start"], { API_HOST: "127.0.0.1", API_PORT: "3001" });
start(["--filter", "@autopilot/web", "start"], {});

const server = http.createServer((req, res) => {
  const proxy = http.request(
    {
      hostname: "127.0.0.1",
      port: isApi(req.url) ? 3001 : 3000,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (upstream) => {
      res.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(res);
    },
  );
  proxy.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end("upstream unavailable");
  });
  req.pipe(proxy);
});

server.on("upgrade", (req, socket, head) => {
  const proxy = http.request({
    hostname: "127.0.0.1",
    port: isApi(req.url) ? 3001 : 3000,
    path: req.url,
    method: req.method,
    headers: req.headers,
  });
  proxy.on("upgrade", (upstream, proxySocket, proxyHead) => {
    const lines = ["HTTP/1.1 101 Switching Protocols"];
    for (const [key, value] of Object.entries(upstream.headers)) {
      if (value === undefined) continue;
      for (const item of Array.isArray(value) ? value : [value]) lines.push(`${key}: ${item}`);
    }
    socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (proxyHead.length) socket.write(proxyHead);
    if (head.length) proxySocket.write(head);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
    proxySocket.on("error", () => socket.destroy());
    socket.on("error", () => proxySocket.destroy());
  });
  proxy.on("error", () => socket.destroy());
  proxy.end();
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Listening on ${port}`);
});
