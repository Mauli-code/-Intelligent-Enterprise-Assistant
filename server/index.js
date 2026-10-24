import "dotenv/config";
import cors from "cors";
import express from "express";
import { GoogleGenAI } from "@google/genai";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import {
  addMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  getLatestDocument,
  saveDocument,
  updateConversationTitle,
} from "./database.js";
import { knowledgePrompt } from "./knowledge.js";

const app = express();
const port = Number(process.env.PORT) || 3001;
const maxMessageLength = 1000;
const maxDocumentSize = 5 * 1024 * 1024;
const maxExtractedTextLength = 100000;
const aiRequestTimeoutMs = 30000;

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

app.use(cors());
app.use(express.json({ limit: "10kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.get("/api/conversations", (_request, response) => {
  response.json({ conversations: listConversations() });
});

app.post("/api/conversations", (request, response) => {
  const title =
    typeof request.body?.title === "string" && request.body.title.trim()
      ? request.body.title.trim().slice(0, 100)
      : "New conversation";

  response.status(201).json({ conversation: createConversation(title) });
});

app.get("/api/conversations/:id", (request, response) => {
  const conversation = getConversation(request.params.id);

  if (!conversation) {
    return response.status(404).json({ error: "Conversation not found." });
  }

  return response.json({ conversation });
});

app.delete("/api/conversations/:id", (request, response) => {
  if (!deleteConversation(request.params.id)) {
    return response.status(404).json({ error: "Conversation not found." });
  }

  return response.status(204).send();
});

app.post("/api/documents", upload.single("document"), async (request, response) => {
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
    if (!conversationId || !getConversation(conversationId)) {
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
  if (conversationId && !getConversation(conversationId)) {
    return response.status(404).json({ error: "Conversation not found." });
  }

  if (!conversationId) {
    conversationId = createConversation(message.slice(0, 60)).id;
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
