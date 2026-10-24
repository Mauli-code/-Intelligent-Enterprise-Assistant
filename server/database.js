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

  CREATE INDEX IF NOT EXISTS messages_conversation_id_idx
    ON messages (conversation_id, created_at, id);
`);

export function listConversations() {
  return database
    .prepare(
      `SELECT id, title, created_at AS createdAt, updated_at AS updatedAt
       FROM conversations
       ORDER BY updated_at DESC`,
    )
    .all();
}

export function getConversation(id) {
  const conversation = database
    .prepare(
      `SELECT id, title, created_at AS createdAt, updated_at AS updatedAt
       FROM conversations
       WHERE id = ?`,
    )
    .get(id);

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

export function createConversation(title = "New conversation") {
  const id = randomUUID();
  const timestamp = new Date().toISOString();

  database
    .prepare(
      `INSERT INTO conversations (id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(id, title, timestamp, timestamp);

  return getConversation(id);
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

export function deleteConversation(id) {
  return database
    .prepare("DELETE FROM conversations WHERE id = ?")
    .run(id).changes > 0;
}

export function closeDatabase() {
  database.close();
}
