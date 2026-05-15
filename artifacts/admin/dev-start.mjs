import { createServer, request as httpRequest } from "http";
import { spawn } from "child_process";
import { connect as netConnect } from "net";
import path from "path";
import { fileURLToPath } from "url";

const PROXY_PORT = parseInt(process.env.PORT || "3001", 10);
const VITE_PORT = PROXY_PORT + 10001;

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const viteEnv = { ...process.env, PORT: String(VITE_PORT) };

const vite = spawn(
  process.execPath,
  [
    path.resolve(
      __dirname,
      "node_modules",
      ".bin",
      "../vite/bin/vite.js"
    ),
    "--config",
    "vite.config.ts",
    "--host",
    "0.0.0.0",
  ],
  {
    stdio: "inherit",
    env: viteEnv,
    cwd: __dirname,
  }
);

vite.on("exit", (code) => process.exit(code ?? 0));

const server = createServer((req, res) => {
  const options = {
    hostname: "127.0.0.1",
    port: VITE_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `localhost:${VITE_PORT}` },
  };
  const proxy = httpRequest(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });
  proxy.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
    }
    res.end(`Proxy error: ${err.message}`);
  });
  req.pipe(proxy, { end: true });
});

server.on("upgrade", (req, socket, head) => {
  const proxySocket = netConnect(VITE_PORT, "127.0.0.1", () => {
    const reqLine = `${req.method} ${req.url} HTTP/1.1\r\n`;
    const headers = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\r\n");
    proxySocket.write(`${reqLine}${headers}\r\n\r\n`);
    if (head && head.length > 0) proxySocket.write(head);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });
  proxySocket.on("error", () => socket.destroy());
  socket.on("error", () => proxySocket.destroy());
});

server.listen(PROXY_PORT, "0.0.0.0", () => {
  console.log(
    `[dev-start] Proxy on :${PROXY_PORT} → Vite on :${VITE_PORT}`
  );
});

process.on("SIGTERM", () => {
  server.close();
  vite.kill("SIGTERM");
});
