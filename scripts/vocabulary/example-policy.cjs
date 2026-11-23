"use strict";
const MIN_EXAMPLES = 3;
const MAX_WORDS = 8;
const MAX_PHRASES = 1;
const wordCount = (text) => text.trim().split(/\s+/u).filter(Boolean).length;
const normalized = (text) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[.!?]+$/u, "")
    .trim();

function validateExamples(id, examples) {
  const issues = [];
  if (!Array.isArray(examples) || examples.length < MIN_EXAMPLES)
    issues.push("at least three examples required");
  const seen = new Set();
  let phrases = 0;
  for (const example of examples || []) {
    const key = normalized(example.en || "");
    if (!key || seen.has(key)) issues.push("empty or duplicate English text");
    seen.add(key);
    if (wordCount(example.en || "") > MAX_WORDS)
      issues.push("example exceeds eight words");
    if (!example.zh || !/\p{Script=Han}/u.test(example.zh))
      issues.push("Chinese translation required");
    if (/[⁇�]|<unk>|<pad>/u.test(example.zh || ""))
      issues.push("invalid translation output");
    if (example.kind === "phrase") phrases++;
    else if (example.kind !== "sentence") issues.push("example kind required");
    if (!example.source?.type) issues.push("source required");
  }
  if (phrases > MAX_PHRASES) issues.push("at most one phrase allowed");
  return issues.map((issue) => id + ": " + issue);
}

// A conservative candidate filter, not a grammatical quality certification.
// Editorial entries always carry an explicit kind, rather than inferring it
// from punctuation (WordNet frequently punctuates noun phrases).
function sentenceCandidate(text) {
  if (!/[.!?]$/u.test(text) || wordCount(text) < 2) return false;
  return (
    /\b(?:am|is|are|was|were|be|been|being|has|have|had|do|does|did|can|could|will|would|shall|should|may|might|must|ought|need|needs)\b/iu.test(
      text,
    ) ||
    /\b(?:i|you|he|she|it|we|they|there|that|this|who|what)(?:['’](?:m|s|re|ve|d|ll))\b/iu.test(
      text,
    ) ||
    /\b[a-z]+(?:ed|ies)\b/iu.test(text) ||
    /^(?:please|don't|do not|let|let's|look|listen|take|give|keep|make|put|leave|get|go|come|try|use|read|write|tell|ask|help|stop|remember|avoid|check|turn|show|watch|bring|follow|open|close|hold|wait|wash|wear|add|remove|protect|pay|save|choose|find|call|cut|eat|drink|buy|sell|draw|consider|imagine|notice|explain|compare|allow|ensure|discuss|reduce|increase)\b/iu.test(
      text,
    )
  );
}

function selectExamples(candidates, limit = 6) {
  const selected = [];
  const seen = new Set();
  const senses = new Set();
  let phrases = 0;
  const eligible = candidates.filter((example) => {
    if (!example?.en || wordCount(example.en) > MAX_WORDS) return false;
    if (example.kind === "phrase") return true;
    return example.kind === "sentence" || sentenceCandidate(example.en);
  });
  // Prioritize distinct dictionary senses, then fill the minimum with short
  // sentences. A new gloss may expand a polysemous entry to six examples.
  for (const example of eligible) {
    const kind = example.kind || "sentence";
    const key = normalized(example.en);
    if (seen.has(key) || (kind === "phrase" && phrases >= MAX_PHRASES))
      continue;
    const sense = example.sense || example.gloss;
    if (selected.length >= MIN_EXAMPLES && (!sense || senses.has(sense)))
      continue;
    if (selected.length >= limit) break;
    seen.add(key);
    if (sense) senses.add(sense);
    if (kind === "phrase") phrases++;
    selected.push({ ...example, kind });
  }
  return selected;
}

module.exports = {
  MIN_EXAMPLES,
  MAX_WORDS,
  MAX_PHRASES,
  wordCount,
  normalized,
  sentenceCandidate,
  selectExamples,
  validateExamples,
};
