/**
 * Glymph KB Scraper
 * Pulls all posts/pages via WP REST API, extracts page text, finds every linked PDF,
 * extracts PDF text, chunks everything, writes kb.json.
 * Run manually: node scripts/scrape-kb.js
 * Run on schedule: see .github/workflows/update-kb.yml
 */
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const pdfParse = require("pdf-parse");

const SITE = process.env.SITE_URL || "https://glymphville.com";
const WP_USER = process.env.WP_USER || "";
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD || "";
const AUTH_HEADER =
  WP_USER && WP_APP_PASSWORD
    ? { Authorization: "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString("base64") }
    : {};
const OUT_FILE = path.join(__dirname, "..", "kb.json");
const CHUNK_WORDS = 180;
const MAX_PAGES = 2000;

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "GlymphKBBot/1.0", ...AUTH_HEADER } });
  if (!res.ok) throw new Error(url + " -> " + res.status);
  return res.json();
}

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { "User-Agent": "GlymphKBBot/1.0", ...AUTH_HEADER } });
  if (!res.ok) throw new Error(url + " -> " + res.status);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchAllFromEndpoint(type) {
  const results = [];
  let page = 1;
  while (results.length < MAX_PAGES) {
    let items;
    try {
      items = await fetchJson(`${SITE}/wp-json/wp/v2/${type}?per_page=100&page=${page}`);
    } catch (e) {
      break;
    }
    if (!Array.isArray(items) || items.length === 0) break;
    results.push(...items);
    if (items.length < 100) break;
    page++;
  }
  return results;
}

async function getContentItems() {
  console.log("Discovering post types via REST API...");
  const types = await fetchJson(`${SITE}/wp-json/wp/v2/types`);
  const restBases = Object.values(types)
    .map((t) => t.rest_base)
    .filter(Boolean);

  console.log("Found types:", restBases.join(", "));

  const all = [];
  for (const base of restBases) {
    const items = await fetchAllFromEndpoint(base);
    console.log(base + ": " + items.length + " items");
    all.push(...items.map((i) => ({ ...i, _type: base })));
  }
  return all.slice(0, MAX_PAGES);
}
function stripHtml(html) {
  const $ = cheerio.load(html || "");
  $("script,style").remove();
  return $.root().text().replace(/\s+/g, " ").trim();
}

function chunkText(text, words) {
  const w = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < w.length; i += words) {
    chunks.push(w.slice(i, i + words).join(" "));
  }
  return chunks;
}

function extractPdfLinks(html) {
  const $ = cheerio.load(html || "");
  const pdfLinks = [];
  $("a[href$='.pdf'], a[href*='.pdf?']").each((i, el) => {
    let href = $(el).attr("href");
    if (!href) return;
    if (href.startsWith("/")) href = SITE.replace(/\/$/, "") + href;
    pdfLinks.push(href);
  });
  return pdfLinks;
}

async function scrapePdf(url) {
  const buf = await fetchBuffer(url);
  const data = await pdfParse(buf);
  return data.text.replace(/\s+/g, " ").trim();
}

async function getMediaItems() {
  console.log("Fetching media library...");
  const media = await fetchAllFromEndpoint("media");
  console.log("media: " + media.length + " items");
  return media;
}

async function main() {
  const items = await getContentItems();
  console.log("Found " + items.length + " posts/pages");

  const kb = [];
  const seenPdfs = new Set();
  let id = 0;

  for (const item of items) {
    try {
      const url = item.link;
      const title = stripHtml(item.title?.rendered || "") || url;
      const rawHtml = item.content?.rendered || "";
      const text = stripHtml(rawHtml);

      chunkText(text, CHUNK_WORDS).forEach((chunk) => {
        if (chunk.trim().length < 40) return;
        kb.push({ id: id++, source: item._type || "page", url, title, text: chunk });
      });

      extractPdfLinks(rawHtml).forEach((p) => seenPdfs.add(p));
      console.log("Scraped:", url);
    } catch (e) {
      console.warn("Skip item:", item.link, e.message);
    }
  }

  const mediaItems = await getMediaItems();
  for (const m of mediaItems) {
    try {
      const srcUrl = m.source_url || "";
      const title = stripHtml(m.title?.rendered || "") || srcUrl;
      const caption = stripHtml(m.caption?.rendered || "");
      const desc = stripHtml(m.description?.rendered || "");
      const alt = m.alt_text || "";

      if (/\.pdf$/i.test(srcUrl)) {
        seenPdfs.add(srcUrl);
      } else {
        const metaText = [title, caption, desc, alt].filter(Boolean).join(". ");
        if (metaText.trim().length >= 20) {
          kb.push({ id: id++, source: "media", url: m.link || srcUrl, title, text: metaText });
        }
      }
    } catch (e) {
      console.warn("Skip media:", m.id, e.message);
    }
  }

  for (const pdfUrl of seenPdfs) {
    try {
      const text = await scrapePdf(pdfUrl);
      const title = decodeURIComponent(pdfUrl.split("/").pop().replace(/\.pdf$/i, ""));
      chunkText(text, CHUNK_WORDS).forEach((chunk) => {
        if (chunk.trim().length < 40) return;
        kb.push({ id: id++, source: "pdf", url: pdfUrl, title, text: chunk });
      });
      console.log("Scraped PDF:", pdfUrl);
    } catch (e) {
      console.warn("Skip PDF:", pdfUrl, e.message);
    }
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), count: kb.length, chunks: kb }, null, 0));
  console.log("Wrote " + kb.length + " chunks to " + OUT_FILE);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
