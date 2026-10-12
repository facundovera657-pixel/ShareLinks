"use strict";
// TEMPORAL — migra registry/names.json a reclamos names/<sha256>.json.
// Borrar este archivo tras la migración.
const crypto = require("crypto");
const { get, put } = require("@vercel/blob");

const SECRET = "dd0aea91604ad9b996180a8d2fd17a9c3057d2108d3a7ecd";

module.exports = async function handler(req, res) {
  if (req.query.secret !== SECRET) return res.status(404).json({ error: "nada aquí" });
  const r = await get("registry/names.json", { access: "private", useCache: false });
  const reg = r && r.statusCode === 200 && r.stream ? JSON.parse(await new Response(r.stream).text()) : {};
  let done = 0;
  let skipped = 0;
  for (const key of Object.keys(reg)) {
    const id = reg[key];
    if (typeof id !== "string" || !id) { skipped++; continue; }
    const path = `names/${crypto.createHash("sha256").update(String(key)).digest("hex")}.json`;
    try {
      await put(path, JSON.stringify({ id }), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
      });
      done++;
    } catch {
      skipped++; // ya reclamado
    }
  }
  return res.status(200).json({ ok: true, done, skipped, total: Object.keys(reg).length });
};
