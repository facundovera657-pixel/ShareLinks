"use strict";
// API propia de ShareLinks — guarda los links de cada espacio (ID) en Vercel Blob.
// Sin cuentas: quien conoce el ID puede leer/escribir ese espacio.
const crypto = require("crypto");
const { put, get } = require("@vercel/blob");

const validId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(id);
const pathOf = (id) => `spaces/${id}.json`;
// Alfabeto sin caracteres ambiguos (0/O, 1/l/I) para que el ID se copie a mano sin errores
const ALPH = "23456789abcdefghjkmnpqrstuwxyzABCDEFGHJKMNPQRSTUVWXYZ";
const newId = () =>
  Array.from(crypto.randomBytes(8), (b) => ALPH[b % ALPH.length]).join("");

// Sanea links entrantes: solo items con id/url válidos, tope de cantidad y largo.
const MAX_LINKS = 1000;
const MAX_URL = 2048;
function cleanLinks(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const it of v) {
    if (out.length >= MAX_LINKS) break;
    if (!it || typeof it !== "object") continue;
    const id = typeof it.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(it.id) ? it.id : null;
    let url = typeof it.url === "string" ? it.url.trim().slice(0, MAX_URL) : "";
    if (url && !/^https?:\/\//i.test(url)) url = "";
    try { new URL(url); } catch { url = ""; }
    if (!id || !url) continue;
    out.push({ id, url, ts: Number.isFinite(it.ts) ? it.ts : Date.now() });
  }
  return out;
}

function isNotFound(e) {
  return !!e && (e.name === "BlobNotFoundError" || e.code === "BlobNotFoundError" || e.statusCode === 404);
}

// Sanea tombstones {linkId: ts}: claves válidas, ts numéricos, tope y poda >30 días.
const MAX_TOMB = 2000;
const TOMB_TTL = 30 * 24 * 3600 * 1000;
function cleanTombstones(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const entries = [];
  for (const k of Object.keys(v)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(k)) continue;
    if (!Number.isFinite(v[k])) continue;
    entries.push([k, v[k]]);
  }
  entries.sort((a, b) => b[1] - a[1]);
  const out = {};
  const now = Date.now();
  for (const [k, ts] of entries) {
    if (Object.keys(out).length >= MAX_TOMB) break;
    if (now - ts > TOMB_TTL) continue;
    out[k] = ts;
  }
  return out;
}

function cleanState(body) {
  const links = cleanLinks(body && body.links);
  if (!links) return null;
  return { links, tombstones: cleanTombstones(body.tombstones) };
}

// { status: "ok", store } | { status: "missing" } ; lanza ante errores reales
async function readStore(id) {
  let res = null;
  try {
    res = await get(pathOf(id), { access: "private", useCache: false });
  } catch (e) {
    if (isNotFound(e)) return { status: "missing" };
    throw e;
  }
  if (!res || res.statusCode !== 200 || !res.stream) return { status: "missing" };
  const data = JSON.parse(await new Response(res.stream).text());
  if (Array.isArray(data)) return { status: "ok", store: { links: data, tombstones: {} } }; // formato legacy
  return {
    status: "ok",
    store: {
      links: Array.isArray(data.links) ? data.links : [],
      tombstones:
        data.tombstones && typeof data.tombstones === "object" && !Array.isArray(data.tombstones)
          ? data.tombstones
          : {},
    },
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // Crear espacio
    if (req.method === "POST") {
      const store = cleanState(req.body) || { links: [], tombstones: {} };
      const id = newId();
      await put(pathOf(id), JSON.stringify(store), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
      });
      return res.status(200).json({ id });
    }

    const id = req.query && req.query.id;
    if (!validId(id)) return res.status(400).json({ error: "ID inválido" });

    // Leer espacio
    if (req.method === "GET") {
      const found = await readStore(id);
      if (found.status === "missing") return res.status(404).json({ error: "Ese ID no existe" });
      return res.status(200).json(found.store);
    }

    // Guardar espacio
    if (req.method === "PUT") {
      const store = cleanState(req.body);
      if (!store) return res.status(400).json({ error: "links inválido" });
      const found = await readStore(id);
      if (found.status === "missing") return res.status(404).json({ error: "Ese ID no existe" });
      await put(pathOf(id), JSON.stringify(store), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Método no permitido" });
  } catch (e) {
    console.error("space api error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
};
