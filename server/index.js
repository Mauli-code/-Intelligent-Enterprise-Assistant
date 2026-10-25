import "dotenv/config";
import { createHash, randomInt, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { GoogleGenAI } from "@google/genai";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import {
  addMessage,
  createConversation,
  createSession,
  deleteConversation,
  deleteSession,
  deleteOtpChallenge,
  getOrCreateUser,
  getConversation,
  getOtpChallenge,
  getSession,
  incrementOtpAttempts,
  listConversations,
  getLatestDocument,
  saveDocument,
  saveOtpChallenge,
  updateConversationTitle,
} from "./database.js";
import { activeProvider, generateReply } from "./assistant.js";
import { withTimeout } from "./async.js";
import { analyzeDocument } from "./summarize.js";
import { censorText, moderateMessage } from "./moderation.js";
import {
  EmailConfigurationError,
  EmailDeliveryError,
  emailDeliveryStatus,
  sendOtpEmail,
} from "./email.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number(process.env.PORT) || 3001;
const maxMessageLength = 1000;
const maxDocumentSize = 5 * 1024 * 1024;
const maxExtractedTextLength = 100000;
const aiRequestTimeoutMs = Math.min(Number(process.env.AI_TIMEOUT_MS) || 4000, 4500);
const otpLifetimeMs = 10 * 60 * 1000;
const otpResendCooldownMs = 60 * 1000;
const otpMaxAttempts = 5;
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000; // 30 days

const TEXT_DOCUMENT_TYPES = new Map([
  ["text/plain", "txt"],
  ["text/markdown", "md"],
  ["text/x-markdown", "md"],
  ["text/csv", "csv"],
  ["application/csv", "csv"],
]);
const TEXT_DOCUMENT_EXTENSIONS = new Set([".txt", ".md", ".csv"]);

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function hashValue(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readCookie(request, name) {
  const cookies = request.headers.cookie?.split(";") || [];
  const value = cookies.find((cookie) => cookie.trim().startsWith(`${name}=`));
  return value ? decodeURIComponent(value.trim().slice(name.length + 1)) : "";
}

function currentUser(request) {
  const token = readCookie(request, "iea_session");
  return token ? getSession(hashValue(token)) : null;
}

function requireUser(request, response) {
  const user = currentUser(request);
  if (!user) {
    response.status(401).json({ error: "Please verify your email first." });
    return null;
  }
  return user;
}

function documentKind(file) {
  const extension = `.${file.originalname.toLowerCase().split(".").pop()}`;
  if (file.mimetype === "application/pdf" || extension === ".pdf") return "pdf";
  if (TEXT_DOCUMENT_TYPES.has(file.mimetype) || TEXT_DOCUMENT_EXTENSIONS.has(extension)) {
    return "text";
  }
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxDocumentSize },
  fileFilter: (_request, file, callback) => {
    if (!documentKind(file)) {
      const error = new Error("Only PDF, TXT, MD, and CSV files are supported.");
      error.code = "UNSUPPORTED_FILE_TYPE";
      return callback(error);
    }
    return callback(null, true);
  },
});

// Reflecting any origin with credentials is convenient in development but too
// permissive in production, so CORS_ORIGIN can pin the allowed list.
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable("x-powered-by");
app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  }),
);
app.use(express.json({ limit: "10kb" }));

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    provider: activeProvider(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.get("/api/config", (_request, response) => {
  response.json({
    provider: activeProvider(),
    providerConfigured: Boolean(process.env.GEMINI_API_KEY),
    email: emailDeliveryStatus(),
    limits: {
      maxMessageLength,
      maxDocumentSize,
      supportedDocuments: ["pdf", "txt", "md", "csv"],
      responseBudgetMs: 5000,
    },
  });
});

app.post("/api/auth/request-code", async (request, response) => {
  const email = normalizeEmail(request.body?.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response.status(400).json({ error: "Enter a valid email address." });
  }

  const previous = getOtpChallenge(email);
  if (
    previous &&
    Date.now() - Date.parse(previous.last_sent_at) < otpResendCooldownMs
  ) {
    return response.status(429).json({
      error: "Please wait before requesting another code.",
    });
  }

  const code = String(randomInt(100000, 1000000));
  const now = new Date();
  saveOtpChallenge(
    email,
    hashValue(code),
    new Date(now.getTime() + otpLifetimeMs).toISOString(),
    now.toISOString(),
  );

  try {
    const delivery = await sendOtpEmail(email, code);
    if (!delivery.accepted) {
      return response.status(503).json({
        error:
          "Email delivery is not configured. Set AUTH_EMAIL_MODE=smtp to send verification emails.",
      });
    }

    return response.json({
      message: delivery.devCode
        ? `Development mode: use code ${delivery.devCode}. No email was sent.`
        : "If this email can be used, a verification code has been sent.",
      // Only ever populated outside production; see sendOtpEmail().
      ...(delivery.devCode ? { devCode: delivery.devCode } : {}),
    });
  } catch (error) {
    deleteOtpChallenge(getOtpChallenge(email)?.id);
    if (error instanceof EmailConfigurationError) {
      return response.status(503).json({
        error: "Email delivery is not configured. Check the backend email settings.",
      });
    }

    if (error instanceof EmailDeliveryError) {
      return response.status(502).json({
        error: "The verification email could not be delivered. Please try again later.",
      });
    }

    console.error("Unexpected OTP email delivery failure.");
    return response.status(502).json({
      error: "The verification email could not be delivered. Please try again later.",
    });
  }
});

app.post("/api/auth/verify-code", (request, response) => {
  const email = normalizeEmail(request.body?.email);
  const code = typeof request.body?.code === "string" ? request.body.code.trim() : "";
  const challenge = getOtpChallenge(email);

  if (
    !challenge ||
    Date.parse(challenge.expires_at) <= Date.now() ||
    challenge.attempts >= otpMaxAttempts
  ) {
    return response.status(401).json({ error: "The code is invalid or expired." });
  }

  const expected = Buffer.from(challenge.code_hash);
  const actual = Buffer.from(hashValue(code));
  incrementOtpAttempts(challenge.id);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return response.status(401).json({ error: "The code is invalid or expired." });
  }

  const user = getOrCreateUser(email);
  const token = randomBytes(32).toString("hex");
  createSession(
    user.id,
    hashValue(token),
    new Date(Date.now() + sessionLifetimeMs).toISOString(),
  );
  deleteOtpChallenge(challenge.id);
  const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `iea_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionLifetimeMs / 1000}${secureCookie}`,
  );
  return response.json({ user: { email: user.email } });
});

app.post("/api/auth/logout", (request, response) => {
  const token = readCookie(request, "iea_session");
  if (token) deleteSession(hashValue(token));
  response.setHeader(
    "Set-Cookie",
    "iea_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
  );
  return response.status(204).send();
});

app.get("/api/auth/me", (request, response) => {
  const user = currentUser(request);
  return user
    ? response.json({ user: { email: user.email } })
    : response.status(401).json({ error: "Not signed in." });
});

app.get("/api/conversations", (request, response) => {
  const user = requireUser(request, response);
  if (!user) return;
  response.json({ conversations: listConversations(user.userId) });
});

app.post("/api/conversations", (request, response) => {
  const user = requireUser(request, response);
  if (!user) return;
  const title =
    typeof request.body?.title === "string" && request.body.title.trim()
      ? request.body.title.trim().slice(0, 100)
      : "New conversation";

  response.status(201).json({ conversation: createConversation(title, user.userId) });
});

app.get("/api/conversations/:id", (request, response) => {
  const user = requireUser(request, response);
  if (!user) return;
  const conversation = getConversation(request.params.id, user.userId);

  if (!conversation) {
    return response.status(404).json({ error: "Conversation not found." });
  }

  return response.json({ conversation });
});

app.delete("/api/conversations/:id", (request, response) => {
  const user = requireUser(request, response);
  if (!user) return;
  if (!deleteConversation(request.params.id, user.userId)) {
    return response.status(404).json({ error: "Conversation not found." });
  }

  return response.status(204).send();
});

/**
 * Extract text from an uploaded document.
 * PDFs use pdf-parse; plain-text formats are decoded directly.
 */
async function extractDocumentText(file) {
  const kind = documentKind(file);

  if (kind === "text") {
    const text = file.buffer.toString("utf8").replace(/^\uFEFF/, "").trim();
    return { kind, text, meta: {} };
  }

  const fileHeader = file.buffer.subarray(0, 5).toString("ascii");
  if (fileHeader !== "%PDF-") {
    const error = new Error("The uploaded file is not a readable PDF document.");
    error.code = "INVALID_PDF";
    throw error;
  }

  const parser = new PDFParse({ data: file.buffer });
  try {
    let result;
    try {
      result = await parser.getText();
    } catch {
      const error = new Error(
        "The uploaded PDF could not be read. Please provide a valid text-based PDF.",
      );
      error.code = "UNREADABLE_PDF";
      throw error;
    }

    // pdf-parse inserts "-- 1 of 8 --" markers, and most paged documents repeat
    // a "page N of M" footer. Neither carries meaning, so both are dropped
    // before summarization.
    const text = result.text
      .replace(/--\s+\d+\s+of\s+\d+\s+--/g, "")
      .replace(/^.*\bpage\s+\d+\s+of\s+\d+.*$/gim, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { kind, text, meta: { pages: result.total } };
  } finally {
    await parser.destroy();
  }
}

/**
 * Optional LLM refinement of the document summary. Returns null when the
 * provider is unavailable so the caller can use the local extractive summary.
 */
async function summarizeWithGemini(text) {
  try {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const result = await withTimeout(
      client.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        contents: `Summarize this workplace document for an employee. Return only valid JSON with exactly two keys: "summary" (one concise paragraph) and "keywords" (5 to 10 short strings). No markdown fences.\n\nDocument text:\n${text.slice(0, 60000)}`,
      }),
      aiRequestTimeoutMs,
    );
    const parsed = JSON.parse(result.text?.trim() || "");
    if (
      typeof parsed.summary !== "string" ||
      !Array.isArray(parsed.keywords) ||
      parsed.keywords.some((keyword) => typeof keyword !== "string")
    ) {
      return null;
    }
    return { summary: parsed.summary, keywords: parsed.keywords };
  } catch {
    return null;
  }
}

app.post("/api/documents", upload.single("document"), async (request, response) => {
  const user = requireUser(request, response);
  if (!user) return;
  if (!request.file) {
    return response.status(400).json({ error: "Please upload a document." });
  }

  let extracted;
  try {
    extracted = await extractDocumentText(request.file);
  } catch (error) {
    if (error.code === "INVALID_PDF") {
      return response.status(400).json({ error: error.message });
    }
    if (error.code === "UNREADABLE_PDF") {
      return response.status(422).json({ error: error.message });
    }
    console.error("Document extraction failed.");
    return response.status(422).json({
      error: "The document could not be processed.",
    });
  }

  if (!extracted.text) {
    return response.status(422).json({
      error:
        extracted.kind === "pdf"
          ? "This PDF has no selectable text. OCR is required for scanned PDFs."
          : "The uploaded document is empty.",
    });
  }

  const conversationId = request.body?.conversationId;
  if (!conversationId || !getConversation(conversationId, user.userId)) {
    return response.status(400).json({
      error: "Upload a document from an existing conversation.",
    });
  }

  const text = extracted.text.slice(0, maxExtractedTextLength);
  const local = analyzeDocument(text);

  // The local analysis always runs, so the endpoint works with no API key.
  let summary = local.summary;
  let keywords = local.keywords;
  let provider = "local-nlp";

  if (process.env.GEMINI_API_KEY && activeProvider() === "gemini") {
    const refined = await summarizeWithGemini(text);
    if (refined) {
      summary = refined.summary;
      keywords = refined.keywords.slice(0, 12);
      provider = "gemini";
    }
  }

  const documentId = saveDocument(conversationId, request.file.originalname, text);

  return response.json({
    conversationId,
    documentId,
    filename: request.file.originalname,
    kind: extracted.kind,
    size: request.file.size,
    pages: extracted.meta.pages ?? null,
    summary,
    keywords,
    statistics: local.statistics,
    provider,
  });
});

app.post("/api/chat", async (request, response) => {
  const user = requireUser(request, response);
  if (!user) return;
  const message =
    typeof request.body?.message === "string" ? request.body.message.trim() : "";

  if (!message) {
    return response
      .status(400)
      .json({ error: "Please enter a message before sending." });
  }

  if (message.length > maxMessageLength) {
    return response.status(400).json({
      error: `Messages must be ${maxMessageLength} characters or fewer.`,
    });
  }

  const moderation = moderateMessage(message);
  if (!moderation.allowed) {
    return response.status(400).json({ error: moderation.error });
  }

  let conversationId = request.body?.conversationId;
  if (conversationId && !getConversation(conversationId, user.userId)) {
    return response.status(404).json({ error: "Conversation not found." });
  }

  if (!conversationId) {
    conversationId = createConversation(message.slice(0, 60), user.userId).id;
  }

  const conversation = getConversation(conversationId, user.userId);
  const history = (conversation?.messages || []).map(({ role, content }) => ({
    role,
    content,
  }));
  const storedDocument = getLatestDocument(conversationId);
  const document = storedDocument
    ? { filename: storedDocument.filename, text: storedDocument.extractedText }
    : null;

  addMessage(conversationId, "user", message);

  let result;
  try {
    result = await generateReply({ question: message, document, history });
  } catch (error) {
    console.error("Assistant generation failed unexpectedly.");
    return response.status(500).json({
      error: "The assistant could not answer. Please try again.",
    });
  }

  // Model output is moderated too, so abuse cannot be reflected back.
  const reply = censorText(result.reply).trim();
  if (!reply) {
    return response.status(502).json({ error: "The assistant returned an empty response." });
  }

  addMessage(conversationId, "assistant", reply);
  updateConversationTitle(conversationId, message.slice(0, 60));

  return response.json({
    conversationId,
    reply,
    sources: result.sources,
    provider: result.provider,
    intent: result.intent,
    confidence: result.confidence,
    latencyMs: result.latencyMs,
    ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
  });
});

app.use(express.static(path.join(__dirname, "../dist")));

app.get("*", (request, response, next) => {
  if (request.path.startsWith("/api")) {
    return next();
  }

  return response.sendFile(path.join(__dirname, "../dist/index.html"));
});

app.use((_request, response) => {
  response.status(404).json({ error: "The requested endpoint was not found." });
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return response.status(413).json({
      error: "Documents must be 5 MB or smaller.",
    });
  }

  if (error instanceof multer.MulterError && error.code === "LIMIT_UNEXPECTED_FILE") {
    return response.status(400).json({
      error: 'Upload the document using the "document" field.',
    });
  }

  if (error.code === "UNSUPPORTED_FILE_TYPE") {
    return response.status(400).json({ error: error.message });
  }

  if (error instanceof SyntaxError && "body" in error) {
    return response.status(400).json({ error: "Request body must be valid JSON." });
  }

  if (error.type === "entity.too.large") {
    return response
      .status(413)
      .json({ error: "Request body must be 10 KB or smaller." });
  }

  console.error(error);
  return response.status(500).json({ error: "An unexpected server error occurred." });
});

export function startServer() {
  return app.listen(port, () => {
    console.log(`API server listening on http://localhost:${port}`);
    console.log(
      `Assistant provider: ${activeProvider()} (AI_PROVIDER=${process.env.AI_PROVIDER || "auto"})`,
    );
    const emailStatus = emailDeliveryStatus();
    console.log(
      `Email second factor: ${emailStatus.devOtp ? "development mode (codes printed to this console)" : emailStatus.mode}`,
    );
  });
}

if (process.env.NODE_ENV !== "test" && process.env.IEA_MANAGED_SERVER !== "true") {
  startServer();
}

export { app };
