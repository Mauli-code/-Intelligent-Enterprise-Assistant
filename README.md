# Intelligent Enterprise Assistant

A small React and Express application for chatting with Google Gemini,
validating PDF uploads, and storing local conversation history. The project is
intentionally simple and suitable for learning full-stack request handling.

## Current features

- Text chat through Google Gemini using the official `@google/genai` SDK.
- Backend validation for empty and oversized chat messages.
- Loading, empty, error, and retry states in the chat interface.
- Safe PDF upload validation:
  - PDF extension and MIME type are required.
  - The file must begin with the PDF `%PDF-` signature.
  - Files are limited to 5 MB.
  - Uploads are kept in memory and are not saved to disk.
- JSON error responses for invalid requests, missing configuration, and
  oversized request bodies.
- Persistent local conversation history backed by SQLite.

PDF text extraction and Gemini document summarization are not implemented yet.
The current document endpoint validates a PDF and returns basic file metadata
only; it does not claim to read or summarize document contents.

## Technology stack

- React 18 and React DOM
- Vite
- Express
- Multer for in-memory multipart upload handling
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

Upload a PDF for validation:

```bash
curl -X POST http://localhost:3001/api/documents \
  -F "document=@sample.pdf"
```

The upload response contains the filename, size, and validation status, not
the document contents.

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
- PDF upload is validation-only. The application does not currently extract
  PDF text or summarize uploaded documents.
- Uploaded PDFs are held in memory for the request and are discarded after the
  response.
- This local database has no authentication, so it is suitable only for one
  local user. It should not be exposed as a shared service.
- There is no multi-agent workflow.
- The frontend currently provides chat controls but does not yet include a PDF
  upload control.
