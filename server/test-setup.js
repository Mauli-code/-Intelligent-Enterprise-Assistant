// Test environment setup. Imported first by server/index.test.js so that the
// database path and provider settings exist before server/index.js is evaluated.
//
// Using a temporary database keeps `npm test` from writing test users and
// conversations into the developer's local server/data directory.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "iea-test-"));

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = path.join(directory, "assistant-test.db");

// Never call an external AI provider from an automated test.
process.env.AI_PROVIDER = "local";
delete process.env.GEMINI_API_KEY;

process.env.AUTH_EMAIL_MODE = "smtp";
process.env.SMTP_HOST = "smtp.test";
process.env.SMTP_PORT = "587";
process.env.SMTP_SECURE = "false";
process.env.SMTP_USER = "test-user";
process.env.SMTP_PASSWORD = "test-password";
process.env.SMTP_FROM = "assistant@example.test";
