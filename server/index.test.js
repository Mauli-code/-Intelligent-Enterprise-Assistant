import test from "node:test";
import assert from "node:assert/strict";
import { app } from "./index.js";

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(() => {
  server.close();
});

async function request(path, options) {
  return fetch(`${baseUrl}${path}`, options);
}

test("reports API health", async () => {
  const response = await request("/api/health");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("rejects an empty chat message", async () => {
  const response = await request("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "   " }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Please enter a message before sending.",
  });
});

test("rejects chat messages over the length limit", async () => {
  const response = await request("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "a".repeat(1001) }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Messages must be 1000 characters or fewer.",
  });
});

test("reports missing AI configuration", async () => {
  const originalApiKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  try {
    const response = await request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Hello" }),
    });

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error:
        "The AI service is not configured. Add GEMINI_API_KEY to the backend .env file.",
    });
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalApiKey;
    }
  }
});

test("returns JSON for malformed request bodies", async () => {
  const response = await request("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Request body must be valid JSON.",
  });
});

test("rejects request bodies over the JSON size limit", async () => {
  const response = await request("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "a".repeat(11000) }),
  });

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    error: "Request body must be 10 KB or smaller.",
  });
});

test("returns a JSON 404 for unknown routes", async () => {
  const response = await request("/api/unknown");

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "The requested endpoint was not found.",
  });
});
