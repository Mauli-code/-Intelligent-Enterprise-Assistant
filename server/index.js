import cors from "cors";
import express from "express";

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

  return response.json({
    reply: `Thanks for your message: "${message}". This is a hardcoded Day 1 response.`,
  });
});

app.use((_request, response) => {
  response.status(404).json({ error: "The requested endpoint was not found." });
});

app.use((error, _request, response, _next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return response.status(400).json({ error: "Request body must be valid JSON." });
  }

  console.error(error);
  return response.status(500).json({ error: "An unexpected server error occurred." });
});

app.listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`);
});
