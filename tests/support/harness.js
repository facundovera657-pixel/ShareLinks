"use strict";
// Harness de tests locales: redirige require("@vercel/blob") al mock en memoria
// (solo dentro de este proceso; producción no se toca) + sirve archivos estáticos.
const Module = require("module");
const path = require("path");
const fs = require("fs");
const http = require("http");

const mockPath = path.join(__dirname, "mock-blob.js");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "@vercel/blob") return mockPath;
  return origResolve.call(this, request, ...args);
};

const spaceHandler = require("../../api/space.js");
const adminHandler = require("../../api/admin.js");

function mockFetch(api, method, urlPath, body, headers) {
  const u = new URL(urlPath, "http://test");
  const query = {};
  for (const k of new Set([...u.searchParams.keys()])) {
    const all = u.searchParams.getAll(k);
    query[k] = all.length > 1 ? all : all[0];
  }
  const reqHeaders = {};
  for (const k of Object.keys(headers || {})) reqHeaders[k.toLowerCase()] = headers[k];
  const req = { method, query, body, headers: reqHeaders };
  let statusCode = 200;
  const headersOut = {};
  let payload;
  const res = {
    setHeader: (k, v) => { headersOut[String(k).toLowerCase()] = v; return res; },
    status: (c) => { statusCode = c; return res; },
    json: (o) => { payload = o; return res; },
    end: () => res,
  };
  const handler = api === "admin" ? adminHandler : spaceHandler;
  return Promise.resolve()
    .then(() => handler(req, res))
    .then(() => ({ status: statusCode, json: payload === undefined ? null : payload, headers: { get: (k) => headersOut[String(k).toLowerCase()] ?? null } }));
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
};
const ROOT = path.join(__dirname, "..", "..");

function startStatic() {
  return new Promise((resolve) => {
    const srv = http.createServer((rq, rs) => {
      try {
        let p = decodeURIComponent(new URL(rq.url, "http://x").pathname);
        if (p.endsWith("/")) p += "index.html";
        if (p === "/admin") p = "/admin.html";
        const file = path.normalize(path.join(ROOT, p));
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          rs.writeHead(404); rs.end(); return;
        }
        rs.writeHead(200, {
          "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "Referrer-Policy": "strict-origin-when-cross-origin",
        });
        fs.createReadStream(file).pipe(rs);
      } catch {
        rs.writeHead(500); rs.end();
      }
    });
    srv.listen(0, "127.0.0.1", () => resolve({ server: srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

// Servidor completo para E2E: estáticos + /api/space y /api/admin reales
// (con el mock de Blob en memoria). Permite que un navegador real ejercite
// los flujos de punta a punta sin tocar Vercel.
function startServer({ port = 4321, host = "127.0.0.1" } = {}) {
  function readBody(rq) {
    return new Promise((resolve) => {
      let raw = "";
      rq.on("data", (c) => { raw += c; if (raw.length > 2e6) rq.destroy(); });
      rq.on("end", () => {
        try { resolve(raw ? JSON.parse(raw) : undefined); } catch { resolve(undefined); }
      });
    });
  }

  function sendJson(rs, status, obj, headers) {
    const out = obj === undefined ? "" : JSON.stringify(obj);
    rs.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(out),
      ...(headers || {}),
    });
    rs.end(out);
  }

  return new Promise((resolve, reject) => {
    const srv = http.createServer(async (rq, rs) => {
      try {
        const u = new URL(rq.url, "http://x");
        const p = decodeURIComponent(u.pathname);

        if (p === "/health") { rs.writeHead(200); rs.end("ok"); return; }

        if (p === "/api/space" || p === "/api/admin") {
          const query = {};
          for (const k of new Set([...u.searchParams.keys()])) {
            const all = u.searchParams.getAll(k);
            query[k] = all.length > 1 ? all : all[0];
          }
          const body = await readBody(rq);
          let statusCode = 200;
          const headersOut = {};
          let payload;
          const res = {
            setHeader: (k, v) => { headersOut[String(k).toLowerCase()] = v; return res; },
            status: (c) => { statusCode = c; return res; },
            json: (o) => { payload = o; return res; },
            end: () => res,
          };
          const handler = p === "/api/admin" ? adminHandler : spaceHandler;
          await handler({ method: rq.method, query, body, headers: rq.headers }, res);
          sendJson(rs, statusCode, payload, headersOut);
          return;
        }

        let filePath = p.endsWith("/") ? p + "index.html" : p;
        if (filePath === "/admin") filePath = "/admin.html";
        const file = path.normalize(path.join(ROOT, filePath));
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          rs.writeHead(404); rs.end(); return;
        }
        rs.writeHead(200, {
          "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "Referrer-Policy": "strict-origin-when-cross-origin",
        });
        fs.createReadStream(file).pipe(rs);
      } catch {
        try { sendJson(rs, 500, { error: "Error interno" }); } catch { rs.writeHead(500); rs.end(); }
      }
    });
    srv.on("error", reject);
    srv.listen(port, host, () => resolve({ server: srv, base: `http://${host}:${port}` }));
  });
}

module.exports = { mockFetch, startStatic, startServer };
