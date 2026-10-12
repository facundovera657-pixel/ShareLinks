"use strict";
// Mock en memoria de @vercel/blob — misma semántica que usa la app:
// get→null si falta, put sin allowOverwrite falla si existe, del silencioso,
// head→ETag canónico, list paginado, ifMatch estricto.
const store = new Map(); // pathname -> { body, etag, contentType, uploadedAt }
let etagN = 0;

function notFound() {
  const e = new Error("not found");
  e.name = "BlobNotFoundError";
  e.code = "BlobNotFoundError";
  e.statusCode = 404;
  return e;
}
function conflict(msg) {
  const e = new Error(msg || "The blob already exists.");
  e.name = "BlobError";
  e.code = "conflict";
  e.statusCode = 409;
  return e;
}
function precond() {
  const e = new Error("Precondition failed: ETag mismatch.");
  e.name = "BlobPreconditionFailedError";
  e.code = "precondition_failed";
  e.statusCode = 412;
  return e;
}

async function put(pathname, body, options = {}) {
  const text = typeof body === "string" ? body : String(body);
  const cur = store.get(pathname);
  if (cur && !options.allowOverwrite) throw conflict();
  if (cur && options.ifMatch && options.ifMatch !== cur.etag) throw precond();
  const etag = `"mock-${++etagN}"`;
  store.set(pathname, { body: text, etag, contentType: options.contentType || "application/json", uploadedAt: new Date() });
  return { pathname, url: `mock://${pathname}`, downloadUrl: `mock://${pathname}?download=1`, etag };
}

async function get(pathname) {
  const cur = store.get(pathname);
  if (!cur) return null;
  return {
    statusCode: 200,
    stream: cur.body,
    blob: {
      url: `mock://${pathname}`,
      downloadUrl: `mock://${pathname}?download=1`,
      pathname,
      contentType: cur.contentType,
      contentDisposition: "",
      cacheControl: "",
      size: cur.body.length,
      uploadedAt: cur.uploadedAt,
      etag: cur.etag,
    },
  };
}

async function head(pathname) {
  const cur = store.get(pathname);
  if (!cur) throw notFound();
  return {
    url: `mock://${pathname}`,
    downloadUrl: `mock://${pathname}?download=1`,
    pathname,
    size: cur.body.length,
    contentType: cur.contentType,
    contentDisposition: "",
    cacheControl: "",
    uploadedAt: cur.uploadedAt,
    etag: cur.etag,
  };
}

async function del(urlOrPathnames) {
  const arr = Array.isArray(urlOrPathnames) ? urlOrPathnames : [urlOrPathnames];
  for (const p of arr) store.delete(String(p));
}

async function list(options = {}) {
  const prefix = options.prefix || "";
  const limit = Math.min(Math.max(options.limit || 100, 1), 1000);
  const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
  const start = options.cursor ? parseInt(options.cursor, 10) || 0 : 0;
  const slice = keys.slice(start, start + limit);
  const next = start + limit < keys.length ? String(start + limit) : null;
  return {
    blobs: slice.map((k) => {
      const c = store.get(k);
      return { pathname: k, url: `mock://${k}`, downloadUrl: `mock://${k}?download=1`, size: c.body.length, uploadedAt: c.uploadedAt };
    }),
    cursor: next,
    hasMore: !!next,
  };
}

module.exports = { put, get, head, del, list };
