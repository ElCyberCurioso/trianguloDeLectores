/**
 * Dos entornos de test distintos, deliberadamente separados:
 *
 *   - `unit`        → Node puro. Lógica sin bindings (sanitizado, validación,
 *                     puntuaciones, umbrales, permisos). Milisegundos.
 *   - `integration` → dentro de **workerd** con D1, R2, KV y Durable Objects
 *                     reales de Miniflare. Sin mocks: lo que pasa aquí, pasa
 *                     en Cloudflare.
 */
export default ['./vitest.unit.config.ts', './vitest.integration.config.ts'];
