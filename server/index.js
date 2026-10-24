import "dotenv/config";
import cors from "cors";
import express from "express";
import { GoogleGenAI } from "@google/genai";
import multer from "multer";
import {
  addMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateConversationTitle,
} from "./database.js";

const app = express();
const port = Number(process.env.PORT) || 3001;
const maxMessageLength = 1000;
const maxDocumentSize = 5 * 1024 * 1024;
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

app.post("/api/documents", upload.single("document"), (request, response) => {
  if (!request.file) {
    return response.status(400).json({ error: "Please upload a PDF document." });
  }

  const fileHeader = request.file.buffer.subarray(0, 5).toString("ascii");

  if (fileHeader !== "%PDF-") {
    return response.status(400).json({
      error: "The uploaded file is not a readable PDF document.",
    });
  }

  return response.json({
    filename: request.file.originalname,
    size: request.file.size,
    message: "PDF uploaded successfully.",
  });
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
  addMessage(conversationId, "user", message);

  return ai.models
    .generateContent({
      model: "gemini-2.5-flash",
      contents: message,
    })
    .then((result) => {
      const reply = result.text?.trim();

      if (!reply) {
        return response
          .status(502)
          .json({ error: "The AI service returned an empty response." });
      }

      addMessage(conversationId, "assistant", reply);
      updateConversationTitle(conversationId, message.slice(0, 60));
      return response.json({ conversationId, reply });
    })
    .catch(() => {
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
