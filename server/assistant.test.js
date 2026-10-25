import test from "node:test";
import assert from "node:assert/strict";
import { activeProvider, generateReply } from "./assistant.js";

test("uses the local provider for unknown provider configuration", () => {
  const originalProvider = process.env.AI_PROVIDER;
  const originalKey = process.env.GEMINI_API_KEY;

  try {
    process.env.AI_PROVIDER = "typo";
    process.env.GEMINI_API_KEY = "test-key";
    assert.equal(activeProvider(), "local");
  } finally {
    if (originalProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = originalProvider;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test("answers locally without requiring a provider key", async () => {
  const originalProvider = process.env.AI_PROVIDER;
  const originalKey = process.env.GEMINI_API_KEY;

  try {
    process.env.AI_PROVIDER = "local";
    delete process.env.GEMINI_API_KEY;
    const result = await generateReply({ question: "How do I apply for leave?" });
    assert.equal(result.provider, "local-nlp");
    assert.ok(result.reply.length > 0);
  } finally {
    if (originalProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = originalProvider;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});
