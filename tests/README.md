# Tests ShareLinks

- `npm test` → **modo mock** (defecto): API contra mock en memoria + estáticos
  locales. Rápido (~3s), offline, **cero cuota de Vercel Blob**. Úsalo siempre.
- `npm run test:prod` → contra producción. **Gasta cuota** (cada corrida crea
  ~40 espacios reales). Solo para validar cambios de backend antes de entregar.
  Requiere `ADMIN_SECRET` en el entorno para la suite de admin.

No correr la suite de producción en bucle: Vercel suspende el storage por
exceso de operaciones (nos pasó el 12/10/2026).
