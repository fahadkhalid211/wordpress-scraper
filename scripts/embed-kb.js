const fs = require("fs");
const path = require("path");
const { pipeline } = require("@xenova/transformers");

const IN_FILE = path.join(__dirname, "..", "kb.json");
const OUT_FILE = path.join(__dirname, "..", "kb-embedded.json");

async function main() {
  const raw = fs.readFileSync(IN_FILE, "utf8");
  const kb = JSON.parse(raw);
  const chunks = kb.chunks;
  console.log("Loading local embedding model...");
  const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

  console.log("Embedding " + chunks.length + " chunks...");
  for (let i = 0; i < chunks.length; i++) {
    const output = await extractor(chunks[i].text, { pooling: "mean", normalize: true });
    chunks[i].embedding = Array.from(output.data);
    if (i % 10 === 0) console.log("Embedded " + i + "/" + chunks.length);
  }

  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), count: chunks.length, chunks }, null, 0)
  );
  console.log("Wrote " + chunks.length + " embedded chunks to " + OUT_FILE);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});