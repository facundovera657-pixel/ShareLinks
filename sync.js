"use strict";
/* ShareLinks sync — fusión de espacios entre dispositivos, sin dependencias ni DOM.
   Se carga en el navegador con <script src="/sync.js"> y en los tests vía vm. */

function normStore(s) {
  if (Array.isArray(s)) {
    return { links: s.filter((x) => x && typeof x === "object"), tombstones: {} };
  }
  if (!s || typeof s !== "object") return { links: [], tombstones: {} };
  return {
    links: Array.isArray(s.links) ? s.links.filter((x) => x && typeof x === "object") : [],
    tombstones:
      s.tombstones && typeof s.tombstones === "object" && !Array.isArray(s.tombstones)
        ? s.tombstones
        : {},
  };
}

// Une dos estados: gana el link más reciente; un borrado (tombstone) posterior al link lo elimina.
function mergeStores(a, b) {
  a = normStore(a);
  b = normStore(b);
  const tombstones = {};
  for (const src of [a.tombstones, b.tombstones]) {
    for (const k of Object.keys(src)) {
      const ts = Number(src[k]);
      if (!Number.isFinite(ts)) continue;
      tombstones[k] = Math.max(tombstones[k] || 0, ts);
    }
  }
  const byId = new Map();
  for (const l of a.links.concat(b.links)) {
    if (!l || typeof l.id !== "string") continue;
    const prev = byId.get(l.id);
    const ts = Number(l.ts) || 0;
    if (!prev || ts > (Number(prev.ts) || 0)) byId.set(l.id, l);
  }
  const links = [];
  for (const entry of byId.values()) {
    if ((Number(tombstones[entry.id]) || 0) >= (Number(entry.ts) || 0)) continue;
    links.push(entry);
  }
  return { links, tombstones };
}

// Igualdad lógica (ignora orden) para decidir si hay que re-subir tras un pull.
function sameStore(a, b) {
  const norm = (s) => {
    s = normStore(s);
    const links = [...s.links].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    const tombstones = {};
    for (const k of Object.keys(s.tombstones).sort()) tombstones[k] = s.tombstones[k];
    return JSON.stringify({ links, tombstones });
  };
  return norm(a) === norm(b);
}
