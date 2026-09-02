// Parses GLYMPH-2.ged into structured per-person text chunks.
// Run standalone: node scripts/parse-gedcom.js
// Produces gedcom-chunks.json — merged into kb.json by scrape-kb.js.

const fs = require("fs");
const path = require("path");

const GED_FILE = path.join(__dirname, "..", "GLYMPH-2.ged");
const OUT_FILE = path.join(__dirname, "..", "gedcom-chunks.json");

function parseGedcom(text) {
  const lines = text.split(/\r?\n/);
  const records = [];
  let current = null;

  for (const raw of lines) {
    if (!raw.trim()) continue;
    const m = raw.match(/^(\d+)\s+(@\w+@\s+)?(\S+)(?:\s(.*))?$/);
    if (!m) continue;
    const level = parseInt(m[1], 10);
    const xref = m[2] ? m[2].trim().replace(/@/g, "") : null;
    const tag = m[3].replace(/@/g, "");
    const value = m[4] || "";

    if (level === 0 && xref) {
      current = { xref, type: tag, fields: [] };
      records.push(current);
    } else if (current) {
      current.fields.push({ level, tag, value });
    }
  }
  return records;
}

function getField(fields, startIdx, tag, baseLevel) {
  for (let i = startIdx; i < fields.length; i++) {
    if (fields[i].level <= baseLevel && i !== startIdx) break;
    if (fields[i].tag === tag) return fields[i].value;
  }
  return null;
}

function topLevelValues(fields, tag) {
  return fields.filter((f) => f.level === 1 && f.tag === tag).map((f) => f.value);
}

function eventText(fields, tag) {
  const idx = fields.findIndex((f) => f.level === 1 && f.tag === tag);
  if (idx === -1) return null;
  let date = null,
    place = null;
  for (let i = idx + 1; i < fields.length && fields[i].level > 1; i++) {
    if (fields[i].tag === "DATE") date = fields[i].value;
    if (fields[i].tag === "PLAC") place = fields[i].value;
  }
  const parts = [];
  if (date) parts.push(date);
  if (place) parts.push(place);
  return parts.length ? parts.join(", ") : null;
}

function main() {
  const raw = fs.readFileSync(GED_FILE, "utf-8");
  const records = parseGedcom(raw);

  const indis = {};
  const fams = {};
  for (const r of records) {
    if (r.type === "INDI") indis[r.xref] = r;
    if (r.type === "FAM") fams[r.xref] = r;
  }

  function personName(indi) {
    if (!indi) return "Unknown";
    const nameField = indi.fields.find((f) => f.level === 1 && f.tag === "NAME");
    if (!nameField) return "Unknown";
    return nameField.value.replace(/\//g, "").trim();
  }

  const chunks = [];
  let id = 0;

  for (const xref of Object.keys(indis)) {
    const indi = indis[xref];
    const name = personName(indi);
    const sex = topLevelValues(indi.fields, "SEX")[0] || null;
    const birth = eventText(indi.fields, "BIRT");
    const death = eventText(indi.fields, "DEAT");

    const famcXrefs = topLevelValues(indi.fields, "FAMC").map((v) => v.replace(/@/g, ""));
    const famsXrefs = topLevelValues(indi.fields, "FAMS").map((v) => v.replace(/@/g, ""));

    const parentNames = [];
    for (const fx of famcXrefs) {
      const fam = fams[fx];
      if (!fam) continue;
      const husb = topLevelValues(fam.fields, "HUSB")[0]?.replace(/@/g, "");
      const wife = topLevelValues(fam.fields, "WIFE")[0]?.replace(/@/g, "");
      if (husb && indis[husb]) parentNames.push(personName(indis[husb]));
      if (wife && indis[wife]) parentNames.push(personName(indis[wife]));
    }

    const spouseNames = [];
    const childNames = [];
    for (const fx of famsXrefs) {
      const fam = fams[fx];
      if (!fam) continue;
      const husb = topLevelValues(fam.fields, "HUSB")[0]?.replace(/@/g, "");
      const wife = topLevelValues(fam.fields, "WIFE")[0]?.replace(/@/g, "");
      const spouseXref = husb === xref ? wife : husb;
      if (spouseXref && indis[spouseXref]) spouseNames.push(personName(indis[spouseXref]));
      const chil = topLevelValues(fam.fields, "CHIL").map((v) => v.replace(/@/g, ""));
      for (const cx of chil) {
        if (indis[cx]) childNames.push(personName(indis[cx]));
      }
    }

    const parts = [`${name}.`];
    if (sex) parts.push(`Sex: ${sex === "M" ? "Male" : sex === "F" ? "Female" : sex}.`);
    if (birth) parts.push(`Born: ${birth}.`);
    if (death) parts.push(`Died: ${death}.`);
    if (parentNames.length) parts.push(`Parents: ${parentNames.join(" and ")}.`);
    if (spouseNames.length) parts.push(`Spouse(s): ${spouseNames.join(", ")}.`);
    if (childNames.length) parts.push(`Children: ${childNames.join(", ")}.`);

    const text = parts.join(" ");
    if (text.trim().length < 10) continue;

    chunks.push({
      id: id++,
      source: "family-tree",
      url: "https://glymphville.com/family-tree/",
      title: name,
      text,
    });
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), count: chunks.length, chunks }, null, 0));
  console.log(`Parsed ${chunks.length} individuals from GEDCOM -> ${OUT_FILE}`);
}

main();
