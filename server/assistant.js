import { GoogleGenAI } from "@google/genai";
import { TimeoutError, withTimeout } from "./async.js";
import { answerLocally } from "./localAssistant.js";
import { buildPrompt, findKnowledgeSources } from "./knowledge.js";

// Provider strategy:
//   AI_PROVIDER=auto   (default) use Gemini when a key exists, else local NLP
//   AI_PROVIDER=local  always use the offline NLP engine
//   AI_PROVIDER=gemini require Gemini, fall back to local NLP on failure
//
// The local engine is the safety net that makes the five-second response
// requirement achievable: an LLM call cannot be allowed to hang the request.

const MAX_PROVIDER_TIMEOUT_MS = 4500;

function configuredProviderTimeout() {
  const requested = Number(process.env.AI_TIMEOUT_MS);
  if (!Number.isFinite(requested) || requested <= 0) return 4000;
  return Math.min(requested, MAX_PROVIDER_TIMEOUT_MS);
}

export const DEFAULT_PROVIDER_TIMEOUT_MS = configuredProviderTimeout();

export function activeProvider() {
  const configured = String(process.env.AI_PROVIDER || "auto").toLowerCase();
  if (configured === "local") return "local";
  if (configured === "gemini" || configured === "auto") {
    return process.env.GEMINI_API_KEY ? "gemini" : "local";
  }
  return "local";
}

function providerTimeout() {
  // Never let a provider call eat the full five-second budget.
  return configuredProviderTimeout();
}

/**
 * Generate an assistant reply.
 *
 * @param {object} input
 * @param {string} input.question
 * @param {{filename: string, text: string}|null} [input.document]
 * @param {{role: string, content: string}[]} [input.history]
 * @returns {Promise<{reply: string, sources: string[], provider: string,
 *   intent: {id: string, label: string}, confidence: number,
 *   latencyMs: number, fallbackReason?: string}>}
 */
export async function generateReply({ question, document = null, history = [] }) {
  const startedAt = performance.now();
  const provider = activeProvider();
  const local = answerLocally({
    question,
    document,
    hasHistory: history.length > 0,
  });
  const localResult = {
    reply: local.reply,
    sources: local.sources,
    provider: "local-nlp",
    intent: local.intent,
    confidence: local.confidence,
    latencyMs: 0,
  };

  if (provider === "local") {
    return { ...localResult, latencyMs: Number((performance.now() - startedAt).toFixed(1)) };
  }

  const prompt = buildPrompt({ question, document, history });

  try {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const result = await withTimeout(
      client.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        contents: prompt,
      }),
      providerTimeout(),
    );

    const reply = result.text?.trim();
    if (!reply) throw new Error("The AI service returned an empty response.");

    return {
      reply,
      sources: findKnowledgeSources(question).map((source) => source.name),
      provider: "gemini",
      intent: local.intent,
      confidence: Math.max(local.confidence, 0.75),
      latencyMs: Number((performance.now() - startedAt).toFixed(1)),
    };
  } catch (error) {
    // Graceful degradation: the employee still gets a grounded answer.
    return {
      ...localResult,
      latencyMs: Number((performance.now() - startedAt).toFixed(1)),
      fallbackReason:
        error instanceof TimeoutError
          ? "The AI provider timed out; answered with the offline engine."
          : "The AI provider was unavailable; answered with the offline engine.",
    };
  }
}
