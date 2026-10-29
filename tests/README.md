# Tests ShareLinks

Todo corre **local y sin cuota de Vercel Blob**.

## Suites

| Comando | Qué prueba | Tiempo |
|---|---|---|
| `npm test` | API, sync, inputs, admin (mock en memoria) | ~3 s |
| `npm run test:e2e` | UI real en Chromium **desktop + móvil** (Playwright) | ~20 s |
| `npm run test:e2e:headed` | Igual, con navegador visible | ~20 s |
| `npm run test:e2e:shots` | Capturas de app y admin en `test-results/shots/` | ~8 s |
| `npm run test:all` | Unitarios + E2E | ~25 s |
| `npm run test:prod` | Contra producción (**gasta cuota**, usar poco) | ~35 s |

## Qué cubre el E2E

- Arranque sin espacio: solo el paso 1, footer fijo, sin scroll horizontal.
- Crear espacio: nombres inválidos (cortos, números, espacios) y válido; ID, QR, persistencia al recargar.
- Guardar link: basura rechazada, URL sin `https://` normalizada, persistencia.
- Borrar uno y en lote: contadores, estado vacío y *tombstones*.
- Exportar/Importar por texto.
- Otro aparato entra con `#id=…` y ve los mismos links (flujo PC → celu).
- Cero pedidos externos: el QR se genera localmente.
- PWA: manifest y service worker.
- Layout: el footer no tapa contenido y los botones son táctiles.
- Admin: login con secreto, crear, listar y borrar en lote.

## Cómo funciona el E2E sin nube

`tests/e2e/server.cjs` levanta la app real y enruta `/api/space` y `/api/admin`
a los handlers de producción, pero con `@vercel/blob` reemplazado por
`tests/support/mock-blob.js` (memoria). Playwright maneja un Chromium real
contra ese servidor. Nada sale a internet.

Primera vez: si Chromium no está instalado, correr `npx playwright install chromium`.

## Reglas

- `npm test` y `npm run test:e2e` son los de todos los días.
- `test:prod` solo antes de entregar y nunca en bucle: Vercel suspende el
  storage por exceso de operaciones (pasó el 12/10/2026).
