import { searchDocument, searchKnowledge } from "./retrieval.js";
import { summarizeText } from "./summarize.js";
import { isInformative, normalizeProse, splitSentences, stem, tokenize } from "./text.js";

// The offline assistant. It combines intent classification, BM25 retrieval, and
// sentence selection to build a grounded, cited answer. When an LLM is
// configured this module is used as the fallback, which keeps the five-second
// response promise even if the external provider is slow or unavailable.

export const INTENTS = [
  {
    id: "hr",
    label: "HR and leave",
    patterns: [
      "leave", "vacation", "holiday", "salary", "pay", "payroll", "payslip",
      "attendance", "appraisal", "promotion", "transfer", "medical", "insurance",
      "reimbursement", "expense", "hr", "policy", "benefit", "grievance",
      "resignation", "notice period", "maternity", "paternity", "chhutti",
    ],
  },
  {
    id: "it",
    label: "IT support",
    patterns: [
      "login", "log in", "password", "laptop", "desktop", "wifi", "wi-fi",
      "network", "vpn", "printer", "email", "mailbox", "software", "install",
      "access", "account", "reset", "ticket", "laptop", "monitor", "it",
      "antivirus", "phishing", "otp",
    ],
  },
  {
    id: "events",
    label: "Company events",
    patterns: [
      "event", "calendar", "workshop", "training", "session", "orientation",
      "induction", "celebration", "townhall", "town hall", "seminar", "webinar",
      "registration", "programme", "program",
    ],
  },
  {
    id: "general",
    label: "General workplace",
    patterns: [
      "portal", "directory", "contact", "announcement", "notice", "canteen",
      "transport", "parking", "id card", "visitor", "facility", "office",
    ],
  },
];

const GREETING = /^(hi|hello|hey|namaste|namaskar|good\s+(morning|afternoon|evening))\b/i;
const HELP_REQUEST = /\b(help|what can you do|how can you help|capabilities)\b/i;
const DOCUMENT_REFERENCE =
  /\b(document|file|pdf|uploaded|attachment|handbook|summar|this doc|the doc)\b/i;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Short patterns such as "it" and "hr" must match whole words only, otherwise
// "capital" would be classified as an IT question.
const INTENT_MATCHERS = INTENTS.map((intent) => ({
  ...intent,
  matchers: intent.patterns.map(
    (pattern) => new RegExp(`\\b${escapeRegExp(pattern)}\\b`, "i"),
  ),
}));

export function classifyIntent(question) {
  const normalized = String(question || "").toLowerCase();
  let best = { id: "general", label: "General workplace", score: 0 };

  for (const intent of INTENT_MATCHERS) {
    let score = 0;
    for (const matcher of intent.matchers) {
      if (matcher.test(normalized)) score += 1;
    }
    if (score > best.score) best = { id: intent.id, label: intent.label, score };
  }

  return { id: best.id, label: best.label, score: best.score };
}

function cleanHeading(heading) {
  return String(heading || "").replace(/[*_#`]/g, "").trim();
}

function isNoise(sentence) {
  const normalized = sentence.toLowerCase();
  return (
    normalized.includes("demonstration information only") ||
    normalized.startsWith("status:") ||
    // Any "this is not an official ..." style disclaimer, in any phrasing.
    (normalized.includes("official") &&
      (normalized.includes("not ") || normalized.includes("n't"))) ||
    normalized.startsWith("this sample does not define") ||
    normalized.startsWith("this demonstration") ||
    normalized.startsWith("--")
  );
}

function rankSentences(text, question, limit) {
  const queryTerms = new Set(tokenize(question).map(stem));
  const sentences = splitSentences(normalizeProse(text)).filter(
    (sentence) => isInformative(sentence) && !isNoise(sentence),
  );

  const ranked = sentences
    .map((sentence, position) => {
      const terms = tokenize(sentence).map(stem);
      const overlap = terms.filter((term) => queryTerms.has(term)).length;
      const density = terms.length > 0 ? overlap / Math.sqrt(terms.length) : 0;
      return {
        sentence: sentence.replace(/^[-*•]\s*/, "").trim(),
        position,
        score: density + (position === 0 ? 0.05 : 0),
      };
    })
    .sort((left, right) => right.score - left.score || left.position - right.position)
    .slice(0, limit);

  const relevant = ranked.filter(({ score }) => score > 0);
  return (relevant.length > 0 ? relevant : ranked)
    .sort((left, right) => left.position - right.position)
    .map(({ sentence }) => sentence);
}

function bulletList(sentences) {
  return sentences.map((sentence) => `- ${sentence}`).join("\n");
}

function knowledgeAnswer(question, intent) {
  const matches = searchKnowledge(question, 3);
  const strong = matches.filter((match) => match.score > 0.5);

  if (strong.length === 0) {
    return {
      reply: [
        "I could not find this in the demonstration knowledge base.",
        "",
        "I can help with leave and HR policy, IT support, company events, and general workplace questions. For anything authoritative, check the official HR portal, the IT service desk, or your reporting manager.",
      ].join("\n"),
      sources: [],
      confidence: 0,
    };
  }

  const primary = strong[0];
  const sentences = rankSentences(primary.text, question, 3);
  const heading = cleanHeading(primary.heading);
  const sources = [...new Set(strong.map((match) => match.source))];

  const intro = heading
    ? `Here is what the ${heading} says:`
    : `Here is what I found in ${primary.source}:`;

  const followUp =
    intent.id === "hr"
      ? "Leave balances, entitlements, and approvals must be confirmed in the official HR portal."
      : intent.id === "it"
        ? "If the problem continues, raise a ticket with the IT service desk and include the error message and time."
        : "Confirm the details in the official internal source before acting.";

  return {
    reply: [
      intro,
      "",
      bulletList(sentences.length > 0 ? sentences : [primary.text]),
      "",
      followUp,
      "",
      `Source: ${sources.join(", ")}.`,
    ].join("\n"),
    sources,
    confidence: Number(Math.min(1, primary.score / 6).toFixed(2)),
  };
}

function documentAnswer(question, document) {
  const wantsSummary = /\b(summar|overview|gist|tldr|key point|main point|abstract)\b/i.test(
    question,
  );

  const matches = searchDocument(document.text, question, 3);
  const usable = matches.filter((match) => match.score > 0.4);

  if (wantsSummary || usable.length === 0) {
    const summary = summarizeText(document.text, { maxSentences: 5 });
    return {
      reply: [
        `Summary of ${document.filename}:`,
        "",
        summary || "The document does not contain enough selectable text to summarize.",
        "",
        "Ask a follow-up question about this document and I will answer from its text.",
      ].join("\n"),
      sources: [document.filename],
      confidence: usable.length > 0 ? 0.6 : 0.4,
    };
  }

  const best = usable[0];
  const sentences = rankSentences(best.text, question, 3);
  const heading = cleanHeading(best.heading);

  return {
    reply: [
      `From ${document.filename}${heading ? ` (section: ${heading})` : ""}:`,
      "",
      bulletList(sentences.length > 0 ? sentences : [best.text]),
      "",
      `Source: ${document.filename} (uploaded by you).`,
    ].join("\n"),
    sources: [document.filename],
    confidence: Number(Math.min(1, best.score / 6).toFixed(2)),
  };
}

/**
 * Answer a question without any external API.
 * `document` is `{ filename, text }` for the most recent upload, or null.
 */
export function answerLocally({ question, document = null, hasHistory = false }) {
  const intent = classifyIntent(question);

  if (GREETING.test(question.trim()) && question.trim().length < 24) {
    return {
      reply: [
        "Hello. I am the Intelligent Enterprise Assistant.",
        "",
        "Ask me about HR and leave policy, IT support, company events, or general workplace processes. You can also upload a PDF or text document and ask questions about it.",
      ].join("\n"),
      sources: [],
      intent,
      confidence: 0.9,
    };
  }

  if (HELP_REQUEST.test(question) && question.trim().length < 60) {
    return {
      reply: [
        "I can help with:",
        "",
        "- HR and leave policy questions",
        "- IT support and login or access issues",
        "- Company events and training",
        "- Summaries and keyword extraction for documents you upload",
        "",
        "Answers come from the demonstration knowledge base and always cite the source file.",
      ].join("\n"),
      sources: [],
      intent,
      confidence: 0.9,
    };
  }

  const referToDocument = DOCUMENT_REFERENCE.test(question);
  const documentMatches = document ? searchDocument(document.text, question, 3) : [];
  const documentIsRelevant =
    Boolean(document) &&
    (referToDocument || (documentMatches[0]?.score ?? 0) > 1.2);

  const result =
    documentIsRelevant && document
      ? documentAnswer(question, document)
      : knowledgeAnswer(question, intent);

  if (hasHistory && result.confidence === 0) {
    result.reply = `${result.reply}\n\nIf you meant to ask about the earlier conversation, rephrase the question and I will use the available context.`;
  }

  return { ...result, intent };
}
