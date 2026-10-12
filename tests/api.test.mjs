// Suite de auditoría ShareLinks — `node --test tests/` o `npm test`.
// Crea espacios reales de prueba (<1KB) en el backend apuntado por BASE_URL.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL || "https://sharelinks-pied.vercel.app";
const API = `${BASE}/api/space`;
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

async function req(method, path = "", body) {
  const r = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, json, headers: r.headers };
}
const mkLink = (i) => ({ id: `t${Date.now().toString(36)}${i}`, url: `https://ejemplo.com/p${i}`, ts: Date.now() });

describe("API /api/space", () => {
  test("POST crea espacio y devuelve ID válido", async () => {
    const { status, json } = await req("POST", "", { links: [] });
    assert.equal(status, 200);
    assert.match(json.id, ID_RE);
  });

  test("IDs generados son únicos", async () => {
    const ids = new Set();
    for (let i = 0; i < 5; i++) {
      const { json } = await req("POST", "", { links: [] });
      ids.add(json.id);
    }
    assert.equal(ids.size, 5);
  });

  test("ciclo completo: crear → leer vacío → guardar → leer con datos", async () => {
    const { json: c } = await req("POST", "", { links: [] });
    const g1 = await req("GET", `?id=${c.id}`);
    assert.equal(g1.status, 200);
    assert.deepEqual(g1.json.links, []);
    const links = [mkLink(1), mkLink(2)];
    const p = await req("PUT", `?id=${c.id}`, { links });
    assert.equal(p.status, 200);
    assert.deepEqual(p.json, { ok: true });
    const g2 = await req("GET", `?id=${c.id}`);
    assert.equal(g2.status, 200);
    assert.deepEqual(g2.json.links, links);
  });

  test("POST con links iniciales los persiste", async () => {
    const links = [mkLink(1)];
    const { json: c } = await req("POST", "", { links });
    const g = await req("GET", `?id=${c.id}`);
    assert.deepEqual(g.json.links, links);
  });

  test("PUT sobrescribe (last-write-wins)", async () => {
    const { json: c } = await req("POST", "", { links: [mkLink(1)] });
    const v2 = [mkLink(2)];
    await req("PUT", `?id=${c.id}`, { links: v2 });
    const g = await req("GET", `?id=${c.id}`);
    assert.deepEqual(g.json.links, v2);
  });

  test("GET de ID inexistente → 404", async () => {
    const { status } = await req("GET", "?id=noexiste123abc");
    assert.equal(status, 404);
  });

  test("PUT a ID inexistente → 404", async () => {
    const { status } = await req("PUT", "?id=noexiste123abc", { links: [] });
    assert.equal(status, 404);
  });

  test("GET sin id y con ids maliciosos → 400", async () => {
    for (const q of ["", "?id=", "?id=../etc", "?id=<script>", "?id=a".padEnd(100, "a"),
                     "?id=__proto__", "?id=a b", "?id=áéí"]) {
      const { status } = await req("GET", q);
      assert.equal(status, 400, `esperaba 400 para ${q}`);
    }
  });

  test("PUT con body inválido → 400; array solo-basura → 200 con []", async () => {
    const { json: c } = await req("POST", "", { links: [] });
    for (const body of [{}, { links: "x" }, { links: null }]) {
      const { status } = await req("PUT", `?id=${c.id}`, body);
      assert.equal(status, 400, JSON.stringify(body));
    }
    const p = await req("PUT", `?id=${c.id}`, { links: [null, 42, {}] });
    assert.equal(p.status, 200);
    const g = await req("GET", `?id=${c.id}`);
    assert.deepEqual(g.json.links, []);
  });

  test("PUT sanea items malformados en vez de romper", async () => {
    const { json: c } = await req("POST", "", { links: [] });
    const good = mkLink(9);
    const p = await req("PUT", `?id=${c.id}`, {
      links: [null, 42, {}, { id: "x", url: "javascript:alert(1)" }, { id: good.id, url: "notaurl" }, good],
    });
    assert.equal(p.status, 200);
    const g = await req("GET", `?id=${c.id}`);
    assert.deepEqual(g.json.links, [good]);
  });

  test("DELETE → 405 y OPTIONS → CORS", async () => {
    const d = await req("DELETE", "?id=abcdef12");
    assert.equal(d.status, 405);
    const o = await fetch(API + "?id=abcdef12", { method: "OPTIONS" });
    assert.equal(o.status, 200);
    assert.equal(o.headers.get("access-control-allow-origin"), "*");
  });
});

describe("frontend y PWA", () => {
  test("index responde 200 con manifest, theme-color y registro del SW", async () => {
    const r = await fetch(BASE + "/");
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
    assert.match(html, /name="theme-color"/);
    assert.match(html, /navigator\.serviceWorker\.register\("\/sw\.js"\)/);
    assert.match(html, /navigator\.share/);
  });

  test("headers de seguridad presentes", async () => {
    const r = await fetch(BASE + "/");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.ok((r.headers.get("referrer-policy") || "").includes("strict-origin"));
  });

  test("manifest válido con iconos 192 y 512 existentes", async () => {
    const r = await fetch(BASE + "/manifest.webmanifest");
    assert.equal(r.status, 200);
    assert.ok((r.headers.get("content-type") || "").includes("manifest"));
    const m = await r.json();
    assert.equal(m.display, "standalone");
    assert.equal(m.start_url, "/");
    for (const icon of m.icons) {
      const ir = await fetch(BASE + icon.src);
      assert.equal(ir.status, 200, icon.src);
      assert.ok((ir.headers.get("content-type") || "").includes("png"));
    }
    assert.ok(m.icons.some((i) => i.sizes === "192x192"));
    assert.ok(m.icons.some((i) => i.sizes === "512x512"));
  });

  test("sw.js servido y excluye /api/", async () => {
    const r = await fetch(BASE + "/sw.js");
    assert.equal(r.status, 200);
    const js = await r.text();
    assert.match(js, /\/api\//);
    new (await import("node:vm").then((m) => m.Script))(js); // sintaxis válida
  });
});
