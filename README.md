# Glymph KB auto-scraper

## What this does
`scripts/scrape-kb.js` crawls glymphville.com's sitemap, pulls text from every
page, finds every linked PDF, extracts PDF text, and writes `kb.json`.
The chatbot fetches `kb.json` and searches it live — no manual copy/paste.

## One-time setup
1. Create a GitHub repo, push this whole folder.
2. In `glymph-chatbot-v3.js`, set `KB_URL` to:
   `https://cdn.jsdelivr.net/gh/<your-gh-user>/<repo>@main/kb.json`
3. Run once locally to generate the first kb.json:
   ```
   npm install
   npm run build-kb
   git add kb.json && git commit -m "initial kb" && git push
   ```
4. Paste `glymph-chatbot-v3.js` into WPCode (Footer, Site Wide).

## Staying current automatically
`.github/workflows/update-kb.yml` runs the scraper daily (6am UTC) and on
manual trigger, commits the new `kb.json`. Any new page, new PDF, or edited
PDF you upload to the site gets picked up on the next run — nothing to do
on your end. To force an immediate refresh: GitHub repo → Actions →
"Update Glymph KB" → Run workflow.

jsDelivr caches ~12h; purge instantly after a push with:
`https://purge.jsdelivr.net/gh/<user>/<repo>@main/kb.json`
