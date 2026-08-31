/**
 * Glymph KB Scraper
 * Crawls the WordPress sitemap, extracts page text, finds every linked PDF,
 * extracts PDF text, chunks everything, writes kb.json.
 * Run manually: node scripts/scrape-kb.js
 * Run on schedule: see .github/workflows/update-kb.yml
 */
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const pdfParse = require("pdf-parse");

const SITE = process.env.SITE_URL || "https://glymphville.com";
const OUT_FILE = path.join(__dirname, "..", "kb.json");
const CHUNK_WORDS = 180;
const MAX_PAGES = 300;

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "GlymphKBBot/1.0" } });
  if (!res.ok) throw new Error(url + " -> " + res.status);
  return res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { "User-Agent": "GlymphKBBot/1.0" } });
  if (!res.ok) throw new Error(url + " -> " + res.status);
  return Buffer.from(await res.arrayBuffer());
}

async function getSitemapUrls() {
  const candidates = [
    SITE + "/sitemap_index.xml",
    SITE + "/sitemap.xml",
    SITE + "/wp-sitemap.xml"
  ];
  let urls = new Set();
  for (const c of candidates) {
    try {
      const xml = await fetchText(c);
      const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      const subSitemaps = locs.filter((l) => l.includes("sitemap") && l.endsWith(".xml"));
      const pageUrls = locs.filter((l) => !l.includes("sitemap"));
      pageUrls.forEach((u) => urls.add(u));
      for (const sm of subSitemaps.slice(0, 30)) {
        try {
          const subXml = await fetchText(sm);
          [...subXml.matchAll(/<loc>([^<]+)<\/loc>/g)]
            .map((m) => m[1])
            .filter((l) => !l.includes("sitemap"))
            .forEach((u) => urls.add(u));
        } catch (e) {}
      }
      if (urls.size) break;
    } catch (e) {}
  }
  return [...urls].slice(0, MAX_PAGES);
}

function chunkText(text, words) {
  const w = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < w.length; i += words) {
    chunks.push(w.slice(i, i + words).join(" "));
  }
  return chunks;
}

function extractMainText($) {
  $("script,style,nav,footer,header,noscript").remove();
  const candidates = ["main", "article", "#content", ".entry-content", "body"];
  for (const sel of candidates) {
    const el = $(sel).first();
    if (el.length) {
      const t = el.text().replace(/\s+/g, " ").trim();
      if (t.length > 80) return t;
    }
  }
  return $("body").text().replace(/\s+/g, " ").trim();
}

async function scrapePage(url) {
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim() || url;
  const text = extractMainText($);
  const pdfLinks = [];
  $("a[href$='.pdf'], a[href*='.pdf?']").each((i, el) => {
    let href = $(el).attr("href");
    if (!href) return;
    if (href.startsWith("/")) href = SITE.replace(/\/$/, "") + href;
    pdfLinks.push(href);
  });
  return { url, title, text, pdfLinks };
}

async function scrapePdf(url) {
  const buf = await fetchBuffer(url);
  const data = await pdfParse(buf);
  return data.text.replace(/\s+/g, " ").trim();
}

async function main() {
  console.log("Discovering pages via sitemap...");
  const pageUrls = await getSitemapUrls();
  console.log("Found " + pageUrls.length + " pages");

  const kb = [];
  const seenPdfs = new Set();
  let id = 0;

  for (const url of pageUrls) {
    try {
      const { title, text, pdfLinks } = await scrapePage(url);
      chunkText(text, CHUNK_WORDS).forEach((chunk) => {
        if (chunk.trim().length < 40) return;
        kb.push({ id: id++, source: "page", url, title, text: chunk });
      });
      pdfLinks.forEach((p) => seenPdfs.add(p));
      console.log("Scraped page:", url);
    } catch (e) {
      console.warn("Skip page:", url, e.message);
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
