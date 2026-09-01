require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("@xenova/transformers");
const Groq = require("groq-sdk");

const app = express();
app.use(cors());
app.use(express.json());

const KB_FILE = path.join(__dirname, "kb-embedded.json");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

let extractor = null;
let kb = null;

function cosineSim(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function loadKB() {
  kb = JSON.parse(fs.readFileSync(KB_FILE, "utf8"));
  console.log("KB loaded:", kb.chunks.length, "chunks");
}

app.post("/api/chat", async (req, res) => {
  try {
    const query = (req.body.message || "").trim();
    if (!query) return res.status(400).json({ error: "message required" });

    if (!extractor) extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    if (!kb) loadKB();

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
      content: "You are a friendly chat assistant for the Glymph family website. Answer using only the context below. Reply in plain conversational text — no markdown, no headers, no bullet lists, no asterisks. Keep answers short and natural, like a text message, 2-4 sentences unless more detail is truly needed. If the answer isn't in the context, say you don't know.\n\nContext:\n" + context,
        },
        { role: "user", content: query },
      ],
    });

    res.json({ answer: completion.choices[0].message.content });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

app.get("/", (req, res) => res.send("Glymph chatbot API running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  loadKB();
  console.log("Server running on port " + PORT);
});
