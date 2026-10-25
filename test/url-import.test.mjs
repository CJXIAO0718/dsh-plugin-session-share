import { pathToFileURL } from "node:url";
import path from "node:path";

const entry = path.resolve(import.meta.dirname, "../lib/index.js");
const plain = pathToFileURL(entry).href;
const encoded = plain.replace(/[^\/?&=#%A-Za-z0-9._~:-]/g, (c) => encodeURIComponent(c));

const results = [];
for (const [label, url] of [["plain", plain], ["percent-encoded", encoded]]) {
  try {
    const m = await import(url);
    results.push({ label, ok: true, name: m.name, exports: Object.keys(m).sort() });
  } catch (e) {
    results.push({ label, ok: false, error: String(e && e.message) });
  }
}
console.log(JSON.stringify({ entry, plain, encoded, results }, null, 1));
process.exit(results.some((r) => !r.ok) ? 1 : 0);
