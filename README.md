# Intelligent Enterprise Assistant

A small React and Express application for chatting with Google Gemini,
validating PDF uploads, and storing local conversation history. The project is
intentionally simple and suitable for learning full-stack request handling.

## Current features

- Text chat through Google Gemini using the official `@google/genai` SDK.
- Backend validation for empty and oversized chat messages.
- Loading, empty, error, and retry states in the chat interface.
- PDF upload and summarization:
  - PDF extension and MIME type are required.
  - The file must begin with the PDF `%PDF-` signature.
  - Files are limited to 5 MB.
  - Uploads are kept in memory and are not saved to disk.
  - Selectable text is extracted and summarized with Gemini.
  - Scanned PDFs without selectable text report that OCR is required.
- JSON error responses for invalid requests, missing configuration, and
  oversized request bodies.
- Persistent local conversation history backed by SQLite.
- Development email OTP verification with hashed, expiring codes and sessions.
- Demonstration HR, IT-support, and company-events knowledge with source
  references.

## Technology stack

- React 18 and React DOM
- Vite
- Express
- Multer for in-memory multipart upload handling
- pdf-parse for PDF text extraction
- better-sqlite3 for local conversation history
- Google `@google/genai` SDK
- Node.js built-in test runner

## Project structure

```text
.
├── server/
│   ├── index.js       # Express API and Gemini integration
│   ├── database.js     # SQLite schema and conversation queries
│   └── index.test.js  # Backend API and validation tests
├── knowledge/          # Clearly labeled demonstration documents
├── src/
│   ├── App.jsx        # React chat interface
│   ├── main.jsx       # React entry point
│   └── styles.css     # Interface styles
├── .env.example       # Environment variable template
├── index.html         # Vite HTML entry point
├── package.json       # Scripts and dependencies
└── README.md
```

## Requirements

- Node.js 18 or newer
- A Google Gemini API key for live assistant replies

## Installation

From the project directory:

```bash
npm install
cp .env.example .env
```

Edit `.env` and add your key:

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

Keep this file private. It is excluded by `.gitignore` and is read only by
the backend. Do not put `GEMINI_API_KEY` in React code or in a `VITE_*`
variable.

For local development, set `AUTH_EMAIL_MODE=console`. The backend prints the
short-lived OTP to its terminal instead of sending email. This is not
production email delivery. Production should use a configured email provider,
secure cookies, HTTPS, and provider-specific credentials.

Optional frontend API configuration:

```env
VITE_API_URL=http://localhost:3001/api/chat
```

`VITE_API_URL` is optional and defaults to the value above. The document
endpoint is currently at `http://localhost:3001/api/documents`.

The conversation database is created automatically at
`server/data/assistant.db`. This local file is ignored by Git. It contains
conversation titles and messages for this local prototype and has no
authentication or multi-user access control.

Conversations now belong to the verified email user. OTP codes are stored only
as hashes, expire after 10 minutes, allow at most five attempts, and have a
resend cooldown. Session tokens are stored as hashes in SQLite and sent to the
browser through an HTTP-only cookie. This remains a local prototype: it has no
production email provider or account-recovery workflow.

The files in `knowledge/` are demonstration data only. They are not official
GAIL policies, calendars, or IT procedures. The assistant names relevant
source files in its response and recommends checking official internal sources
when the demonstration knowledge base does not contain an answer.

## Run the application

Use two terminals from the project directory.

Terminal 1, start the backend:

```bash
npm run server
```

The API listens on `http://localhost:3001`.

Terminal 2, start the frontend:

```bash
npm run client
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

## API and manual checks

Check backend health:

```bash
curl http://localhost:3001/api/health
```

Expected response:

```json
{"status":"ok"}
```

Send a chat message:

```bash
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Explain enterprise AI in one sentence."}'
```

Upload a PDF for extraction and summarization from an existing conversation:

```bash
curl -X POST http://localhost:3001/api/documents \
  -F "conversationId=YOUR_CONVERSATION_ID" \
  -F "document=@knowledge/demo-employee-handbook.pdf"
```

The upload response contains the filename, size, summary, and important
keywords. Extracted text is saved with the conversation so later chat
questions can use the uploaded document context. Original PDF files are not
stored.

## Tests and build

Run backend tests:

```bash
npm test
```

Create a production frontend build:

```bash
npm run build
```

The test suite covers health checks, chat validation, missing Gemini
configuration, malformed and oversized JSON, PDF type/signature/size checks,
conversation creation and deletion, missing upload fields, and unknown routes.

## Known limitations

- A live Gemini response requires a valid `GEMINI_API_KEY`; automated tests do
  not call the external Gemini service.
- Uploaded PDFs are held in memory for the request and are discarded after the
  response. Extracted text is retained in the local SQLite database for
  follow-up questions and should be treated as local prototype data.
- `knowledge/demo-employee-handbook.pdf` is an eight-page demonstration PDF,
  not an official GAIL document.
- This local database has no authentication, so it is suitable only for one
  local user. It should not be exposed as a shared service.
- There is no multi-agent workflow.
