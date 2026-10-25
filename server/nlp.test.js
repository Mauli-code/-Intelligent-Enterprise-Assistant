import test from "node:test";
import assert from "node:assert/strict";
import { classifyIntent, answerLocally } from "./localAssistant.js";
import { searchKnowledge } from "./retrieval.js";
import { analyzeDocument, extractKeywords, summarizeText } from "./summarize.js";
import { censorText, findBlockedTerm } from "./moderation.js";
import { normalizeProse, splitSentences, tokenize } from "./text.js";

test("rebuilds hard-wrapped paragraphs without gluing headings to prose", () => {
  const wrapped = [
    "3. Leave policy",
    "Leave is grouped into casual leave and earned leave. Planned",
    "leave should be applied for in advance.",
    "",
    "4. Pay",
    "Salary is credited on the last working day.",
  ].join("\n");

  const prose = normalizeProse(wrapped);
  const paragraphs = prose.split("\n\n");

  assert.equal(paragraphs[0], "3. Leave policy");
  assert.match(paragraphs[1], /Planned leave should be applied for in advance\.$/);
  assert.equal(paragraphs[2], "4. Pay");
});

test("splits sentences on terminal punctuation and paragraph breaks", () => {
  const sentences = splitSentences("First point. Second point!\n\nThird point?");

  assert.deepEqual(sentences, ["First point.", "Second point!", "Third point?"]);
});

test("drops stopwords and single characters while keeping numeric limits", () => {
  const tokens = tokenize("The employee must submit the form within 24 days.");

  assert.equal(tokens.includes("the"), false);
  assert.equal(tokens.includes("must"), false);
  assert.ok(tokens.includes("employee"));
  assert.ok(tokens.includes("24"));
});

test("ranks the HR document first for a leave question", () => {
  const matches = searchKnowledge("How do I submit a leave request?", 3);

  assert.ok(matches.length > 0);
  assert.equal(matches[0].source, "demo-hr-policy.md");
  assert.ok(matches[0].score > 0);
});

test("uses synonyms so vacation questions reach the leave policy", () => {
  const matches = searchKnowledge("How do I apply for vacation?", 3);

  assert.equal(matches[0].source, "demo-hr-policy.md");
});

test("classifies intent on whole words only", () => {
  // "capital" contains "it" as a substring but is not an IT question.
  assert.equal(classifyIntent("What is the capital of France?").id, "general");
  assert.equal(classifyIntent("My laptop will not connect to wifi").id, "it");
  assert.equal(classifyIntent("How many leave days do I get?").id, "hr");
  assert.equal(classifyIntent("When is the next workshop?").id, "events");
});

test("summarizes a document and keeps short but meaningful sentences", () => {
  const summary = summarizeText(
    "The VPN must be used for all remote access. Report lost devices within 24 hours.",
  );

  assert.match(summary, /VPN/);
  assert.match(summary, /24 hours/);
});

test("bounds the summary length and preserves document order", () => {
  const text = Array.from(
    { length: 20 },
    (_, index) => `Policy clause ${index} covers annual leave accrual and carry forward rules.`,
  ).join(" ");

  const summary = summarizeText(text, { maxSentences: 3 });
  const parts = splitSentences(summary);

  assert.ok(parts.length <= 3);
  const positions = parts.map((part) => Number(part.match(/clause (\d+)/)[1]));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test("extracts concise, relevant keywords", () => {
  const keywords = extractKeywords(
    "Leave policy. Casual leave is granted in half-day units. Earned leave accrues monthly.",
    { limit: 5 },
  );

  assert.ok(keywords.length > 0);
  assert.ok(keywords.length <= 5);
  for (const keyword of keywords) {
    assert.ok(keyword.split(" ").length <= 3, `too long: ${keyword}`);
    assert.equal(/^\d+$/.test(keyword), false);
  }
});

test("reports document statistics with a page footer removed by the caller", () => {
  const analysis = analyzeDocument(
    "Safety notice. The emergency assembly point is the north parking area. Fire drills run quarterly.",
  );

  assert.ok(analysis.statistics.words > 5);
  assert.ok(analysis.statistics.sentences >= 1);
  assert.equal(analysis.statistics.readingMinutes, 1);
  assert.ok(analysis.keywords.length > 0);
});

test("local answers cite a source file and admit when they do not know", () => {
  const answered = answerLocally({ question: "How do I apply for leave?" });
  assert.ok(answered.sources.includes("demo-hr-policy.md"));
  assert.match(answered.reply, /Source: demo-hr-policy\.md/);

  const unknown = answerLocally({ question: "What is the airspeed of a swallow?" });
  assert.deepEqual(unknown.sources, []);
  assert.match(unknown.reply, /could not find/i);
});

test("answers questions from an uploaded document", () => {
  const document = {
    filename: "safety.md",
    text: "The emergency assembly point is the north parking area. Drills run quarterly.",
  };
  const answer = answerLocally({
    question: "Where is the emergency assembly point in this document?",
    document,
  });

  assert.match(answer.reply, /north parking/i);
  assert.deepEqual(answer.sources, ["safety.md"]);
});

test("does not censor clinical HR terms in assistant output", () => {
  const output = censorText("The sexual harassment policy applies to all staff.");
  assert.match(output, /sexual harassment policy/);
});

test("blocks leetspeak and Devanagari abuse", () => {
  assert.equal(findBlockedTerm("that is sh!t"), "shit");
  assert.equal(findBlockedTerm("b1tch"), "bitch");
  assert.equal(findBlockedTerm("तुम चूतिया हो"), "चूतिया");
});
