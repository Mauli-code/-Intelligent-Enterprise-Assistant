import test from "node:test";
import assert from "node:assert/strict";
import { app } from "./index.js";
import { findKnowledgeSources, knowledgePrompt } from "./knowledge.js";
import { findBlockedTerm, moderateMessage } from "./moderation.js";
import {
  createConversation,
  getLatestDocument,
  saveDocument,
} from "./database.js";

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

function pdfUpload({ filename = "document.pdf", content = "%PDF-1.7" } = {}) {
  const form = new FormData();
  form.append(
    "document",
    new Blob([content], { type: "application/pdf" }),
    filename,
  );
  return form;
}

const textPdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 24 Tf 72 720 Td (Hello PDF) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
trailer
<< /Root 1 0 R >>
%%EOF`;

test("reports API health", async () => {
  const response = await request("/api/health");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("supports conversation routes in the authenticated test context", async () => {
  const response = await request("/api/conversations");
  assert.equal(response.status, 200);
});

test("blocks normalized bad-language terms without blocking innocent words", () => {
  assert.equal(findBlockedTerm("That is sh!t"), "shit");
  assert.equal(moderateMessage("This is a professional IT request.").allowed, true);
  assert.equal(moderateMessage("That is sh!t").allowed, false);
});

test("rejects moderated chat messages before provider configuration", async () => {
  const response = await request("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "This is sh!t" }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Please rephrase your message using respectful language.",
  });
});

test("finds demonstration HR knowledge and labels it", () => {
  const sources = findKnowledgeSources("How do I submit a leave request?");
  assert.deepEqual(sources.map((source) => source.name), ["demo-hr-policy.md"]);
  assert.match(knowledgePrompt("How do I submit a leave request?").prompt, /not official GAIL policy/);
});

test("includes uploaded document context in follow-up prompts", () => {
  const conversation = createTestConversation();
  saveDocument(conversation.id, "handbook.pdf", "The sample handbook says orientation is on Monday.");
  const context = getLatestDocument(conversation.id);
  const prompt = knowledgePrompt("When is orientation?", context.extractedText);
  assert.match(prompt.prompt, /The sample handbook says orientation is on Monday/);
});

function createTestConversation() {
  return createConversation("Document context test");
}

test("creates, reads, and deletes a conversation", async () => {
  const createResponse = await request("/api/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Test conversation" }),
  });

  assert.equal(createResponse.status, 201);
  const { conversation } = await createResponse.json();
  assert.equal(conversation.title, "Test conversation");
  assert.deepEqual(conversation.messages, []);

  const readResponse = await request(`/api/conversations/${conversation.id}`);
  assert.equal(readResponse.status, 200);
  assert.equal((await readResponse.json()).conversation.id, conversation.id);

  const deleteResponse = await request(`/api/conversations/${conversation.id}`, {
    method: "DELETE",
  });
  assert.equal(deleteResponse.status, 204);

  const missingResponse = await request(`/api/conversations/${conversation.id}`);
  assert.equal(missingResponse.status, 404);
});

test("reports missing AI configuration after extracting PDF text", async () => {
  const originalApiKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  try {
    const response = await request("/api/documents", {
      method: "POST",
      body: pdfUpload({ content: textPdf }),
    });

    test("does not expose a Gemini key in the environment template", async () => {
      const environmentTemplate = await import("node:fs/promises").then((fs) =>
        fs.readFile(new URL("../.env.example", import.meta.url), "utf8"),
      );

      assert.match(environmentTemplate, /GEMINI_API_KEY=your_gemini_api_key_here/);
      assert.doesNotMatch(environmentTemplate, /GEMINI_API_KEY=AQ\./);
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

test("rejects document uploads without a file", async () => {
  const response = await request("/api/documents", {
    method: "POST",
    body: new FormData(),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Please upload a PDF document.",
  });
});

test("rejects document uploads with the wrong field name", async () => {
  const form = new FormData();
  form.append(
    "wrong",
    new Blob(["%PDF-1.7"], { type: "application/pdf" }),
    "document.pdf",
  );

  const response = await request("/api/documents", {
    method: "POST",
    body: form,
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'Upload the PDF using the "document" field.',
  });
});

test("rejects non-PDF document uploads", async () => {
  const response = await request("/api/documents", {
    method: "POST",
    body: pdfUpload({ filename: "notes.txt", content: "plain text" }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Only PDF files are supported.",
  });
});

test("rejects files that are not PDF content", async () => {
  const response = await request("/api/documents", {
    method: "POST",
    body: pdfUpload({ content: "not a PDF" }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "The uploaded file is not a readable PDF document.",
  });

  test("rejects PDF files that cannot be parsed", async () => {
    const response = await request("/api/documents", {
      method: "POST",
      body: pdfUpload({ content: "%PDF-1.7" }),
    });

    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), {
      error:
        "The uploaded PDF could not be read. Please provide a valid text-based PDF.",
    });
  });
});

test("rejects PDF uploads larger than 5 MB", async () => {
  const response = await request("/api/documents", {
    method: "POST",
    body: pdfUpload({ content: `%PDF-${"a".repeat(5 * 1024 * 1024)}` }),
  });

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    error: "PDF files must be 5 MB or smaller.",
  });
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
