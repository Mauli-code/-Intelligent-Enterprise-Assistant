import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const temporaryDirectory = await fs.mkdtemp(
  path.join(os.tmpdir(), "iea-load-test-"),
);
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = path.join(temporaryDirectory, "load-test.db");

const { app } = await import("../server/index.js");
const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;
const userCount = 5;
const requestsPerUser = 10;
const measurements = [];

async function runRequest(userNumber, requestNumber) {
  const startedAt = performance.now();
  let status = 0;

  try {
    const response = await fetch(`${baseUrl}/api/conversations`, {
      headers: { "x-load-test-user": `user-${userNumber}` },
    });
    status = response.status;
    await response.arrayBuffer();
  } catch {
    status = 0;
  }

  measurements.push({
    durationMs: performance.now() - startedAt,
    requestNumber,
    status,
    userNumber,
  });
}

await Promise.all(
  Array.from({ length: userCount }, (_, userIndex) =>
    Promise.all(
      Array.from({ length: requestsPerUser }, (_, requestIndex) =>
        runRequest(userIndex + 1, requestIndex + 1),
      ),
    ),
  ),
);

server.close();
await fs.rm(temporaryDirectory, { recursive: true, force: true });

const durations = measurements.map(({ durationMs }) => durationMs).sort((a, b) => a - b);
const successful = measurements.filter(({ status }) => status >= 200 && status < 300);
const failed = measurements.length - successful.length;
const p95Index = Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1);
const overFiveSeconds = durations.filter((duration) => duration > 5000).length;
const averageMs = durations.reduce((total, duration) => total + duration, 0) / durations.length;

console.log(JSON.stringify({
  users: userCount,
  requests: measurements.length,
  successful: successful.length,
  failed,
  averageMs: Number(averageMs.toFixed(2)),
  p95Ms: Number(durations[p95Index].toFixed(2)),
  overFiveSeconds,
}, null, 2));

if (failed > 0) {
  process.exitCode = 1;
}
