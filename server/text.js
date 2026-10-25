// Lightweight, dependency-free text utilities shared by the retrieval,
// summarization, and moderation modules. Everything here is deterministic and
// runs in well under a millisecond for the document sizes this app accepts.

export const STOPWORDS = new Set(
  `a about above after again against all also am an and any are aren as at be
   because been before being below between both but by can cannot could did do
   does doing don down during each few for from further had has have having he
   her here hers herself him himself his how i if in into is it its itself just
   me more most my myself no nor not now of off on once only or other our ours
   ourselves out over own same she should so some such than that the their
   theirs them themselves then there these they this those through to too under
   until up very was we were what when where which while who whom why will with
   would you your yours yourself yourselves
   please tell give show need want know help let us may might must shall
   anything something thing things kind sort really quite rather much many
   get got make made use used using able way ways like work works`
    .split(/\s+/)
    .filter(Boolean),
);

// Words that carry intent but are too generic to rank a document.
export const QUESTION_WORDS = new Set([
  "what", "when", "where", "who", "whom", "why", "how", "which", "whose",
]);

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+|\n{2,}|(?<=[:;])\s*\n/;

/**
 * Split prose into sentences while keeping bullet lines intact.
 * Returns trimmed, non-empty sentences.
 */
export function splitSentences(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * Tokenize for indexing: lowercase, strip punctuation, drop stopwords and
 * very short tokens. Numbers are kept because policy documents cite limits.
 */
export function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

/** Tokenize without dropping stopwords; used for phrase candidate detection. */
export function rawTokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

/** Cheap English stemming so "policies" and "policy" match. */
export function stem(token) {
  if (token.length <= 3) return token;
  const rules = [
    [/ies$/, "y"],
    [/ied$/, "y"],
    [/(ss|us|is)$/, ""],
    [/s$/, ""],
    [/ing$/, ""],
    [/ed$/, ""],
    [/ly$/, ""],
  ];
  for (const [pattern, replacement] of rules) {
    if (pattern.test(token)) {
      const candidate = token.replace(pattern, replacement);
      return candidate.length >= 3 ? candidate : token;
    }
  }
  return token;
}

/** Whether the text looks like it contains a real sentence worth returning. */
export function isInformative(sentence) {
  return tokenize(sentence).length >= 3;
}

/**
 * Rebuild paragraphs from hard-wrapped text (as produced by PDF extraction).
 *
 * PDF text arrives with a newline at every visual line break, which would
 * otherwise chop sentences in half and glue headings onto the next paragraph.
 * This joins continuation lines while keeping headings and bullets separate.
 */
export function normalizeProse(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const paragraphs = [];
  let buffer = "";

  const flush = () => {
    const paragraph = buffer.trim();
    if (paragraph) paragraphs.push(paragraph);
    buffer = "";
  };

  const looksLikeHeading = (line) =>
    /^#{1,6}\s+/.test(line) ||
    /^\d+(\.\d+)*\.?\s+\S/.test(line) ||
    /^[-*•]\s+/.test(line) ||
    (line.length <= 60 &&
      line.split(/\s+/).length <= 8 &&
      /^[A-Z]/.test(line) &&
      !/[.;:,]$/.test(line));

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }

    if (looksLikeHeading(line)) {
      flush();
      paragraphs.push(line);
      continue;
    }

    if (!buffer) {
      buffer = line;
    } else if (/[.!?:;]$/.test(buffer)) {
      flush();
      buffer = line;
    } else {
      buffer += ` ${line}`;
    }
  }

  flush();
  // Blank lines between paragraphs are what splitSentences() treats as a
  // boundary, so headings stay separate from the prose that follows them.
  return paragraphs.join("\n\n");
}

/** Collapse whitespace and trim to a maximum character budget. */
export function clampText(text, maxCharacters) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxCharacters) return normalized;
  const cut = normalized.slice(0, maxCharacters);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : cut.length)}...`;
}
