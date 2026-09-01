require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { pipeline } = require("@xenova/transformers");
const Groq = require("groq-sdk");

const KB_FILE = path.join(__dirname, "..", "kb-embedded.json");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function cosineSim(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function main() {
  const query = process.argv.slice(2).join(" ");
  if (!query) {
    console.log("Usage: node scripts/chat.js your question here");
    return;
  }

  const kb = JSON.parse(fs.readFileSync(KB_FILE, "utf8"));
  const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  const qEmbedding = Array.from((await extractor(query, { pooling: "mean", normalize: true })).data);

  const scored = kb.chunks.map((c) => ({ ...c, score: cosineSim(qEmbedding, c.embedding) }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 5);

  const context = top.map((c) => `[${c.title}]\n${c.text}`).join("\n\n");

  const completion = await groq.chat.completions.create({
    model: "openai/gpt-oss-20b",
    messages: [
      {
        role: "system",
        content: "Answer using only the context below. If the answer isn't in the context, say you don't know.\n\nContext:\n" + context,
      },
      { role: "user", content: query },
    ],
  });

  console.log("\nAnswer:\n" + completion.choices[0].message.content);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});