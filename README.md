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
- Backend-controlled configurable bad-language filtering.
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

For local development, use `AUTH_EMAIL_MODE=console` only to verify that email
delivery is intentionally disabled. It does not send or print OTPs. To use
the application, configure SMTP delivery even when testing locally:

```env
AUTH_EMAIL_MODE=smtp
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_smtp_username
SMTP_PASSWORD=your_smtp_password
SMTP_FROM=assistant@example.com
```

SMTP credentials stay in the backend `.env` file and must never be committed
or placed in React/Vite variables. The backend waits for Nodemailer to receive
the message and reports success only when the SMTP server accepts the
recipient. It returns a safe error for missing configuration, rejection, or
timeout. Use a test mailbox/provider while developing.

Optional frontend API configuration:

```env
VITE_API_URL=http://localhost:3001/api/chat
```

`VITE_API_URL` is optional and defaults to the value above. The document
endpoint is currently at `http://localhost:3001/api/documents`.

The conversation database is created automatically at
`server/data/assistant.db`. This local file is ignored by Git. It contains
conversation titles and messages for this local prototype. Conversations are
filtered by the verified user's session on every history, chat, and document
route.

Conversations now belong to the verified email user. OTP codes are stored only
as hashes, expire after 10 minutes, allow at most five attempts, and have a
resend cooldown. Session tokens are stored as hashes in SQLite and sent to the
browser through an HTTP-only cookie. This remains a local prototype: it has no
production email provider or account-recovery workflow.

The files in `knowledge/` are demonstration data only. They are not official
GAIL policies, calendars, or IT procedures. The assistant names relevant
source files in its response and recommends checking official internal sources
when the demonstration knowledge base does not contain an answer.

Chat messages are checked by a small backend dictionary after normalization
before they are sent to an AI provider. This is a basic configurable filter,
not a complete moderation or safety system.

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

## macOS desktop application

Build the Apple Silicon DMG from macOS:

```bash
npm run desktop:package
```

The installer is created under `dist/`. The packaged application loads the
Vite build locally and starts the Express backend itself. It stores the
SQLite database in Electron's per-user application-data directory and reads
knowledge files from the application bundle.

Credentials are never bundled. For a packaged app to use Gemini and SMTP,
copy a private `.env` file to the application's user-data directory shown by
Electron for `app.getPath("userData")`, then restart the app. The file should
contain the same backend variables as the development `.env`. Without that
file, the packaged UI can open but AI replies and SMTP OTP delivery report
configuration errors.

The unsigned development DMG may require right-clicking the app and choosing
**Open** in macOS Security & Privacy settings. Production distribution should
use an Apple Developer signing identity and notarization.

For authentication:

1. Enter an email address in the browser.
2. Click **Send code**.
3. Open the configured mailbox and locate the verification email.
4. Enter the six-digit code in the browser.
5. Use the history sidebar, chat, and PDF controls after verification.
6. Use **Sign out** to clear the session cookie.

## API and manual checks

Check backend health:

```bash
curl http://localhost:3001/api/health
```

Expected response:

```json
{"status":"ok"}
```

Send a chat message after authenticating and include the session cookie and,
when using an existing conversation, its ID:

```bash
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -H "Cookie: iea_session=YOUR_SESSION_COOKIE" \
  -d '{"conversationId":"YOUR_CONVERSATION_ID","message":"Explain enterprise AI in one sentence."}'
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

Run the repeatable five-user local concurrency test:

```bash
npm run load-test
```

The load test sends 10 conversation-list requests for each of five parallel
users against a temporary SQLite database. It reports total requests,
successful and failed requests, average latency, p95 latency, and requests
over five seconds. It does not call Gemini, so it measures local API and
database behavior rather than external provider latency.

The test suite covers health checks, OTP delivery and verification, protected
routes, session invalidation, user isolation, chat validation, missing Gemini
configuration, malformed and oversized JSON, PDF type/signature/size checks,
conversation creation and deletion, missing upload fields, environment-template
safety, and unknown routes.

The concurrency measurement is separate from the functional test suite:

```bash
npm run load-test
```

It measures local API/database requests only. It does not prove that an
external Gemini or email provider will respond within five seconds.

## Known limitations

- A live Gemini response requires a valid `GEMINI_API_KEY`; automated tests do
  not call the external Gemini service.
- Uploaded PDFs are held in memory for the request and are discarded after the
  response. Extracted text is retained in the local SQLite database for
  follow-up questions and should be treated as local prototype data.
- `knowledge/demo-employee-handbook.pdf` is an eight-page demonstration PDF,
  not an official GAIL document.
- OTP delivery requires a configured SMTP provider. The `console` mode does
  not disclose OTPs and intentionally cannot complete email authentication.
- Hugging Face is not integrated. The current AI provider is Gemini.
- There is no multi-agent workflow.
