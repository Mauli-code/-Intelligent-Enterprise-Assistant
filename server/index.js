import "dotenv/config";
import cors from "cors";
import express from "express";
import { GoogleGenAI } from "@google/genai";

const app = express();
const port = Number(process.env.PORT) || 3001;
const maxMessageLength = 1000;

app.use(cors());
app.use(express.json({ limit: "10kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
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

  if (!process.env.GEMINI_API_KEY) {
    return response.status(503).json({
      error: "The AI service is not configured. Add GEMINI_API_KEY to the backend .env file.",
    });
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

      return response.json({ reply });
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
