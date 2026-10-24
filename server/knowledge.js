import fs from "node:fs";
import path from "node:path";

const knowledgeDirectory = path.join(process.cwd(), "knowledge");
const documents = fs
  .readdirSync(knowledgeDirectory)
  .filter((filename) => filename.endsWith(".md"))
  .map((filename) => ({
    name: filename,
    text: fs.readFileSync(path.join(knowledgeDirectory, filename), "utf8"),
  }));

function termsFor(text) {
  return [...new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) || [])];
}

export function findKnowledgeSources(question) {
  const questionTerms = termsFor(question);

  return documents
    .map((document) => {
      const documentTerms = new Set(termsFor(document.text));
      const score = questionTerms.reduce(
        (total, term) => total + (documentTerms.has(term) ? 1 : 0),
        0,
      );
      return { ...document, score };
    })
    .filter((document) => document.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2);
}

export function knowledgePrompt(question, documentText = "") {
  const sources = findKnowledgeSources(question);
  const sourceText = sources
    .map((source) => `SOURCE: ${source.name}\n${source.text}`)
    .join("\n\n");
  const uploadedText = documentText
    ? `UPLOADED DOCUMENT CONTEXT:\n${documentText.slice(0, 100000)}`
    : "";

  return {
    sources: sources.map((source) => source.name),
    prompt: `${sourceText ? `Use the following demonstration documents when relevant. They are not official GAIL policy. If they do not answer the question, say so and recommend checking the official internal source. Do not invent company rules.\n\n${sourceText}` : "The demonstration knowledge base has no relevant source for this question."}${uploadedText ? `\n\n${uploadedText}\n\nUse the uploaded document to answer follow-up questions when it is relevant.` : ""}\n\nEMPLOYEE QUESTION:\n${question}`,
  };
}
