// Reads a schedule file into rows of cells: { v: value | null, fill: colour | null }.
//   .csv  -> text only (no colours)
//   .xlsx -> text, dates, and cell fill colours (colours mark "keep the same crew" groups)
// No libraries: an .xlsx is a zip of XML files, opened here with the browser's built-in
// decompression. Legacy .xls is not supported (save it as .xlsx or .csv first).

const dec = new TextDecoder();

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Minimal zip reader: returns { names, get(name) -> Uint8Array | null }
function openZip(buf) {
  const b = new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) {
    if (u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This doesn't look like an .xlsx file.");
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (u32(b, p) !== 0x02014b50) break;
    const method = u16(b, p + 10);
    const csize = u32(b, p + 20);
    const nlen = u16(b, p + 28);
    const elen = u16(b, p + 30);
    const clen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
    entries.set(name, { method, csize, local });
    p += 46 + nlen + elen + clen;
  }
  return {
    names: [...entries.keys()],
    async get(name) {
      const e = entries.get(name);
      if (!e) return null;
      const start = e.local + 30 + u16(b, e.local + 26) + u16(b, e.local + 28);
      const data = b.subarray(start, start + e.csize);
      return e.method === 0 ? data : inflateRaw(data);
    },
  };
}

const unxml = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const attr = (s, name) => {
  const m = s.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? unxml(m[1]) : null;
};

const colIndex = (letters) => {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
    unxml([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""))
  );
}

function parseStyles(xml) {
  const fills = [];
  const fillsBlock = (xml.match(/<fills\b[^>]*>([\s\S]*?)<\/fills>/) || [])[1] || "";
  for (const f of fillsBlock.matchAll(/<fill\b[^>]*>([\s\S]*?)<\/fill>/g)) {
    const pattern = attr(f[1], "patternType");
    const fg = (f[1].match(/<fgColor\b([^>]*)\/?>/) || [])[1];
    if (pattern !== "solid" || !fg) {
      fills.push(null);
      continue;
    }
    const rgb = attr(fg, "rgb");
    const theme = attr(fg, "theme");
    const indexed = attr(fg, "indexed");
    fills.push(
      rgb ? `rgb:${rgb.toUpperCase()}` : theme != null ? `theme:${theme}:${attr(fg, "tint") || 0}` : indexed != null ? `indexed:${indexed}` : null
    );
  }
  const numFmts = new Map();
  for (const m of xml.matchAll(/<numFmt\b([^>]*)\/?>/g)) numFmts.set(+attr(m[1], "numFmtId"), attr(m[1], "formatCode") || "");
  const xfBlock = (xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || "";
  const xfs = [...xfBlock.matchAll(/<xf\b([^>]*?)\/?>/g)].map((m) => ({
    fill: fills[+(attr(m[1], "fillId") || 0)] || null,
    numFmt: +(attr(m[1], "numFmtId") || 0),
  }));
  return { xfs, numFmts };
}

function isDateFmt(id, code) {
  if ((id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58)) return true;
  if (!code) return false;
  const c = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  return /[ymdhs]/i.test(c);
}

// An Excel time cell showing "6:00" is stored as 6 AM even though the person meant 6 PM.
// Hours 1-7 are therefore passed on WITHOUT am/pm, so they are read exactly like the
// bare "6:00" text in a CSV (afternoon, flagged as an assumption). 8 AM onward is kept.
// A cell whose number format shows AM/PM was typed with one, so it is kept exactly.
function timeText(fraction, explicitAmPm) {
  let mins = Math.round(fraction * 24 * 60);
  const h24 = Math.floor(mins / 60) % 24;
  mins %= 60;
  const mm = String(mins).padStart(2, "0");
  if (!explicitAmPm && h24 >= 1 && h24 <= 7) return `${h24}:${mm}`;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${mm} ${h24 < 12 ? "AM" : "PM"}`;
}

export async function readXlsx(arrayBuffer) {
  const zip = openZip(arrayBuffer);
  const text = async (n) => {
    const d = await zip.get(n);
    return d ? dec.decode(d) : null;
  };
  const wb = await text("xl/workbook.xml");
  const rels = (await text("xl/_rels/workbook.xml.rels")) || "";
  if (!wb) throw new Error("This doesn't look like an .xlsx file.");
  const shared = parseSharedStrings(await text("xl/sharedStrings.xml"));
  const { xfs, numFmts } = parseStyles((await text("xl/styles.xml")) || "");

  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = attr(m[1], "name");
    const rid = attr(m[1], "r:id");
    const rel = [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].find((r) => attr(r[1], "Id") === rid);
    let target = rel ? attr(rel[1], "Target") : null;
    if (!target) continue;
    target = target.startsWith("/") ? target.slice(1) : "xl/" + target;
    const xml = await text(target);
    if (!xml) continue;

    const rows = [];
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rIdx = +attr(rm[1], "r") - 1;
      const cells = [];
      for (const cm of (rm[2] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(cm[1], "r") || "";
        const col = colIndex((ref.match(/^[A-Z]+/) || ["A"])[0]);
        const xf = xfs[+(attr(cm[1], "s") || 0)] || { fill: null, numFmt: 0 };
        const t = attr(cm[1], "t");
        const inner = cm[2] || "";
        const raw = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let v = null;
        if (t === "s" && raw != null) v = shared[+raw] ?? null;
        else if (t === "inlineStr") v = unxml([...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
        else if ((t === "str" || t === "e") && raw != null) v = unxml(raw);
        else if (t === "b" && raw != null) v = raw === "1";
        else if (raw != null && raw !== "") {
          const num = Number(raw);
          if (isDateFmt(xf.numFmt, numFmts.get(xf.numFmt))) {
            const code = numFmts.get(xf.numFmt) || "";
            const explicit = xf.numFmt === 18 || xf.numFmt === 19 || /AM\/PM|A\/P/i.test(code);
            v = num < 1 ? timeText(num, explicit) : new Date(Date.UTC(1899, 11, 30) + Math.round(num * 86400000));
          } else v = num;
        }
        cells[col] = { v, fill: xf.fill };
      }
      rows[rIdx] = Array.from(cells, (c) => c || { v: null, fill: null });
    }
    const merged = [...xml.matchAll(/<mergeCell\b([^>]*)\/?>/g)].map((x) => attr(x[1], "ref"));
    sheets.push({ name, rows: Array.from(rows, (r) => r || []), merged });
  }
  return sheets;
}

export function readCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let q = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return [{ name: "CSV", rows: rows.map((r) => r.map((v) => ({ v: v === "" ? null : v, fill: null }))), merged: [] }];
}

export async function readScheduleFile(file) {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".xlsx")) return readXlsx(await file.arrayBuffer());
  if (name.endsWith(".csv") || name.endsWith(".txt")) return readCsv(await file.text());
  if (name.endsWith(".xls")) throw new Error("Old .xls files can't be read. In Excel, choose File > Save As > .xlsx (or .csv) and upload that.");
  throw new Error("Please upload an .xlsx or .csv file.");
}
