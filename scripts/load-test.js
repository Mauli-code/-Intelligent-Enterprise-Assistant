import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

// Five-user concurrency test.
//
// It drives the real HTTP API: authentication, conversation creation, document
// upload, and chat. AI_PROVIDER=local keeps the measurement about this
// application rather than about an external provider's latency. Run against a
// Gemini-configured environment separately if you need that number.

const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "iea-load-test-"));
process.env.NODE_ENV = "test";
process.env.AI_PROVIDER = "local";
delete process.env.GEMINI_API_KEY;
process.env.DATABASE_PATH = path.join(temporaryDirectory, "load-test.db");
process.env.AUTH_EMAIL_MODE = "smtp";
process.env.SMTP_HOST = "smtp.test";
process.env.SMTP_PORT = "587";
process.env.SMTP_SECURE = "false";
process.env.SMTP_USER = "load-test";
process.env.SMTP_PASSWORD = "load-test";
process.env.SMTP_FROM = "assistant@example.test";

const { app } = await import("../server/index.js");
const { setEmailTransportForTests, resetEmailTransportForTests } = await import(
  "../server/email.js"
);

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;
const userCount = 5;
const chatRequestsPerUser = 5;
const measurements = [];
const failures = [];
const testRunId = `${Date.now()}-${process.pid}`;
const users = [];
const handbook = await fs.readFile(
  path.join(process.cwd(), "knowledge", "demo-employee-handbook.pdf"),
);

const QUESTIONS = [
  "How do I apply for leave?",
  "My laptop will not connect to wifi",
  "When is the next training workshop?",
  "How do I claim a medical reimbursement?",
  "What are the rules for two-factor authentication?",
];

setEmailTransportForTests({
  async sendMail({ to, text }) {
    const code = text.match(/code is (\d{6})/)?.[1];
    users.find((user) => user.email === to).code = code;
    return { accepted: [to] };
  },
});

async function timeIt(label, userNumber, operation) {
  const startedAt = performance.now();
  let status = 0;
  try {
    const response = await operation();
    status = response.status;
    await response.arrayBuffer();
  } catch (error) {
    failures.push(`${label} user ${userNumber}: ${error.message}`);
    status = 0;
  }
  measurements.push({
    label,
    durationMs: performance.now() - startedAt,
    status,
    userNumber,
  });
  return status;
}

async function authenticateUser(userNumber) {
  const email = `load-user-${userNumber}-${testRunId}@example.com`;
  const user = { email, code: "", cookie: "", conversationId: "" };
  users.push(user);

  const requestCodeResponse = await fetch(`${baseUrl}/api/auth/request-code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (requestCodeResponse.status !== 200 || !user.code) {
    throw new Error(`Load test could not request a code for user ${userNumber}.`);
  }

  const verifyResponse = await fetch(`${baseUrl}/api/auth/verify-code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code: user.code }),
  });
  if (verifyResponse.status !== 200) {
    throw new Error(`Load test could not verify user ${userNumber}.`);
  }

  const cookie = verifyResponse.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error(`Load test did not receive a cookie for user ${userNumber}.`);
  user.cookie = cookie;
  return user;
}

async function startUserWorkload(user, userNumber) {
  const createResponse = await fetch(`${baseUrl}/api/conversations`, {
    method: "POST",
    headers: { cookie: user.cookie, "content-type": "application/json" },
    body: JSON.stringify({ title: `Private user ${userNumber}` }),
  });
  const created = await createResponse.json();
  user.conversationId = created.conversation?.id;
  if (!user.conversationId) {
    throw new Error(`User ${userNumber} could not create a conversation.`);
  }

  // One document upload per user, in parallel with everyone else's chat.
  const form = new FormData();
  form.append("document", new Blob([handbook], { type: "application/pdf" }), "handbook.pdf");
  form.append("conversationId", user.conversationId);
  await timeIt("document", userNumber, () =>
    fetch(`${baseUrl}/api/documents`, {
      method: "POST",
      headers: { cookie: user.cookie },
      body: form,
    }),
  );

  for (let index = 0; index < chatRequestsPerUser; index += 1) {
    const question = QUESTIONS[index % QUESTIONS.length];
    await timeIt("chat", userNumber, () =>
      fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { cookie: user.cookie, "content-type": "application/json" },
        body: JSON.stringify({ conversationId: user.conversationId, message: question }),
      }),
    );
  }

  await timeIt("list", userNumber, () =>
    fetch(`${baseUrl}/api/conversations`, { headers: { cookie: user.cookie } }),
  );
}

const authenticatedUsers = await Promise.all(
  Array.from({ length: userCount }, (_, index) => authenticateUser(index + 1)),
);

const startedAt = performance.now();
await Promise.all(
  authenticatedUsers.map((user, index) => startUserWorkload(user, index + 1)),
);
const wallClockMs = performance.now() - startedAt;

// Ownership isolation: each user must see exactly their own conversations, and
// must not be able to read another user's conversation by id.
const ownedConversations = await Promise.all(
  authenticatedUsers.map(async (user) => {
    const response = await fetch(`${baseUrl}/api/conversations`, {
      headers: { cookie: user.cookie },
    });
    const data = await response.json();
    return {
      status: response.status,
      ids: data.conversations?.map((conversation) => conversation.id) || [],
    };
  }),
);
const selfIsolation = ownedConversations.every(
  ({ status, ids }, index) =>
    status === 200 &&
    ids.length === 1 &&
    ids[0] === authenticatedUsers[index].conversationId,
);

const crossAccess = await Promise.all(
  authenticatedUsers.map(async (user, index) => {
    const other = authenticatedUsers[(index + 1) % authenticatedUsers.length];
    const response = await fetch(`${baseUrl}/api/conversations/${other.conversationId}`, {
      headers: { cookie: user.cookie },
    });
    return response.status;
  }),
);
const isolationPassed = selfIsolation && crossAccess.every((status) => status === 404);

server.close();
resetEmailTransportForTests();
await fs.rm(temporaryDirectory, { recursive: true, force: true });

const durations = measurements.map(({ durationMs }) => durationMs).sort((a, b) => a - b);
const successful = measurements.filter(({ status }) => status >= 200 && status < 300);
const chatDurations = measurements
  .filter(({ label }) => label === "chat")
  .map(({ durationMs }) => durationMs)
  .sort((a, b) => a - b);
const p95Index = Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1);
const chatP95 = chatDurations[Math.min(chatDurations.length - 1, Math.ceil(chatDurations.length * 0.95) - 1)] || 0;
const averageMs = durations.reduce((total, value) => total + value, 0) / durations.length;
const overFiveSeconds = durations.filter((value) => value > 5000).length;

console.log(
  JSON.stringify(
    {
      users: userCount,
      requests: measurements.length,
      chatRequests: chatDurations.length,
      documentUploads: measurements.filter(({ label }) => label === "document").length,
      successful: successful.length,
      failed: measurements.length - successful.length,
      averageMs: Number(averageMs.toFixed(2)),
      p95Ms: Number(durations[p95Index].toFixed(2)),
      chatP95Ms: Number(chatP95.toFixed(2)),
      maxMs: Number(durations[durations.length - 1].toFixed(2)),
      wallClockMs: Number(wallClockMs.toFixed(2)),
      overFiveSeconds,
      isolationPassed,
      failures,
    },
    null,
    2,
  ),
);

const failedCount = measurements.length - successful.length;
if (failedCount > 0 || !isolationPassed || overFiveSeconds > 0) {
  process.exitCode = 1;
}
