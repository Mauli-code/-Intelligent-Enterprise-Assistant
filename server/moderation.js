const blockedTerms = new Set([
  "asshole",
  "bastard",
  "bitch",
  "crap",
  "fuck",
  "shit",
]);

function normalizeMessage(message) {
  return message
    .toLowerCase()
    .replace(/[@4]/g, "a")
    .replace(/[3]/g, "e")
    .replace(/[1!]/g, "i")
    .replace(/[0]/g, "o")
    .replace(/[$5]/g, "s")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findBlockedTerm(message) {
  const normalized = normalizeMessage(message);
  const words = normalized.split(" ");
  return words.find((word) => blockedTerms.has(word)) || null;
}

export function moderateMessage(message) {
  const blockedTerm = findBlockedTerm(message);

  return blockedTerm
    ? {
        allowed: false,
        error: "Please rephrase your message using respectful language.",
      }
    : { allowed: true };
}
