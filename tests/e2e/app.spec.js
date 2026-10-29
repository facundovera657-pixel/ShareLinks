"use strict";
// E2E de la app real (UI → /api/space → Blob mock en memoria). Cero cuota.
const { test, expect, devices } = require("@playwright/test");

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const rnd = (n) => Array.from({ length: n }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join("");
const uniqName = (prefix = "Casa") => (prefix + rnd(12)).slice(0, 12);

let pageErrors = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
});

test.afterEach(async () => {
  expect(pageErrors, "errores JS en la página").toEqual([]);
});

async function createSpace(page) {
  const name = uniqName();
  await page.locator("#btnCreate").click();
  await expect(page.locator("#createForm")).toBeVisible();
  await page.locator("#inName").fill(name);
  await page.locator("#btnDoCreate").click();
  await expect(page.locator("#pill")).toContainText("nube");
  return name;
}

async function addLink(page, url) {
  await page.locator("#inUrl").fill(url);
  await page.locator("#btnAdd").click();
}

function storeKey(id) {
  return "sl_links_" + id;
}

test("arranque: solo el paso 1 y footer fijo abajo", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#pill")).toHaveText("● sin espacio");
  await expect(page.locator("#noSpace")).toBeVisible();
  await expect(page.locator("#secAdd")).toBeHidden();
  await expect(page.locator("#secList")).toBeHidden();

  const footer = page.locator("footer");
  await expect(footer).toBeVisible();
  expect(await footer.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
  const box = await footer.boundingBox();
  const vh = page.viewportSize().height;
  expect(Math.abs(box.y + box.height - vh)).toBeLessThanOrEqual(2);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("crear espacio: nombre inválido se rechaza y el válido persiste al recargar", async ({ page }) => {
  await page.goto("/");
  await page.locator("#btnCreate").click();
  await expect(page.locator("#createForm")).toBeVisible();

  for (const bad of ["abc", "12345", "con espacio"]) {
    await page.locator("#inName").fill(bad);
    await page.locator("#btnDoCreate").click();
    await expect(page.locator("#spaceStatus")).toContainText("5 a 12");
    await expect(page.locator("#pill")).toHaveText("● sin espacio");
  }

  const name = uniqName();
  await page.locator("#inName").fill(name);
  await page.locator("#btnDoCreate").click();

  await expect(page.locator("#pill")).toContainText(name);
  const id = (await page.locator("#myId").innerText()).trim();
  expect(id).toMatch(/^[A-Za-z0-9]{8}$/);
  await expect(page.locator("#secAdd")).toBeVisible();
  await expect(page.locator("#secList")).toBeVisible();
  expect(await page.locator("#qrImg svg").count()).toBeGreaterThan(0);
  await expect(page.locator("#shareHint")).toContainText("#id=" + id);

  await page.reload();
  await expect(page.locator("#myId")).toHaveText(id);
  await expect(page.locator("#pill")).toContainText(name);
  await expect(page.locator("#secAdd")).toBeVisible();
});

test("guardar link: basura rechazada, URL sin esquema normalizada y persistente", async ({ page }) => {
  await page.goto("/");
  await createSpace(page);

  await page.locator("#inUrl").fill("javascript:alert(1)");
  await page.locator("#btnAdd").click();
  await expect(page.locator("#addStatus")).toContainText("link válido");
  await expect(page.locator("#count")).toHaveText("0");

  await addLink(page, "ejemplo.com/ruta");
  await expect(page.locator("#count")).toHaveText("1");
  await expect(page.locator("#list .link")).toHaveCount(1);
  await expect(page.locator("#list")).toContainText("https://ejemplo.com/ruta");
  await expect(page.locator("#toast")).toContainText("guardado");

  await page.reload();
  await expect(page.locator("#count")).toHaveText("1");
  await expect(page.locator("#list")).toContainText("ejemplo.com");
});

test("borrar uno y borrar en lote deja tombstones", async ({ page }) => {
  await page.goto("/");
  await createSpace(page);

  await addLink(page, "https://uno.example/a");
  await addLink(page, "https://dos.example/b");
  await addLink(page, "https://tres.example/c");
  await expect(page.locator("#count")).toHaveText("3");

  // borrado individual
  await page.locator("#list .link").first().locator(".del").click();
  await expect(page.locator("#count")).toHaveText("2");

  // borrado en lote
  await page.locator("#btnSel").click();
  await page.locator("#btnAll").click();
  await expect(page.locator("#btnDelSel")).toHaveText("Borrar (2)");
  await page.locator("#btnDelSel").click();
  await expect(page.locator("#count")).toHaveText("0");
  await expect(page.locator("#empty")).toBeVisible();
  await expect(page.locator("#toast")).toContainText("2 borrados");

  const state = await page.evaluate(() => {
    const id = localStorage.getItem("sl_space_id");
    return JSON.parse(localStorage.getItem("sl_links_" + id));
  });
  expect(state.links).toHaveLength(0);
  expect(Object.keys(state.tombstones)).toHaveLength(3);

  await page.reload();
  await expect(page.locator("#count")).toHaveText("0");
});

test("exportar copia JSON e importar suma links al espacio", async ({ page }) => {
  await page.goto("/");
  await createSpace(page);
  await addLink(page, "https://export.example/x");
  await expect(page.locator("#count")).toHaveText("1");

  await page.locator("#btnExport").click();
  await expect(page.locator("#toast")).toContainText("Copiado");
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  const exported = JSON.parse(clip);
  expect(exported.links[0].url).toBe("https://export.example/x");

  // texto que vendría de otro aparato
  const incoming = JSON.stringify({
    links: [{ id: "imp" + Date.now().toString(36), url: "https://import.example/y", ts: Date.now() + 1000 }],
    tombstones: {},
  });
  await page.locator("#btnImport").click();
  await expect(page.locator("#impBox")).toBeVisible();
  await page.locator("#inImport").fill(incoming);
  await page.locator("#btnDoImport").click();
  await expect(page.locator("#count")).toHaveText("2");
  await expect(page.locator("#toast")).toContainText("Importados 1");

  await page.locator("#btnImport").click();
  await page.locator("#inImport").fill("no es json");
  await page.locator("#btnDoImport").click();
  await expect(page.locator("#toast")).toContainText("Texto inválido");
  await expect(page.locator("#count")).toHaveText("2");
});

test("otro aparato entra con el ID (o el enlace directo) y ve los mismos links", async ({ page, browser }) => {
  await page.goto("/");
  await createSpace(page);
  await addLink(page, "https://compartido.example/foto");
  await expect(page.locator("#count")).toHaveText("1");
  // esperar el push diferido (800ms) antes de abrir el otro aparato
  await expect(page.locator("#spaceStatus")).toContainText("Guardado en la nube", { timeout: 10_000 });
  const id = (await page.locator("#myId").innerText()).trim();

  const phone = await browser.newContext({
    ...devices["iPhone 13"],
    permissions: [],
  });
  const p2 = await phone.newPage();
  await p2.goto("/#id=" + id);
  await expect(p2.locator("#myId")).toHaveText(id);
  await expect(p2.locator("#pill")).toContainText("nube");
  await expect(p2.locator("#list")).toContainText("compartido.example");
  await expect(p2.locator("#count")).toHaveText("1");

  // y el enlace directo no queda pegado en la barra
  expect(new URL(p2.url()).hash).toBe("");
  await phone.close();
});

test("sin pedidos externos: el QR se genera localmente", async ({ page }) => {
  const external = [];
  page.on("request", (r) => {
    const host = new URL(r.url()).hostname;
    if (!["127.0.0.1", "localhost"].includes(host)) external.push(r.url());
  });

  await page.goto("/");
  await createSpace(page);
  await addLink(page, "https://local.example/qr");

  expect(await page.locator("#qrImg svg").count()).toBeGreaterThan(0);
  expect(external).toEqual([]);
});

test("PWA: manifest correcto y service worker registrado", async ({ page }) => {
  await page.goto("/");
  const manifest = await page.evaluate(async () => {
    const r = await fetch("/manifest.webmanifest");
    return { ok: r.ok, body: await r.json() };
  });
  expect(manifest.ok).toBe(true);
  expect(manifest.body.name).toBe("ShareLinks");
  expect(manifest.body.display).toBe("standalone");
  expect(manifest.body.icons.length).toBeGreaterThanOrEqual(2);

  await expect
    .poll(async () => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
});

test("layout: el footer no tapa contenido y los botones son táctiles", async ({ page }) => {
  await page.goto("/");
  await createSpace(page);
  await addLink(page, "https://layout.example/1");
  await addLink(page, "https://layout.example/2");

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const list = await page.locator("#secList").boundingBox();
  const footer = await page.locator("footer").boundingBox();
  expect(list.y + list.height).toBeLessThanOrEqual(footer.y + 1);

  const small = await page.evaluate(() =>
    [...document.querySelectorAll("button:not(.del)")]
      .filter((b) => b.offsetParent)
      .map((b) => ({ id: b.id || b.textContent.trim(), h: b.getBoundingClientRect().height }))
      .filter((x) => x.h < 36)
  );
  expect(small).toEqual([]);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("admin: login con secreto, crear, listar y borrar en lote", async ({ page }) => {
  const name = uniqName("Admin");
  await page.goto("/admin");
  await page.locator("#inSecret").fill("test-secret-e2e");
  await page.locator("#btnLogin").click();
  await expect(page.locator("#panel")).toBeVisible();

  await page.locator("#inName").fill(name);
  await page.locator("#btnMk").click();

  const row = page.locator("#rows tr", { hasText: name });
  await expect(row).toHaveCount(1);

  await page.locator("#btnASel").click();
  await row.locator(".aselbox").check();
  page.on("dialog", (d) => d.accept());
  await page.locator("#btnADel").click();

  await expect(page.locator("#listStatus")).toContainText("Borrados 1");
  await expect(page.locator("#rows tr", { hasText: name })).toHaveCount(0);
});
