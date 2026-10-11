"use strict";
// API propia de ShareLinks — guarda los links de cada espacio (ID) en Vercel Blob.
// Sin cuentas: quien conoce el ID puede leer/escribir ese espacio.
const crypto = require("crypto");
const { put, get } = require("@vercel/blob");

const validId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(id);
const pathOf = (id) => `spaces/${id}.json`;
const newId = () => crypto.randomBytes(6).toString("base64url"); // 8 caracteres

async function readLinks(id) {
  try {
    const res = await get(pathOf(id), { access: "private", useCache: false });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    const data = JSON.parse(await new Response(res.stream).text());
    return Array.isArray(data) ? data : data.links || null;
  } catch (e) {
    if (e && (e.name === "BlobNotFoundError" || e.code === "BlobNotFoundError")) return null;
    // get() también puede devolver null en vez de lanzar
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // Crear espacio
    if (req.method === "POST") {
      const links = Array.isArray(req.body && req.body.links) ? req.body.links : [];
      const id = newId();
      await put(pathOf(id), JSON.stringify({ links }), {
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
      const links = await readLinks(id);
      if (links === null) return res.status(404).json({ error: "Ese ID no existe" });
      return res.status(200).json({ links });
    }

    // Guardar espacio
    if (req.method === "PUT") {
      const links = req.body && req.body.links;
      if (!Array.isArray(links)) return res.status(400).json({ error: "links inválido" });
      const existing = await readLinks(id);
      if (existing === null) return res.status(404).json({ error: "Ese ID no existe" });
      await put(pathOf(id), JSON.stringify({ links }), {
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
