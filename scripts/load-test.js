import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const temporaryDirectory = await fs.mkdtemp(
  path.join(os.tmpdir(), "iea-load-test-"),
);
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = path.join(temporaryDirectory, "load-test.db");
process.env.AUTH_EMAIL_MODE = "smtp";
process.env.SMTP_HOST = "smtp.test";
process.env.SMTP_PORT = "587";
process.env.SMTP_SECURE = "false";
process.env.SMTP_USER = "load-test";
process.env.SMTP_PASSWORD = "load-test";
process.env.SMTP_FROM = "assistant@example.test";

const { app } = await import("../server/index.js");
const { setEmailTransportForTests, resetEmailTransportForTests } =
  await import("../server/email.js");
const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;
const userCount = 5;
const requestsPerUser = 10;
const measurements = [];
const testRunId = `${Date.now()}-${process.pid}`;
const users = [];

setEmailTransportForTests({
  async sendMail({ to, text }) {
    const code = text.match(/code is (\d{6})/)?.[1];
    users.find((user) => user.email === to).code = code;
    return { accepted: [to] };
  },
});

async function authenticateUser(userNumber) {
  const email = `load-user-${userNumber}-${testRunId}@example.com`;
  const user = { email, code: "" };
  users.push(user);

  const requestCodeResponse = await fetch(`${baseUrl}/api/auth/request-code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (requestCodeResponse.status !== 200 || !user.code) {
    throw new Error("Load test could not request a test authentication code.");
  }

  const verifyResponse = await fetch(`${baseUrl}/api/auth/verify-code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code: user.code }),
  });
  if (verifyResponse.status !== 200) {
    throw new Error("Load test could not verify a test authentication code.");
  }

  const setCookie = verifyResponse.headers.get("set-cookie");
  const cookie = setCookie?.split(";")[0];
  if (!cookie) throw new Error("Load test did not receive a session cookie.");
  return { email, cookie };
}

async function runRequest(user, userNumber, requestNumber) {
  const startedAt = performance.now();
  let status = 0;

  try {
    const options =
      requestNumber === 1
        ? {
            method: "POST",
            headers: {
              cookie: user.cookie,
              "content-type": "application/json",
            },
            body: JSON.stringify({ title: `Private user ${userNumber}` }),
          }
        : { headers: { cookie: user.cookie } };
    const response = await fetch(`${baseUrl}/api/conversations`, options);
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

const authenticatedUsers = await Promise.all(
  Array.from({ length: userCount }, (_, userIndex) =>
    authenticateUser(userIndex + 1),
  ),
);

await Promise.all(
  authenticatedUsers.map((user, userIndex) =>
    Promise.all(
      Array.from({ length: requestsPerUser }, (_, requestIndex) =>
        runRequest(user, userIndex + 1, requestIndex + 1),
      ),
    ),
  ),
);

const ownedTitles = await Promise.all(
  authenticatedUsers.map(async (user) => {
    const response = await fetch(`${baseUrl}/api/conversations`, {
      headers: { cookie: user.cookie },
    });
    const data = await response.json();
    return {
      status: response.status,
      titles: data.conversations?.map((conversation) => conversation.title) || [],
    };
  }),
);
const isolationPassed = ownedTitles.every(
  ({ status, titles }, index) =>
    status === 200 &&
    titles.includes(`Private user ${index + 1}`) &&
    titles.every((title) => title === `Private user ${index + 1}`),
);

server.close();
resetEmailTransportForTests();
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
  isolationPassed,
}, null, 2));

if (failed > 0 || !isolationPassed) {
  process.exitCode = 1;
}
