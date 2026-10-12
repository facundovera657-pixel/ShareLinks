"use strict";
// Panel admin de ShareLinks — lista, lee y borra espacios.
// Todo exige el secreto de la variable de entorno ADMIN_SECRET (header x-admin-secret).
// Sin secreto configurado o inválido: 401. Nada sensible se cachea.
const crypto = require("crypto");
const { list, get, del } = require("@vercel/blob");

const validId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(id);
const pathOf = (id) => `spaces/${id}.json`;

function authed(req) {
  const s = process.env.ADMIN_SECRET;
  if (!s) return false;
  const got = req.headers["x-admin-secret"];
  if (typeof got !== "string" || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(s);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isNotFound(e) {
  return !!e && (e.name === "BlobNotFoundError" || e.code === "BlobNotFoundError" || e.statusCode === 404);
}

async function readJson(pathname) {
  const res = await get(pathname, { access: "private", useCache: false });
  if (!res || res.statusCode !== 200 || !res.stream) return { data: null, etag: null };
  const etag = res.blob && res.blob.etag ? res.blob.etag : null;
  try {
    return { data: JSON.parse(await new Response(res.stream).text()), etag };
  } catch {
    return { data: null, etag };
  }
}

async function readStore(id) {
  try {
    const { data } = await readJson(pathOf(id));
    if (!data) return { status: "missing" };
    if (Array.isArray(data)) return { status: "ok", store: { links: data, tombstones: {}, name: "", created: 0 } };
    return {
      status: "ok",
      store: {
        links: Array.isArray(data.links) ? data.links : [],
        tombstones: data.tombstones && typeof data.tombstones === "object" && !Array.isArray(data.tombstones) ? data.tombstones : {},
        name: typeof data.name === "string" ? data.name : "",
        created: Number.isFinite(data.created) ? data.created : 0,
      },
    };
  } catch (e) {
    if (isNotFound(e)) return { status: "missing" };
    throw e;
  }
}

// Libera el nombre borrando su reclamo (del no falla si no existe).
async function releaseName(name) {
  if (!name) return;
  try {
    await del(`names/${crypto.createHash("sha256").update(name.toLowerCase()).digest("hex")}.json`);
  } catch {}
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Secret");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!authed(req)) return res.status(401).json({ error: "No autorizado." });

  try {
    // GET ?action=list&limit=&cursor= → resumen paginado (sin links completos)
    if (req.method === "GET" && req.query.action !== "read") {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
      const page = await list({ prefix: "spaces/", limit, cursor: req.query.cursor || undefined });
      const spaces = await Promise.all(
        (page.blobs || []).map(async (b) => {
          const id = b.pathname.replace(/^spaces\//, "").replace(/\.json$/, "");
          try {
            const { data } = await readJson(b.pathname);
            const links = data && !Array.isArray(data) && Array.isArray(data.links) ? data.links.length : Array.isArray(data) ? data.length : 0;
            const name = data && !Array.isArray(data) && typeof data.name === "string" ? data.name : "";
            const created = data && !Array.isArray(data) && Number.isFinite(data.created) ? data.created : 0;
            return { id, name, links, created, updated: b.uploadedAt || null, size: b.size || 0 };
          } catch {
            return { id, name: "", links: 0, created: 0, updated: b.uploadedAt || null, size: b.size || 0 };
          }
        })
      );
      spaces.sort((a, b2) => (b2.created || 0) - (a.created || 0));
      return res.status(200).json({ spaces, cursor: page.cursor || null, hasMore: !!page.hasMore, count: spaces.length });
    }

    // GET ?action=read&id= → espacio completo
    if (req.method === "GET") {
      const id = req.query.id;
      if (!validId(id)) return res.status(400).json({ error: "ID inválido." });
      const found = await readStore(id);
      if (found.status === "missing") return res.status(404).json({ error: "Ese ID no existe." });
      return res.status(200).json(found.store);
    }

    // DELETE ?id= → borra espacio y libera el nombre
    if (req.method === "DELETE") {
      const id = req.query.id;
      if (!validId(id)) return res.status(400).json({ error: "ID inválido." });
      const found = await readStore(id);
      if (found.status === "missing") return res.status(404).json({ error: "Ese ID no existe." });
      await del(pathOf(id));
      await releaseName(found.store.name);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Método no permitido." });
  } catch (e) {
    console.error("admin api error:", e);
    return res.status(500).json({ error: "Error interno." });
  }
};
