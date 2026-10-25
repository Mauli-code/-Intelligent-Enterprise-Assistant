import fs from "node:fs";
import path from "node:path";
import { stem, tokenize } from "./text.js";

// A compact BM25 implementation (the standard lexical ranking function used by
// search engines such as Lucene and Elasticsearch). It gives the assistant real
// information-retrieval behaviour instead of naive "how many keywords overlap"
// counting, and it runs entirely offline.

const K1 = 1.5;
const B = 0.75;

// Domain synonyms let an employee ask "vacation" or "chhutti" and still match a
// policy that talks about "leave". Values expand the query, not the document.
const SYNONYMS = new Map(
  Object.entries({
    leave: ["vacation", "holiday", "absence", "chhutti", "off"],
    vacation: ["leave", "holiday", "absence"],
    holiday: ["leave", "vacation", "festival"],
    salary: ["pay", "payroll", "compensation", "wages"],
    payroll: ["salary", "pay", "compensation"],
    password: ["login", "signin", "credential", "reset"],
    login: ["password", "signin", "access", "account"],
    laptop: ["device", "computer", "desktop", "hardware"],
    wifi: ["network", "internet", "connectivity"],
    vpn: ["network", "remote", "access"],
    email: ["mail", "mailbox", "inbox"],
    event: ["calendar", "workshop", "programme", "program"],
    workshop: ["event", "training", "session"],
    training: ["workshop", "learning", "course"],
    onboarding: ["induction", "joining", "orientation"],
    transfer: ["posting", "relocation", "mobility"],
    medical: ["health", "hospital", "sick"],
    reimbursement: ["claim", "expense", "bills"],
    expense: ["reimbursement", "claim", "bills"],
    attendance: ["presence", "shift", "timesheet"],
    grievance: ["complaint", "issue", "escalation"],
    harassment: ["complaint", "grievance", "posh"],
    insurance: ["medical", "health", "cover"],
    promotion: ["appraisal", "career", "grade"],
    appraisal: ["promotion", "review", "performance"],
    "2fa": ["otp", "authentication", "verification", "two-factor"],
    otp: ["authentication", "verification", "2fa"],
  }),
);

function expandTerms(tokens) {
  const expanded = new Map();
  for (const token of tokens) {
    expanded.set(token, 1);
    for (const synonym of SYNONYMS.get(token) || []) {
      const stemmed = stem(synonym);
      if (!expanded.has(stemmed)) expanded.set(stemmed, 0.6);
    }
  }
  return expanded;
}

/** Serialize a text into the bag of stemmed terms used for scoring. */
export function indexTerms(text) {
  return tokenize(text).map(stem);
}

export class Bm25Index {
  constructor() {
    this.entries = [];
    this.documentFrequency = new Map();
    this.averageLength = 0;
    this.isFinalized = false;
  }

  add({ id, source, heading = "", text }) {
    const terms = indexTerms(`${heading} ${text}`.trim());
    if (terms.length === 0) return this;

    const termFrequency = new Map();
    for (const term of terms) {
      termFrequency.set(term, (termFrequency.get(term) || 0) + 1);
    }

    this.entries.push({
      id,
      source,
      heading,
      text,
      termFrequency,
      length: terms.length,
    });
    this.isFinalized = false;
    return this;
  }

  finalize() {
    this.documentFrequency = new Map();
    let totalLength = 0;

    for (const entry of this.entries) {
      totalLength += entry.length;
      for (const term of entry.termFrequency.keys()) {
        this.documentFrequency.set(
          term,
          (this.documentFrequency.get(term) || 0) + 1,
        );
      }
    }

    this.averageLength =
      this.entries.length > 0 ? totalLength / this.entries.length : 0;
    this.isFinalized = true;
    return this;
  }

  idf(term) {
    const total = this.entries.length;
    const frequency = this.documentFrequency.get(term) || 0;
    return Math.log(1 + (total - frequency + 0.5) / (frequency + 0.5));
  }

  search(query, limit = 3) {
    if (!this.isFinalized) this.finalize();
    const queryTerms = expandTerms(indexTerms(query));
    if (queryTerms.size === 0 || this.entries.length === 0) return [];

    const scored = this.entries.map((entry) => {
      let score = 0;
      for (const [term, weight] of queryTerms) {
        const frequency = entry.termFrequency.get(term) || 0;
        if (frequency === 0) continue;
        const normalization =
          frequency +
          K1 * (1 - B + (B * entry.length) / (this.averageLength || 1));
        score += weight * this.idf(term) * ((frequency * (K1 + 1)) / normalization);
      }
      return { ...entry, score };
    });

    return scored
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }
}

/**
 * Split a long document into overlapping-ish sections so a single chunk does
 * not average away every signal. Markdown headings are used when present.
 */
export function chunkText(text, { maxCharacters = 900 } = {}) {
  const normalized = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  const sections = [];
  let heading = "";
  let buffer = [];

  const flush = () => {
    const body = buffer.join("\n").trim();
    buffer = [];
    if (!body) return;

    if (body.length <= maxCharacters) {
      sections.push({ heading, text: body });
      return;
    }

    // Long section: break on paragraph edges, then hard-split as a last resort.
    let current = "";
    for (const paragraph of body.split(/\n{2,}/)) {
      if ((current + paragraph).length > maxCharacters && current) {
        sections.push({ heading, text: current.trim() });
        current = "";
      }
      current += `${paragraph}\n\n`;
    }
    if (current.trim()) sections.push({ heading, text: current.trim() });
  };

  for (const line of normalized.split("\n")) {
    const headingMatch = /^#{1,6}\s+(.*)$/.exec(line.trim());
    if (headingMatch) {
      flush();
      heading = headingMatch[1].trim();
      continue;
    }
    buffer.push(line);
  }
  flush();

  return sections.length > 0 ? sections : [{ heading: "", text: normalized }];
}

const knowledgeDirectory =
  process.env.IEA_KNOWLEDGE_DIR || path.join(process.cwd(), "knowledge");

let cachedKnowledgeIndex;

/** Read the Markdown knowledge base and build a searchable index once. */
export function knowledgeIndex() {
  if (cachedKnowledgeIndex) return cachedKnowledgeIndex;

  const index = new Bm25Index();
  let filenames = [];
  try {
    filenames = fs
      .readdirSync(knowledgeDirectory)
      .filter((filename) => filename.endsWith(".md"))
      .sort();
  } catch {
    filenames = [];
  }

  for (const filename of filenames) {
    const text = fs.readFileSync(path.join(knowledgeDirectory, filename), "utf8");
    chunkText(text).forEach((section, sectionIndex) => {
      index.add({
        id: `${filename}#${sectionIndex}`,
        source: filename,
        heading: section.heading,
        text: section.text,
      });
    });
  }

  index.finalize();
  cachedKnowledgeIndex = index;
  return index;
}

export function resetKnowledgeIndexForTests() {
  cachedKnowledgeIndex = undefined;
}

/**
 * Rank knowledge chunks against a question.
 * Returns `{ source, heading, text, score }` best-first.
 */
export function searchKnowledge(question, limit = 3) {
  return knowledgeIndex()
    .search(question, limit)
    .map(({ source, heading, text, score }) => ({
      source,
      heading,
      text,
      score: Number(score.toFixed(4)),
    }));
}

/** Build a throwaway index for an uploaded document so follow-ups work. */
export function searchDocument(documentText, question, limit = 3) {
  const index = new Bm25Index();
  chunkText(documentText, { maxCharacters: 900 }).forEach((section, i) => {
    index.add({
      id: `document#${i}`,
      source: "uploaded-document",
      heading: section.heading,
      text: section.text,
    });
  });
  index.finalize();
  return index
    .search(question, limit)
    .map(({ heading, text, score }) => ({
      heading,
      text,
      score: Number(score.toFixed(4)),
    }));
}
