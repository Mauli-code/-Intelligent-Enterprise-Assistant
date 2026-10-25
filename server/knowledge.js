import { searchKnowledge } from "./retrieval.js";

// Prompt assembly for the optional LLM path. Retrieval itself lives in
// `retrieval.js` (BM25); this module only decides what text the model sees.

const DEMONSTRATION_NOTICE =
  "The documents below are demonstration data, not official GAIL policy.";

/**
 * Rank demonstration knowledge for a question.
 * Returns `{ name, text, score }` best-first, matching the historical shape
 * used by the API responses.
 */
export function findKnowledgeSources(question, limit = 2) {
  return searchKnowledge(question, limit).map((match) => ({
    name: match.source,
    text: match.text,
    score: match.score,
  }));
}

function historyBlock(history = []) {
  const recent = history.slice(-6);
  if (recent.length === 0) return "";

  const lines = recent.map(
    (message) =>
      `${message.role === "user" ? "Employee" : "Assistant"}: ${message.content}`,
  );
  return `RECENT CONVERSATION (for context only):\n${lines.join("\n")}\n\n`;
}

/**
 * Build the full LLM prompt: retrieved knowledge, uploaded document text,
 * recent conversation, and the question.
 */
export function buildPrompt({ question, document = null, history = [] }) {
  const sources = findKnowledgeSources(question);
  const sourceText = sources
    .map((source) => `SOURCE: ${source.name}\n${source.text}`)
    .join("\n\n");

  const knowledgeBlock = sourceText
    ? `${DEMONSTRATION_NOTICE} Use them when relevant. If they do not answer the question, say so and recommend the official internal source. Do not invent company rules.\n\n${sourceText}`
    : "The demonstration knowledge base has no relevant source for this question.";

  const documentBlock = document
    ? `UPLOADED DOCUMENT (${document.filename}):\n${String(document.text).slice(0, 100000)}\n\nUse the uploaded document to answer follow-up questions when it is relevant.`
    : "";

  const sections = [knowledgeBlock, documentBlock, historyBlock(history)].filter(
    Boolean,
  );

  return `${sections.join("\n\n")}\n\nAnswer as a concise, professional workplace assistant. Use short paragraphs or bullet points.\n\nEMPLOYEE QUESTION:\n${question}`;
}

/** Backwards-compatible helper retained for existing callers and tests. */
export function knowledgePrompt(question, documentText = "", options = {}) {
  const sources = findKnowledgeSources(question);
  const document = documentText
    ? { filename: options.filename || "uploaded-document", text: documentText }
    : null;

  return {
    sources: sources.map((source) => source.name),
    prompt: buildPrompt({
      question,
      document,
      history: options.history || [],
    }),
  };
}
