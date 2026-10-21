# Intelligent Enterprise Assistant

A React frontend and Express backend for an AI chat assistant powered by Gemini.

## Requirements

- Node.js 18 or newer
- A Gemini API key for assistant replies

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local environment file:

   ```bash
   cp .env.example .env
   ```

3. Open `.env` and replace `your_gemini_api_key_here` with your Gemini API key.
   Keep `.env` private; it is ignored by Git.

## Run the application

Use two terminals from the project folder.

In terminal 1, start the backend:

```bash
npm run server
```

The API runs at `http://localhost:3001`.

In terminal 2, start the React development server:

```bash
npm run client
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

The frontend sends chat requests to the URL in `VITE_API_URL`. The default is
`http://localhost:3001/api/chat`.

## Checks and manual testing

Run the automated backend tests:

```bash
npm test
```

Build the frontend for production:

```bash
npm run build
```

Check that the backend is running:

```bash
curl http://localhost:3001/api/health
```

Expected response:

```json
{"status":"ok"}
```

In the browser, send a short message to test the Gemini integration. Also try
an empty message and a message longer than 1000 characters to verify validation
errors are shown.