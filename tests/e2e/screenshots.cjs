"use strict";
// Capturas reales de la UI (servidor + mock local) para auditorías visuales.
// Uso: npm run test:e2e:shots  → test-results/shots/*.png
const path = require("path");
const fs = require("fs");
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "test-secret-e2e";
const { chromium, devices } = require("@playwright/test");
const { startServer } = require("../support/harness.js");

const OUT = path.join(__dirname, "..", "..", "test-results", "shots");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, base } = await startServer({ port: 4399 });
  const browser = await chromium.launch();

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  const page = await desktop.newPage();
  await page.goto(base + "/");
  await page.locator("#btnCreate").click();
  await page.locator("#inName").fill("MiCasa");
  await page.locator("#btnDoCreate").click();
  await page.locator("#pill").filter({ hasText: "nube" }).waitFor();

  for (const url of ["https://ejemplo.com/nota", "github.com/facundovera657-pixel/ShareLinks", "https://youtube.com/watch?v=abc"]) {
    await page.locator("#inUrl").fill(url);
    await page.locator("#btnAdd").click();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, "desktop.png") });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, "desktop-bottom.png") });

  const id = (await page.locator("#myId").innerText()).trim();
  const phone = await browser.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 2 });
  const p2 = await phone.newPage();
  await p2.goto(base + "/#id=" + id);
  await p2.locator("#list .link").first().waitFor();
  await p2.screenshot({ path: path.join(OUT, "mobile.png") });
  await p2.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p2.waitForTimeout(200);
  await p2.screenshot({ path: path.join(OUT, "mobile-bottom.png") });

  const admin = await desktop.newPage();
  await admin.goto(base + "/admin");
  await admin.locator("#inSecret").fill("test-secret-e2e");
  await admin.locator("#btnLogin").click();
  await admin.locator("#rows tr").first().waitFor();
  await admin.screenshot({ path: path.join(OUT, "admin.png") });

  await browser.close();
  server.close();
  console.log("Capturas en " + OUT);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
