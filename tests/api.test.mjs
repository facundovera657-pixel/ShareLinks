// Suite de auditoría ShareLinks — `node --test tests/` o `npm test`.
// Crea espacios reales de prueba (<1KB) en el backend apuntado por BASE_URL.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const BASE = process.env.BASE_URL || "https://sharelinks-pied.vercel.app";
const API = `${BASE}/api/space`;
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

// carga sync.js (script clásico de navegador) para testear la fusión sin duplicar código
const syncSrc = readFileSync(new URL("../sync.js", import.meta.url), "utf8");
const sandbox = {};
vm.createContext(sandbox);
sandbox.URL = URL; // el contexto vm no trae globales WHATWG; normUrl lo necesita
vm.runInContext(syncSrc, sandbox);
const { mergeStores, sameStore, normStore, normUrl, esc } = sandbox;
assert.equal(typeof mergeStores, "function");
assert.equal(typeof sameStore, "function");
assert.equal(typeof normUrl, "function");
assert.equal(typeof esc, "function");
// structuredClone trae valores del sandbox vm al realm actual (evita choques de prototipo en deepEqual)
const dc = (v) => structuredClone(v);

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

  test("GET sin id y con ids malformados → 400", async () => {
    for (const q of ["", "?id=", "?id=../etc", "?id=<script>", "?id=a".padEnd(100, "a"), "?id=a b", "?id=áéí"]) {
      const { status } = await req("GET", q);
      assert.equal(status, 400, `esperaba 400 para ${q}`);
    }
  });

  test("GET con formato válido pero inexistente (incl. __proto__) → 404 sin efectos", async () => {
    for (const q of ["?id=noexiste123abc", "?id=__proto__", "?id=abcdef12"]) {
      const { status, json } = await req("GET", q);
      assert.equal(status, 404, `esperaba 404 para ${q}`);
      assert.ok(json.error);
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

  test("IDs nuevos evitan caracteres ambiguos (0/O/1/l/I)", async () => {
    for (let i = 0; i < 3; i++) {
      const { json } = await req("POST", "", { links: [] });
      assert.match(json.id, ID_RE);
      assert.doesNotMatch(json.id, /[01lIO]/);
    }
  });

  test("tombstones viajan en PUT/GET y se sanean", async () => {
    const { json: c } = await req("POST", "", { links: [] });
    const link = mkLink(1);
    const tomb = { [link.id]: Date.now(), mala: "x", ["__proto__"]: 123, corta: 1 };
    const p = await req("PUT", `?id=${c.id}`, { links: [], tombstones: { ...tomb, [link.id]: tomb[link.id] } });
    assert.equal(p.status, 200);
    const g = await req("GET", `?id=${c.id}`);
    assert.deepEqual(g.json.links, []);
    assert.equal(g.json.tombstones[link.id], tomb[link.id]);
    assert.ok(!("mala" in g.json.tombstones));
  });

  test("borrado se propaga entre dos dispositivos (tombstones)", async () => {
    const A = mkLink(1), B = mkLink(2);
    const { json: c } = await req("POST", "", { links: [A, B] });
    // dispositivo 1 borra A
    const dev1 = mergeStores({ links: [A, B], tombstones: {} }, { links: [A, B], tombstones: {} });
    dev1.links = dev1.links.filter((l) => l.id !== A.id);
    dev1.tombstones[A.id] = Date.now();
    await req("PUT", `?id=${c.id}`, dev1);
    // dispositivo 2 tenía todo y sincroniza
    const cloud = (await req("GET", `?id=${c.id}`)).json;
    const dev2 = mergeStores({ links: [A, B], tombstones: {} }, cloud);
    assert.deepEqual(dc(dev2.links.map((l) => l.id)), [B.id]);
    // dispositivo 2 re-sube y A sigue borrado (no resucita)
    await req("PUT", `?id=${c.id}`, dev2);
    const g = await req("GET", `?id=${c.id}`);
    assert.deepEqual(g.json.links.map((l) => l.id), [B.id]);
  });

  test("link agregado offline sobrevive al pull (fusión)", async () => {
    const A = mkLink(1), B = mkLink(2);
    const { json: c } = await req("POST", "", { links: [A] });
    const cloud = (await req("GET", `?id=${c.id}`)).json;
    const merged = mergeStores({ links: [B], tombstones: {} }, cloud);
    assert.deepEqual(dc(merged.links.map((l) => l.id)).sort(), [A.id, B.id].sort());
  });

  test("servidor normaliza URL multilínea al primer token", async () => {
    const { json: c } = await req("POST", "", { links: [] });
    await req("PUT", `?id=${c.id}`, { links: [{ id: "n", url: "https://a.com\nhttps://evil.com", ts: 1 }] });
    const g = await req("GET", `?id=${c.id}`);
    assert.deepEqual(g.json.links, [{ id: "n", url: "https://a.com", ts: 1 }]);
  });

  test("servidor trunca URL gigante a 2048", async () => {
    const { json: c } = await req("POST", "", { links: [] });
    await req("PUT", `?id=${c.id}`, { links: [{ id: "big", url: "https://a.com/" + "x".repeat(100000), ts: 1 }] });
    const g = await req("GET", `?id=${c.id}`);
    assert.equal(g.json.links.length, 1);
    assert.ok(g.json.links[0].url.length <= 2048);
  });

  test("DELETE → 405 y OPTIONS → CORS", async () => {
    const d = await req("DELETE", "?id=abcdef12");
    assert.equal(d.status, 405);
    const o = await fetch(API + "?id=abcdef12", { method: "OPTIONS" });
    assert.equal(o.status, 200);
    assert.equal(o.headers.get("access-control-allow-origin"), "*");
  });
});

describe("inputs: normUrl y esc (unitario)", () => {
  test("normUrl acepta y normaliza", () => {
    assert.equal(normUrl("https://ejemplo.com/a"), "https://ejemplo.com/a");
    assert.equal(normUrl("ejemplo.com"), "https://ejemplo.com");
    assert.equal(normUrl("  https://ejemplo.com  "), "https://ejemplo.com");
    assert.equal(normUrl("HTTP://EJEMPLO.COM"), "HTTP://EJEMPLO.COM");
  });

  test("normUrl rechaza esquemas peligrosos y basura", () => {
    for (const u of ["", "   ", "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x",
                     "vbscript:msgbox(1)", "file:///etc/passwd", "ftp://a.com"]) {
      assert.equal(normUrl(u), "", `esperaba "" para ${JSON.stringify(u)}`);
    }
    // "notaurl" sola sí es válida (se asume https://notaurl)
    assert.equal(normUrl("notaurl"), "https://notaurl");
  });

  test("normUrl toma el primer token ante pega multilínea", () => {
    assert.equal(normUrl("https://a.com\nhttps://evil.com"), "https://a.com");
    assert.equal(normUrl("https://a.com https://b.com"), "https://a.com");
  });

  test("normUrl limpia invisibles y aplica tope 2048", () => {
    assert.equal(normUrl("https://a.com/\u200bx"), "https://a.com/x"); // Cf se elimina
    assert.equal(normUrl("https://a.com/\u2028x"), "https://a.com"); // separador corta tokens
    assert.equal(normUrl("https://a.com/" + "x".repeat(3000)), "");
    assert.ok(normUrl("https://a.com/" + "x".repeat(2000)).length <= 2048);
  });

  test("esc neutraliza HTML", () => {
    assert.equal(esc('<script>alert(1)</script>'), "&lt;script&gt;alert(1)&lt;/script&gt;");
    assert.equal(esc('"onmouseover="x'), "&quot;onmouseover=&quot;x");
    assert.equal(esc("a'b&c"), "a&#39;b&amp;c");
  });
});

describe("mergeStores (unitario)", () => {
  test("normStore migra array legacy y basura", () => {
    assert.deepEqual(dc(normStore([{ id: "a" }, null, 42])), { links: [{ id: "a" }], tombstones: {} });
    assert.deepEqual(dc(normStore(null)), { links: [], tombstones: {} });
    assert.deepEqual(dc(normStore({})), { links: [], tombstones: {} });
  });

  test("gana el link más reciente y el borrado posterior elimina", () => {
    const old = { id: "x", url: "https://a.com", ts: 100 };
    const neu = { id: "x", url: "https://b.com", ts: 200 };
    assert.deepEqual(dc(mergeStores({ links: [old], tombstones: {} }, { links: [neu], tombstones: {} }).links), [neu]);
    const m = mergeStores({ links: [neu], tombstones: {} }, { links: [], tombstones: { x: 300 } });
    assert.deepEqual(dc(m.links), []);
    // borrado anterior al link no lo elimina
    const m2 = mergeStores({ links: [], tombstones: { x: 50 } }, { links: [neu], tombstones: {} });
    assert.deepEqual(dc(m2.links), [neu]);
  });

  test("sameStore ignora el orden", () => {
    const A = { id: "a", url: "https://a.com", ts: 1 };
    const B = { id: "b", url: "https://b.com", ts: 2 };
    assert.ok(sameStore({ links: [A, B], tombstones: {} }, { links: [B, A], tombstones: {} }));
    assert.ok(!sameStore({ links: [A], tombstones: {} }, { links: [A, B], tombstones: {} }));
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
    assert.match(html, /src="\/vendor\/qrcode\.min\.js"/);
    assert.match(html, /src="\/sync\.js"/);
    assert.match(html, /autocapitalize="off"/);
    assert.match(html, /enterkeyhint="go"/);
    assert.match(html, /enterkeyhint="send"/);
    assert.equal((html.match(/addEventListener\("keydown"/g) || []).length, 2); // Enter en ID y en URL
    assert.doesNotMatch(html, /qrserver/);
  });

  test("vendor qrcode servido y genera QR", async () => {
    const r = await fetch(BASE + "/vendor/qrcode.min.js");
    assert.equal(r.status, 200);
    assert.ok((await r.text()).length > 10000);
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
    assert.match(js, /\/sync\.js/);
    new (await import("node:vm").then((m) => m.Script))(js); // sintaxis válida
  });

  test("sync.js servido", async () => {
    const r = await fetch(BASE + "/sync.js");
    assert.equal(r.status, 200);
    assert.match(await r.text(), /mergeStores/);
  });
});
