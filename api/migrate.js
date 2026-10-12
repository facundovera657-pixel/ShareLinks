"use strict";
// TEMPORAL — registra en registry/names.json los nombres de espacios creados
// antes de la unicidad. Borrar este archivo tras la migración.
const { list, get, put } = require("@vercel/blob");

const SECRET = "2054b5d34b8f5eea2f02a0fae89adee30698d5174af73331";

module.exports = async function handler(req, res) {
  if (req.query.secret !== SECRET) return res.status(404).json({ error: "nada aquí" });
  const names = {};
  let count = 0;
  let cursor;
  for (;;) {
    const page = await list({ prefix: "spaces/", limit: 100, cursor });
    for (const b of page.blobs || []) {
      try {
        const r = await get(b.pathname, { access: "private", useCache: false });
        if (!r || r.statusCode !== 200 || !r.stream) continue;
        const d = JSON.parse(await new Response(r.stream).text());
        const nm = !Array.isArray(d) && typeof d.name === "string" ? d.name.trim() : "";
        const idm = b.pathname.replace(/^spaces\//, "").replace(/\.json$/, "");
        if (nm) names[nm.toLowerCase()] = idm;
        count++;
      } catch {}
    }
    if (!page.hasMore) break;
    cursor = page.cursor;
  }
  await put("registry/names.json", JSON.stringify(names), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return res.status(200).json({ spaces: count, names: Object.keys(names).length });
};
