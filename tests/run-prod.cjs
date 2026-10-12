"use strict";
// npm run test:prod — corre la suite contra producción (gasta cuota, usar poco).
const { spawnSync } = require("child_process");
const r = spawnSync(process.execPath, ["--test", "tests/api.test.mjs"], {
  env: { ...process.env, TEST_TARGET: "prod" },
  stdio: "inherit",
});
process.exit(r.status ?? 1);
