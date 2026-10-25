import {
  clampText,
  normalizeProse,
  splitSentences,
  stem,
  STOPWORDS,
  tokenize,
} from "./text.js";

// Classical NLP document analytics with no external service:
//  * extractive summarization via TF-weighted sentence ranking
//  * keyword extraction via RAKE (Rapid Automatic Keyword Extraction)
// Both are deterministic, so the same document always produces the same output
// and the results are reproducible in a demo.

const BOOST_PATTERNS = [
  /\bmust\b/i,
  /\bshould\b/i,
  /\brequired?\b/i,
  /\bemployee(s)?\b/i,
  /\beligib/i,
  /\bentitled?\b/i,
  /\bwithin\b/i,
  /\bnot\b/i,
];

/** Term weight table for a single document. */
function termWeights(text) {
  const terms = tokenize(text).map(stem);
  const counts = new Map();
  for (const term of terms) counts.set(term, (counts.get(term) || 0) + 1);
  const max = Math.max(1, ...counts.values());

  const weights = new Map();
  for (const [term, count] of counts) {
    weights.set(term, count / max);
  }
  return weights;
}

function scoreSentence(sentence, weights, position, totalSentences) {
  const terms = tokenize(sentence).map(stem);
  if (terms.length === 0) return 0;

  const density =
    terms.reduce((total, term) => total + (weights.get(term) || 0), 0) /
    Math.sqrt(terms.length);

  // Openings carry context, and very late sentences are often boilerplate.
  const positionBonus = position === 0 ? 0.35 : position < totalSentences * 0.3 ? 0.15 : 0;
  const emphasis = BOOST_PATTERNS.some((pattern) => pattern.test(sentence)) ? 0.2 : 0;
  const lengthPenalty = terms.length < 4 ? -0.3 : terms.length > 45 ? -0.15 : 0;

  return density + positionBonus + emphasis + lengthPenalty;
}

/**
 * Produce an extractive summary that preserves the document's own wording.
 * `maxSentences` bounds the output so a long report still yields a short brief.
 */
export function summarizeText(text, { maxSentences = 5 } = {}) {
  const prose = normalizeProse(text);
  const candidates = splitSentences(prose).filter(
    (sentence) => !/page\s+\d+\s+of\s+\d+/i.test(sentence),
  );

  // Three content terms is enough for a useful sentence ("The VPN must be used
  // for all remote access." has three after stopword removal). If nothing
  // qualifies, keep the original sentences rather than returning an empty sum.
  let sentences = candidates.filter(
    (sentence) => tokenize(sentence).length >= 3,
  );
  if (sentences.length === 0) sentences = candidates;
  if (sentences.length === 0) return "";
  if (sentences.length <= maxSentences) return sentences.join(" ");

  const weights = termWeights(prose);
  const ranked = sentences
    .map((sentence, position) => ({
      sentence,
      position,
      score: scoreSentence(sentence, weights, position, sentences.length),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, maxSentences)
    .sort((left, right) => left.position - right.position);

  return ranked.map(({ sentence }) => sentence).join(" ");
}

const PHRASE_BREAK = /[,;:.!?()[\]{}"“”'’\n\r\t/|]+/;

// Words that add no keyword value in a workplace document. Kept separate from
// the retrieval stopwords because some of these ("apply", "within") still
// matter for search ranking.
const KEYWORD_NOISE = new Set(
  `within least prior requires require required submitted submit ensure ensures
   include includes including provided provide based subject accordance respect
   must may can also every per any all more than days day week weeks month
   months year years one two three four five six seven eight nine ten thirty
   ninety sixty fifteen`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * RAKE keyword extraction. Candidate phrases are split on stopwords and
 * punctuation; each word earns deg(word)/freq(word); phrases are ranked by the
 * sum of their word scores, preferring concise, repeated phrases.
 */
export function extractKeywords(text, { limit = 10 } = {}) {
  const cleaned = normalizeProse(text)
    .replace(/[^\p{L}\p{N}\s,;:.!?()/|-]/gu, " ")
    .replace(/\s+/g, " ");

  const phrases = [];
  for (const segment of cleaned.split(PHRASE_BREAK)) {
    let current = [];
    for (const word of segment.split(/\s+/)) {
      const normalized = word.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
      if (
        !normalized ||
        normalized.length < 3 ||
        STOPWORDS.has(normalized) ||
        KEYWORD_NOISE.has(normalized) ||
        /^\d+$/.test(normalized)
      ) {
        if (current.length > 0) phrases.push(current);
        current = [];
      } else {
        current.push(normalized);
      }
    }
    if (current.length > 0) phrases.push(current);
  }

  const frequency = new Map();
  const degree = new Map();
  for (const phrase of phrases) {
    for (const word of phrase) {
      frequency.set(word, (frequency.get(word) || 0) + 1);
      degree.set(word, (degree.get(word) || 0) + phrase.length - 1);
    }
  }

  const wordScore = new Map();
  for (const [word, count] of frequency) {
    wordScore.set(word, (degree.get(word) + count) / count);
  }

  const seen = new Set();
  const candidates = [];
  for (const phrase of phrases) {
    const joined = phrase.join(" ");
    if (joined.length < 4 || joined.length > 42) continue;
    // Prefer concise keywords: a five-word phrase is usually a sentence fragment.
    if (phrase.length > 3) continue;
    const key = phrase.map(stem).join(" ");
    if (seen.has(key)) continue;
    seen.add(key);

    const score =
      phrase.reduce((total, word) => total + (wordScore.get(word) || 0), 0) /
      Math.sqrt(phrase.length);
    // A phrase that repeats is more representative of the document.
    const repeats = phrases.filter((other) => other.join(" ") === joined).length;
    candidates.push({ keyword: joined, score: score * (1 + Math.log(repeats)) });
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates.slice(0, limit).map(({ keyword }) => keyword);
}

/** Everything the /api/documents response needs, computed locally. */
export function analyzeDocument(text, { summarySentences = 5, keywordLimit = 10 } = {}) {
  const prose = normalizeProse(text);
  const normalized = prose.replace(/\s+/g, " ").trim();
  const words = tokenize(normalized);
  const summary = summarizeText(prose, { maxSentences: summarySentences });
  const sentenceCount = splitSentences(prose).length;

  return {
    summary: summary || clampText(normalized, 400),
    keywords: extractKeywords(prose, { limit: keywordLimit }),
    statistics: {
      characters: normalized.length,
      words: normalized.split(/\s+/).filter(Boolean).length,
      sentences: sentenceCount,
      readingMinutes: Math.max(1, Math.ceil(normalized.split(/\s+/).filter(Boolean).length / 200)),
      uniqueTerms: new Set(words.map(stem)).size,
    },
  };
}
