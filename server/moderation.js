import fs from "node:fs";
import path from "node:path";
import { array as baseWordlist } from "badwords-list";

// Backend bad-language filtering driven by a system-maintained dictionary.
//
// Two sources are merged:
//   1. knowledge/moderation-dictionary.json - curated, reviewable, extendable
//   2. badwords-list (MIT)                  - broad baseline coverage
//
// Matching is whole-word (or whole-phrase) after normalisation, so words such
// as "assistant", "class", and "Scunthorpe" are not blocked.

const dictionaryPath =
  process.env.IEA_MODERATION_DICTIONARY ||
  path.join(
    process.env.IEA_KNOWLEDGE_DIR || path.join(process.cwd(), "knowledge"),
    "moderation-dictionary.json",
  );

/**
 * Lowercase, strip accents and punctuation, and collapse common leetspeak
 * substitutions. Unicode letters are preserved so Devanagari entries work.
 */
export function normalizeMessage(message) {
  return String(message || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[@]/g, "a")
    .replace(/[4]/g, "a")
    .replace(/[3]/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/[0]/g, "o")
    .replace(/[$5]/g, "s")
    .replace(/[7]/g, "t")
    // \p{M} keeps Devanagari vowel signs (matras); without it Hindi entries
    // decompose into bare consonants and never match.
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadCuratedDictionary() {
  try {
    const raw = fs.readFileSync(dictionaryPath, "utf8");
    const parsed = JSON.parse(raw);
    const categories = parsed?.categories || {};
    const entries = [];

    for (const [category, config] of Object.entries(categories)) {
      for (const term of config?.terms || []) {
        if (typeof term === "string" && term.trim()) {
          entries.push({
            term: normalizeMessage(term),
            category,
            severity: config?.severity || "medium",
          });
        }
      }
    }
    return entries;
  } catch {
    // A missing or malformed dictionary must not take the service down; the
    // baseline wordlist still applies.
    return [];
  }
}

const curatedEntries = loadCuratedDictionary();
const curatedTerms = new Map(curatedEntries.map((entry) => [entry.term, entry]));

const unigramTerms = new Map(curatedTerms);
const phraseTerms = new Map();

for (const term of baseWordlist) {
  const normalized = normalizeMessage(term);
  if (!normalized) continue;
  // Single letters and two-letter fragments cause far more false positives
  // than they catch, so the baseline list is filtered to 3+ characters.
  if (normalized.length < 3 || normalized.includes(" ")) continue;
  if (!unigramTerms.has(normalized)) {
    unigramTerms.set(normalized, {
      term: normalized,
      category: "profanity",
      severity: "high",
    });
  }
}

for (const [term, entry] of curatedTerms) {
  if (!term.includes(" ")) continue;
  unigramTerms.delete(term);
  phraseTerms.set(term, entry);
}

// Words that legitimately contain a blocked substring, or that appear in
// legitimate HR/policy questions, and must never be blocked on their own.
// "sexual harassment" is a required workplace topic; "assistant" and "class"
// contain blocked substrings. Kept explicit so reviewers can audit additions.
const ALLOWLIST = new Set([
  "assistant", "assistance", "class", "classic", "passage", "compass",
  "analysis", "analyst", "bass", "grass", "mass", "press", "assessment",
  "scunthorpe", "shitake", "document", "registration", "assignment",
  "sexual", "sex", "gender", "harassment", "orientation",
]);

function isAllowedWord(word) {
  return ALLOWLIST.has(word) || !unigramTerms.has(word);
}

/**
 * Find the first blocked term in a message.
 * @returns {string|null} the normalised matched term, or null when clean.
 */
export function findBlockedTerm(message) {
  const normalized = normalizeMessage(message);
  if (!normalized) return null;

  const words = normalized.split(" ");
  for (let index = 0; index < words.length; index += 1) {
    // Phrases are checked before the single-word allowlist: "shut up" must
    // match even though "shut" alone is not a blocked word.
    const three = words.slice(index, index + 3).join(" ");
    const two = words.slice(index, index + 2).join(" ");
    if (phraseTerms.has(three)) return three;
    if (phraseTerms.has(two)) return two;

    const word = words[index];
    if (isAllowedWord(word)) continue;
    if (unigramTerms.has(word)) return word;
  }

  return null;
}

/** Full classification, including the dictionary category. */
export function classifyMessage(message) {
  const matched = findBlockedTerm(message);
  if (!matched) return { allowed: true, term: null, category: null, severity: null };

  const entry = phraseTerms.get(matched) || unigramTerms.get(matched);
  return {
    allowed: false,
    term: matched,
    category: entry?.category || "profanity",
    severity: entry?.severity || "medium",
  };
}

export function moderateMessage(message) {
  const result = classifyMessage(message);

  return result.allowed
    ? { allowed: true }
    : {
        allowed: false,
        category: result.category,
        error:
          "Please rephrase your message using respectful language. Abuse and profanity are not permitted in this assistant.",
      };
}

/**
 * Mask blocked words in model output while preserving readable text.
 * Only the curated dictionary is used here: the broad baseline list contains
 * clinical words (for example "sexual") that are legitimate in an HR answer.
 */
export function censorText(text) {
  return String(text || "").replace(/[\p{L}\p{N}\p{M}@!$|*]+/gu, (token) => {
    const normalized = normalizeMessage(token);
    if (!normalized || !curatedTerms.has(normalized)) return token;
    if (ALLOWLIST.has(normalized)) return token;
    return "*".repeat(Math.max(3, Math.min(token.length, 8)));
  });
}

export function dictionarySize() {
  return unigramTerms.size + phraseTerms.size;
}
