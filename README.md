
An offline-capable enterprise chatbot for a large public sector organisation.
It answers employee questions about HR policy, IT support, company events, and
general workplace processes, analyses uploaded documents, filters abusive
language, and protects access with an email second factor.
The project runs with **no paid services and no API keys**. A Google Gemini key
and an SMTP account are optional upgrades.
> **Demonstration data.** Everything under `knowledge/` is sample material
> written for this project. It is **not** official GAIL policy, an official
> events calendar, or an official IT procedure. Real deployments must replace it
> with reviewed organisational content.
---
## How the requirements are addressed
| Requirement | Where it lives | How it works |
| --- | --- | --- |
| Understand employee questions | `server/retrieval.js`, `server/localAssistant.js`, `server/assistant.js` | BM25 retrieval with domain synonyms, intent classification, grounded answer composition. Optional Gemini transformer for open-ended phrasing. |
| HR, IT, events, general questions | `knowledge/*.md` | Retrieval is scoped to curated source documents; every answer cites its source file. |
| Document analysis and summarization | `server/summarize.js`, `server/index.js` | PDF/TXT/MD/CSV text extraction, TF-weighted extractive summarization, RAKE keyword extraction, document-scoped Q&A. |
| Minimum 5 parallel users | `scripts/load-test.js` | Five authenticated users run authentication, document upload, and chat concurrently. |
| Response time under 5 seconds | `server/assistant.js`, `server/async.js` | Local answers in milliseconds; external calls are capped at 4 s and fall back to the local engine. |
| Two-factor authentication (email) | `server/email.js`, `server/index.js` | Six-digit, hash-stored, expiring, attempt-limited codes; HTTP-only session cookie. |
| Bad language filtering | `server/moderation.js`, `knowledge/moderation-dictionary.json` | System-maintained dictionary, leetspeak normalisation, English + Hindi/Hinglish, input **and** output filtering. |
| Free and open source only | `package.json` | Express, React, Vite, SQLite, pdf-parse, nodemailer, badwords-list — all permissively licensed. |
---
## Architecture
```text
Browser (React + Vite)
   │  HTTP-only session cookie
   ▼
Express API (server/index.js)
   ├── Authentication      server/email.js, server/database.js
   ├── Moderation          server/moderation.js + knowledge/moderation-dictionary.json
   ├── Retrieval           server/retrieval.js      (BM25, synonyms, chunking)
   ├── Answering           server/localAssistant.js  (intent + grounded composition)
   │                       server/assistant.js      (Gemini optional, local fallback)
   ├── Documents           server/summarize.js       (extractive summary + RAKE)
   └── Storage             SQLite (better-sqlite3)
```
### Why there are two answer paths
| Mode | Trigger | Behaviour | Latency |
| --- | --- | --- | --- |
| `local-nlp` | default, or no API key | BM25 retrieval + extractive answering. Fully offline and deterministic. | ~5–30 ms |
| `gemini` | `GEMINI_API_KEY` set and `AI_PROVIDER=auto\|gemini` | Prompt includes retrieved sources, document text, and recent turns. Falls back to `local-nlp` on error or timeout. | typically 1–3 s, capped at 4 s |
The local path is not a neural model. It is classical information retrieval and
natural language processing: BM25 ranking, stemmed term matching, synonym
expansion, intent classification, sentence scoring, and RAKE keyword extraction.
The deep-learning component is the optional Gemini transformer. This split is
deliberate: it makes the five-second requirement provable without a GPU and
keeps the demo working when the network or a quota fails.
---
## Requirements
- Node.js 18 or newer (developed on Node 24)
- Nothing else. No API key, SMTP account, or external database is required.
## Quick start
```bash
npm install
npm run server     # terminal 1 -> http://localhost:3001
npm run client     # terminal 2 -> http://localhost:5173
```
1. Enter any email address (for example `employee@example.com`).
2. Click **Send code**. In development the code is printed to the server console
   **and** shown in the browser, and it is filled in automatically.
3. Click **Verify code**.
4. Ask a question or upload a document.
No `.env` file is needed for the flow above. Copy `.env.example` to `.env` only
when you configure Gemini, SMTP, or custom paths.
### Verification commands
```bash
npm test           # 57 automated tests
npm run build      # production frontend bundle
npm run load-test  # 5-user concurrency and latency measurement
npm run demo:handbook  # regenerate the demo PDF
```
---
## Configuration
All settings are optional and read from `.env` on the backend only.
| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | `auto` | `auto`, `local`, or `gemini`. |
| `GEMINI_API_KEY` | _(unset)_ | Enables the Gemini answer path. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model name for chat and document summaries. |
| `AI_TIMEOUT_MS` | `4000` | Per-call provider cap (hard-limited to 4500 ms). |
| `AUTH_EMAIL_MODE` | `console` | `console` (development only) or `smtp`. |
| `IEA_DEV_OTP` | `true` | Set `false` to disable the development code display. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | — | SMTP connection. |
| `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | — | SMTP credentials and sender. |
| `PORT` | `3001` | API port. |
| `DATABASE_PATH` | `server/data/assistant.db` | SQLite location. |
| `IEA_KNOWLEDGE_DIR` | `./knowledge` | Knowledge and dictionary directory. |
| `VITE_API_URL` | `http://localhost:3001/api/chat` | Frontend API base. |
| `CORS_ORIGIN` | _(unset)_ | Comma-separated allowed browser origins. Unset reflects any origin (development only). |
Secrets stay in the backend `.env`. Never place `GEMINI_API_KEY` or SMTP
credentials in a `VITE_*` variable, because those are compiled into the bundle.
### Enabling real email 2FA
```env
AUTH_EMAIL_MODE=smtp
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_username
SMTP_PASSWORD=your_app_password
SMTP_FROM=assistant@yourdomain.com
```
The backend waits for the SMTP server to accept the recipient and returns a safe
error on rejection or timeout. It never reports success for an undelivered code.
---
## Authentication and 2FA
The email code is the **second factor**. It is the factor the application itself
verifies, and it is deliberately short-lived and single-use:
- Six digits, generated with `crypto.randomInt`.
- Stored only as a SHA-256 hash.
- Expires after 10 minutes; five attempts maximum.
- 60-second resend cooldown per address.
- Compared with `timingSafeEqual`.
- Session tokens are random 32-byte values, stored as hashes, delivered as an
  `HttpOnly`, `SameSite=Lax` cookie, and marked `Secure` in production.
**Development shortcut.** With `AUTH_EMAIL_MODE=console` the code is printed to
the server console and returned to the browser so reviewers can complete the
flow without an inbox. This is safe because it is hard-blocked when
`NODE_ENV=production`, and it can be disabled with `IEA_DEV_OTP=false`. A
production deployment must use `AUTH_EMAIL_MODE=smtp`.
A full production design would add a first factor (password or SSO) in front of
this email code. The current prototype is passwordless, which is one factor at
the password layer plus the verified email challenge. This is stated explicitly
so the security property is not overstated.
---
## Document processing
Supported: **PDF, TXT, MD, CSV**, up to 5 MB. Files are held in memory for the
request and never written to disk; only the extracted text is stored with the
conversation.
Pipeline:
1. Validate type, size, and the `%PDF-` signature for PDFs.
2. Extract text. Page markers (`-- 1 of 8 --`, `page N of M`) are removed.
3. Rebuild paragraphs from hard-wrapped lines so sentences are not split.
4. Summarize extractively (TF-weighted sentence ranking with position and
   emphasis bonuses) and extract keywords with RAKE.
5. Attach the text to the conversation so follow-up questions are grounded.
`knowledge/demo-employee-handbook.pdf` is a generated ten-page sample covering
attendance, leave, pay, IT support, security, conduct, travel, and learning. It
is produced by `scripts/generate-demo-handbook.mjs`, so the demo is reproducible
and the content is reviewable in source form.
Scanned PDFs without a text layer are rejected with a clear OCR message rather
than returning an empty summary.
---
## Moderation
Two layers:
1. **Input** — `POST /api/chat` rejects a message before it reaches any provider.
2. **Output** — assistant replies are masked, so a model cannot echo abuse back.
The dictionary is `knowledge/moderation-dictionary.json`, maintained by the
application owner. It has categorised entries (`profanity`,
`indian-language-profana`, `insult`, `harassment`, `hate`) with severities, and
it is merged with the MIT-licensed `badwords-list` baseline.
Behaviour worth knowing:
- Whole-word and whole-phrase matching, so `assistant`, `class`, and `analysis`
  are never blocked.
- Normalisation handles case, accents, punctuation, and common leetspeak
  (`sh!t`, `b1tch`, `@ss`).
- Hindi and Hinglish are supported in both Devanagari and Latin script.
- Clinical and policy terms (`sexual harassment`, `harassment`, `gender`) are
  explicitly allowed, because blocking legitimate HR questions would be a worse
  failure than missing an insult.
- A missing or malformed dictionary degrades to the baseline list instead of
  crashing the service.
To extend it, add lowercase terms to the JSON file and restart the server.
---
## Measured performance
`npm run load-test` runs five authenticated users concurrently, each performing
a document upload, five chat requests, and a history listing, then verifies
ownership isolation (including cross-user reads returning `404`).
A representative local run:
```json
{
  "users": 5,
  "requests": 35,
  "chatRequests": 25,
  "documentUploads": 5,
  "successful": 35,
  "failed": 0,
  "averageMs": 19.6,
  "p95Ms": 83.04,
  "chatP95Ms": 24.39,
  "maxMs": 95.36,
  "wallClockMs": 142.17,
  "overFiveSeconds": 0,
  "isolationPassed": true
}
```
These numbers measure this application on the machine that ran the test. They do
not claim provider-side latency. When `AI_PROVIDER=gemini`, a slow provider is
capped at 4 s and the request is answered by the local engine, so the five-second
budget holds; that fallback path is exercised by the unit tests.
---
## API
| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Status, active provider, uptime. |
| `GET` | `/api/config` | Provider, email mode, limits. No secrets. |
| `POST` | `/api/auth/request-code` | Send (or, in development, display) the code. |
| `POST` | `/api/auth/verify-code` | Verify the code and start a session. |
| `POST` | `/api/auth/logout` | Invalidate the session. |
| `GET` | `/api/auth/me` | Current user. |
| `GET` | `/api/conversations` | List the caller's conversations. |
| `POST` | `/api/conversations` | Create a conversation. |
| `GET` | `/api/conversations/:id` | Read one conversation and its messages. |
| `DELETE` | `/api/conversations/:id` | Delete one conversation. |
| `POST` | `/api/documents` | Upload and analyse a document (multipart `document`). |
| `POST` | `/api/chat` | Ask a question. |
Chat response:
```json
{
  "conversationId": "…",
  "reply": "…",
  "sources": ["demo-hr-policy.md"],
  "provider": "local-nlp",
  "intent": { "id": "hr", "label": "HR and leave" },
  "confidence": 0.84,
  "latencyMs": 6.1
}
```
Every route is scoped to the verified user. A conversation that belongs to
someone else returns `404`, not `403`, so IDs cannot be probed.
### Manual checks
```bash
curl http://localhost:3001/api/health
curl -X POST http://localhost:3001/api/auth/request-code \
  -H "Content-Type: application/json" \
  -d '{"email":"employee@example.com"}'
curl -c cookies.txt -X POST http://localhost:3001/api/auth/verify-code \
  -H "Content-Type: application/json" \
  -d '{"email":"employee@example.com","code":"123456"}'
curl -b cookies.txt -X POST http://localhost:3001/api/conversations \
  -H "Content-Type: application/json" -d '{"title":"Demo"}'
curl -b cookies.txt -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"conversationId":"YOUR_ID","message":"How do I apply for leave?"}'
```
---
## Tests
```bash
npm test
```
`server/index.test.js` covers the HTTP surface; `server/nlp.test.js` covers
retrieval, summarization, intent classification, and moderation directly.
Coverage includes:
- health, configuration, and unknown routes;
- OTP delivery success, missing SMTP, SMTP rejection, SMTP timeout, cooldown,
  attempt limits, session invalidation, and production refusal of the dev code;
- user isolation for read, delete, document upload, and cross-user access;
- PDF type, signature, parse, empty-text, and size validation;
- text/markdown uploads and offline summarization;
- document-scoped follow-up questions;
- English, Hindi, and Hinglish moderation plus false-positive allowlisting;
- local answering, intent classification, and source citation;
- the four-question latency budget;
- malformed JSON, oversized bodies, and oversized messages.
Tests force `AI_PROVIDER=local`, so they never call an external service.
---
## macOS desktop build
```bash
npm run desktop:package
```
This builds the Vite bundle and produces an Apple Silicon DMG under `dist/`. The
packaged app starts its own backend, stores SQLite in Electron's user-data
directory, and reads `knowledge/` from the bundle. Credentials are never
bundled: put an optional `.env` in the app's `userData` directory to enable
Gemini or SMTP. Without it, the app runs fully offline.
The DMG is unsigned. Production distribution needs an Apple Developer identity
and notarisation.
---
## Three-minute demo script
1. **0:00–0:30 — Sign in with 2FA.** Enter an email, click *Send code*, point
   out that the code is auto-filled in development mode, then verify. Mention
   that `AUTH_EMAIL_MODE=smtp` delivers the same code by email and that the
   development shortcut is refused in production.
2. **0:30–1:20 — Grounded employee chat.** Ask "How do I apply for leave?" and
   "My laptop will not connect to wifi". Point out the intent, the cited source
   file, and the response-time chip under the message.
3. **1:20–2:05 — Document analysis.** Upload
   `knowledge/demo-employee-handbook.pdf`. Show the ten-page detection, the
   summary, the keyword chips, and the word count. Then ask "Summarize this
   document" and a follow-up such as "What does it say about two-factor
   authentication?".
4. **2:05–2:35 — Moderation.** Send "This is sh!t" and show the polite refusal;
   send a Hindi phrase and show that Hindi abuse is also caught, then show that
   a legitimate harassment-policy question is *not* blocked.
5. **2:35–3:00 — Scale and safety.** Run `npm run load-test` and read the JSON:
   five users, zero failures, p95 under five seconds, isolation passed. Note that
   an unavailable AI provider degrades to the offline engine instead of failing.
---
## Known limitations
- The offline answer path is classical NLP, not a trained neural retriever. It is
  strong on the curated knowledge base and weaker on open-ended paraphrasing.
  Gemini improves that when configured.
- The seven knowledge documents are demonstration data and cover a narrow
  question set. A real deployment needs reviewed HR, IT, and events content.
- Concurrency was verified with five parallel users. The architecture (stateless
  HTTP, SQLite WAL-capable, no in-process session state) allows more, but
  horizontal scale-out needs a shared database or sticky sessions.
- SQLite is a single-node store. It is appropriate for a prototype and a small
  office, not for a multi-node production cluster.
- Document text extraction does not perform OCR; scanned PDFs are rejected with
  guidance.
- The email code is the only application-level factor, so the prototype is
  passwordless rather than a full password + email 2FA.
- The moderation dictionary is curated, not exhaustive. It reduces risk; it is
  not a complete content-safety system.
- The desktop DMG is unsigned.
- There is no fine-tuned or self-hosted model; the neural component is the
  optional hosted Gemini API.
## Repository layout
```text
server/
  index.js                  Express API, routes, validation
  assistant.js              provider selection, fallback, timing
  localAssistant.js         intent classification, answer composition
  retrieval.js              BM25 index, synonyms, chunking
  summarize.js              extractive summarization, RAKE keywords
  text.js                   tokenization, stemming, prose normalisation
  moderation.js             dictionary filtering and censoring
  email.js                  SMTP and development OTP delivery
  database.js               SQLite schema and queries
  async.js                  timeout helper
  index.test.js             API and integration tests
  nlp.test.js               retrieval, summarization, moderation units
knowledge/                  demonstration content + moderation dictionary
scripts/                    load test, handbook generator
src/                        React interface
desktop/                    Electron wrapper
```