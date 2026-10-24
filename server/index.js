import "dotenv/config";
import { createHash, randomInt, randomBytes, timingSafeEqual } from "node:crypto";
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
import { knowledgePrompt } from "./knowledge.js";

const app = express();
const port = Number(process.env.PORT) || 3001;
const maxMessageLength = 1000;
const maxDocumentSize = 5 * 1024 * 1024;
const maxExtractedTextLength = 100000;
const aiRequestTimeoutMs = 30000;
const otpLifetimeMs = 10 * 60 * 1000;
const otpResendCooldownMs = 60 * 1000;
const otpMaxAttempts = 5;
const sessionLifetimeMs = 24 * 60 * 60 * 1000;

class AiRequestTimeoutError extends Error {
  constructor() {
    super("The AI service request timed out.");
    this.name = "AiRequestTimeoutError";
  }
}

function withTimeout(promise, timeoutMs = aiRequestTimeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new AiRequestTimeoutError()),
      timeoutMs,
    );
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

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
  if (process.env.NODE_ENV === "test") {
    return getOrCreateUser("test@example.com");
  }
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxDocumentSize },
  fileFilter: (_request, file, callback) => {
    const hasPdfType = file.mimetype === "application/pdf";
    const hasPdfExtension = file.originalname.toLowerCase().endsWith(".pdf");

    if (!hasPdfType || !hasPdfExtension) {
      const error = new Error("Only PDF files are supported.");
      error.code = "UNSUPPORTED_FILE_TYPE";
      return callback(error);
    }

    return callback(null, true);
  },
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.post("/api/auth/request-code", (request, response) => {
  const email = normalizeEmail(request.body?.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response.status(400).json({ error: "Enter a valid email address." });
  }

  const previous = getOtpChallenge(email);
  if (
    previous &&
    Date.now() - Date.parse(previous.last_sent_at) < otpResendCooldownMs
  ) {
    return response.status(429).json({ error: "Please wait before requesting another code." });
  }

  const code = String(randomInt(100000, 1000000));
  const now = new Date();
  saveOtpChallenge(
    email,
    hashValue(code),
    new Date(now.getTime() + otpLifetimeMs).toISOString(),
    now.toISOString(),
  );

  if (process.env.AUTH_EMAIL_MODE !== "smtp") {
    console.log(`[development OTP] ${email}: ${code}`);
  }

  return response.json({ message: "If this email can be used, a verification code has been sent." });
});

app.post("/api/auth/verify-code", (request, response) => {
  const email = normalizeEmail(request.body?.email);
  const code = typeof request.body?.code === "string" ? request.body.code.trim() : "";
  const challenge = getOtpChallenge(email);

  if (!challenge || Date.parse(challenge.expires_at) <= Date.now() || challenge.attempts >= otpMaxAttempts) {
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
  createSession(user.id, hashValue(token), new Date(Date.now() + sessionLifetimeMs).toISOString());
  deleteOtpChallenge(challenge.id);
  response.setHeader("Set-Cookie", `iea_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionLifetimeMs / 1000}`);
  return response.json({ user: { email: user.email } });
});

app.post("/api/auth/logout", (request, response) => {
  const token = readCookie(request, "iea_session");
  if (token) deleteSession(hashValue(token));
  response.setHeader("Set-Cookie", "iea_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  return response.status(204).send();
});

app.get("/api/auth/me", (request, response) => {
  const user = currentUser(request);
  return user ? response.json({ user: { email: user.email } }) : response.status(401).json({ error: "Not signed in." });
});

app.get("/api/conversations", (_request, response) => {
  const user = requireUser(_request, response);
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
  const conversation = getConversation(request.params.id, user.userId);
  if (!conversation || !deleteConversation(request.params.id)) {
    return response.status(404).json({ error: "Conversation not found." });
  }

  return response.status(204).send();
});

app.post("/api/documents", upload.single("document"), async (request, response) => {
  const user = requireUser(request, response);
  if (!user) return;
  if (!request.file) {
    return response.status(400).json({ error: "Please upload a PDF document." });
  }

  const fileHeader = request.file.buffer.subarray(0, 5).toString("ascii");

  if (fileHeader !== "%PDF-") {
    return response.status(400).json({
      error: "The uploaded file is not a readable PDF document.",
    });
  }

  const parser = new PDFParse({ data: request.file.buffer });

  try {
    let result;
    try {
      result = await parser.getText();
    } catch {
      return response.status(422).json({
        error: "The uploaded PDF could not be read. Please provide a valid text-based PDF.",
      });
    }

    const text = result.text.trim();

    if (!text) {
      return response.status(422).json({
        error: "This PDF has no selectable text. OCR is required for scanned PDFs.",
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return response.status(503).json({
        error: "The AI service is not configured. Add GEMINI_API_KEY to the backend .env file.",
      });
    }

    const conversationId = request.body?.conversationId;
    if (!conversationId || !getConversation(conversationId, user.userId)) {
      return response.status(400).json({
        error: "Upload a PDF from an existing conversation.",
      });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const aiResult = await withTimeout(
      ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Summarize this document for a college student. Return only valid JSON with exactly two keys: "summary" (a concise paragraph) and "keywords" (an array of 5 to 10 short strings). Do not use markdown fences.\n\nDocument text:\n${text.slice(0, maxExtractedTextLength)}`,
      }),
    );
    const rawReply = aiResult.text?.trim() || "";
    const parsedReply = JSON.parse(rawReply);

    if (
      typeof parsedReply.summary !== "string" ||
      !Array.isArray(parsedReply.keywords) ||
      parsedReply.keywords.some((keyword) => typeof keyword !== "string")
    ) {
      throw new Error("The AI service returned an invalid document summary.");
    }

    const documentId = saveDocument(
      conversationId,
      request.file.originalname,
      text.slice(0, maxExtractedTextLength),
    );

    return response.json({
      conversationId,
      documentId,
      filename: request.file.originalname,
      size: request.file.size,
      summary: parsedReply.summary,
      keywords: parsedReply.keywords,
    });
  } catch (error) {
    if (error instanceof AiRequestTimeoutError) {
      return response.status(504).json({
        error: "The AI service took too long to respond. Please try again.",
      });
    }

    if (error instanceof SyntaxError) {
      return response.status(502).json({
        error: "The AI service returned an invalid document summary.",
      });
    }

    console.error("PDF processing failed.");
    return response.status(502).json({
      error: "The PDF could not be processed or summarized.",
    });
  } finally {
    await parser.destroy();
  }
});

app.post("/api/chat", (request, response) => {
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

  let conversationId = request.body?.conversationId;
  if (conversationId && !getConversation(conversationId, user.userId)) {
    return response.status(404).json({ error: "Conversation not found." });
  }

  if (!conversationId) {
    conversationId = createConversation(message.slice(0, 60), user.userId).id;
  }

  if (!process.env.GEMINI_API_KEY) {
    return response.status(503).json({
      error: "The AI service is not configured. Add GEMINI_API_KEY to the backend .env file.",
    });
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const uploadedDocument = getLatestDocument(conversationId);
  const knowledge = knowledgePrompt(message, uploadedDocument?.extractedText);
  addMessage(conversationId, "user", message);

  return withTimeout(
    ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: knowledge.prompt,
    }),
  )
    .then((result) => {
      const reply = result.text?.trim();

      if (!reply) {
        return response
          .status(502)
          .json({ error: "The AI service returned an empty response." });
      }

      addMessage(conversationId, "assistant", reply);
      updateConversationTitle(conversationId, message.slice(0, 60));
      return response.json({
        conversationId,
        reply,
        sources: knowledge.sources,
      });
    })
    .catch((error) => {
      if (error instanceof AiRequestTimeoutError) {
        return response.status(504).json({
          error: "The AI service took too long to respond. Please try again.",
        });
      }

      console.error("Gemini request failed.");
      return response
        .status(502)
        .json({ error: "The AI service could not generate a response." });
    });
});

app.use((_request, response) => {
  response.status(404).json({ error: "The requested endpoint was not found." });
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return response.status(413).json({
      error: "PDF files must be 5 MB or smaller.",
    });
  }

  if (
    error instanceof multer.MulterError &&
    error.code === "LIMIT_UNEXPECTED_FILE"
  ) {
    return response.status(400).json({
      error: 'Upload the PDF using the "document" field.',
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
  });
}

if (process.env.NODE_ENV !== "test") {
  startServer();
}

export { app };
