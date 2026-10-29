"use strict";
// Servidor E2E: la app real + /api/space y /api/admin contra el mock de Blob.
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "test-secret-e2e";
const { startServer } = require("../support/harness.js");

const port = Number(process.env.PORT) || 4321;
startServer({ port })
  .then(({ base }) => console.log("E2E server " + base))
  .catch((err) => {
    console.error("E2E server error:", err);
    process.exit(1);
  });
