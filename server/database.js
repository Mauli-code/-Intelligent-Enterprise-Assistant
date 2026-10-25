import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const databasePath =
  process.env.DATABASE_PATH ||
  path.join(process.cwd(), "server", "data", "assistant.db");

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new Database(databasePath);
database.pragma("foreign_keys = ON");
database.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS uploaded_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    extracted_text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS otp_challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_sent_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS messages_conversation_id_idx
    ON messages (conversation_id, created_at, id);

`);
try {
  database.exec("ALTER TABLE conversations ADD COLUMN user_id TEXT");
} catch (error) {
  if (!String(error.message).includes("duplicate column name")) {
    throw error;
  }
}
database.exec(`
  CREATE INDEX IF NOT EXISTS conversations_user_id_updated_at_idx
    ON conversations (user_id, updated_at);
`);

export function listConversations(userId) {
  const query = userId
    ? database.prepare(
      `SELECT id, title, created_at AS createdAt, updated_at AS updatedAt
       FROM conversations
       WHERE user_id = ?
       ORDER BY updated_at DESC`,
    )
    : database.prepare(
        `SELECT id, title, created_at AS createdAt, updated_at AS updatedAt
         FROM conversations ORDER BY updated_at DESC`,
      );
  return userId ? query.all(userId) : query.all();
}

export function getOrCreateUser(email) {
  const existing = database
    .prepare("SELECT id, email FROM users WHERE email = ?")
    .get(email);
  if (existing) return existing;
  const user = { id: randomUUID(), email };
  database
    .prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)")
    .run(user.id, user.email, new Date().toISOString());
  return user;
}

export function saveOtpChallenge(email, codeHash, expiresAt, lastSentAt) {
  database.prepare("DELETE FROM otp_challenges WHERE email = ?").run(email);
  database
    .prepare(
      `INSERT INTO otp_challenges
       (email, code_hash, expires_at, attempts, last_sent_at)
       VALUES (?, ?, ?, 0, ?)`,
    )
    .run(email, codeHash, expiresAt, lastSentAt);
}

export function getOtpChallenge(email) {
  return database
    .prepare("SELECT * FROM otp_challenges WHERE email = ?")
    .get(email);
}

export function incrementOtpAttempts(id) {
  database
    .prepare("UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?")
    .run(id);
}

export function deleteOtpChallenge(id) {
  database.prepare("DELETE FROM otp_challenges WHERE id = ?").run(id);
}

export function createSession(userId, tokenHash, expiresAt) {
  database
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
    )
    .run(tokenHash, userId, expiresAt);
}

export function getSession(tokenHash) {
  return database
    .prepare(
      `SELECT sessions.user_id AS userId, users.email
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    )
    .get(tokenHash, new Date().toISOString());
}

export function deleteSession(tokenHash) {
  database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function getConversation(id, userId) {
  const query = userId
    ? database.prepare(
      `SELECT id, title, created_at AS createdAt, updated_at AS updatedAt
       FROM conversations
       WHERE id = ? AND user_id = ?`,
    )
    : database.prepare(
        `SELECT id, title, created_at AS createdAt, updated_at AS updatedAt
         FROM conversations WHERE id = ?`,
      );
  const conversation = userId ? query.get(id, userId) : query.get(id);

  if (!conversation) {
    return null;
  }

  const messages = database
    .prepare(
      `SELECT id, role, content, created_at AS createdAt
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(id);

  return { ...conversation, messages };
}

export function createConversation(title = "New conversation", userId) {
  const id = randomUUID();
  const timestamp = new Date().toISOString();

  database
    .prepare(
      `INSERT INTO conversations (id, title, user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, title, userId, timestamp, timestamp);

  return getConversation(id, userId);
}

export function addMessage(conversationId, role, content) {
  const timestamp = new Date().toISOString();

  database
    .prepare(
      `INSERT INTO messages (conversation_id, role, content, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(conversationId, role, content, timestamp);

  database
    .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
    .run(timestamp, conversationId);
}

export function updateConversationTitle(id, title) {
  database
    .prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?")
    .run(title, new Date().toISOString(), id);
}

export function deleteConversation(id, userId) {
  return database
    .prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?")
    .run(id, userId).changes > 0;
}

export function saveDocument(conversationId, filename, extractedText) {
  const result = database
    .prepare(
      `INSERT INTO uploaded_documents
       (conversation_id, filename, extracted_text, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(conversationId, filename, extractedText, new Date().toISOString());

  return result.lastInsertRowid;
}

export function getLatestDocument(conversationId) {
  return database
    .prepare(
      `SELECT id, filename, extracted_text AS extractedText
       FROM uploaded_documents
       WHERE conversation_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    )
    .get(conversationId);
}

export function closeDatabase() {
  database.close();
}
