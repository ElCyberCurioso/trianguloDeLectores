# Triángulo de Lectores — notas para trabajar en este repositorio

Aplicación de reseñas construida **para Cloudflare Workers desde el diseño**.
Antes de tocar nada, lee el README: explica la arquitectura y el porqué de cada
decisión. Estas son las reglas que no se negocian.

## Reglas del runtime

- **Sin APIs de Node en `src/server`, `src/db` y `src/do`.** Nada de `fs`,
  `child_process`, `net`, `tls`. `nodejs_compat` está desactivado a propósito y
  el workflow de seguridad falla si aparece un import prohibido.
- Sólo APIs Web estándar: `fetch`, `Request`, `Response`, `WebCrypto`,
  `Streams`, `FormData`, `URL`.
- Tres tsconfig separados por runtime: `tsconfig.json` (Worker, sin `lib.DOM`),
  `tsconfig.client.json` (navegador, con DOM), `tsconfig.node.json`
  (scripts y herramientas). `npm run typecheck` corre los tres.

## Reglas de seguridad

- **Nunca renderizar HTML de usuario sin pasar por `src/server/lib/sanitize.ts`.**
  El HTML de las reseñas se sanea *antes de guardarse*; los comentarios se
  guardan como texto plano y se escapan al renderizar.
- **Sin estilos ni scripts en línea sin nonce.** La CSP no lleva `unsafe-inline`
  ni `unsafe-eval` y así debe seguir. Los valores dinámicos van por clases y
  atributos `data-*`, nunca por `style=`.
- **El rol se lee siempre de la sesión en base de datos**, jamás de una cabecera
  ni de un campo del formulario.
- **Toda entrada pasa por Zod** (`src/validation/schemas.ts`) con esquemas
  cerrados. Nada de aceptar campos no declarados.
- **Nunca registrar** contraseñas, tokens, cookies ni secretos. El logger redacta
  por nombre de clave; no lo esquives.
- **Las IP no se guardan en claro**: usa `pseudonymize()`.

## Reglas de marca

- Los ficheros de `public/assets/brand/` **se generan**, no se editan: salen de
  `python3 scripts/build-brand.py triangulo_brand.zip`.
- Sin sufijo = tinta azul marino (fondos claros). Sufijo `-light` = marfil
  (fondos oscuros). No inviertas la imagen para adaptarla: el dorado se volvería
  azul.
- Los logotipos que dependen del tema van como **fondo CSS**, no como `<img>`:
  existen en dos versiones y así se descarga sólo la que aplica. El nombre
  accesible lo aporta texto real en el marcado.
- La paleta sale del propio logotipo: tinta `#0d1a26`, dorado `#c8963e`, marfil
  `#f4efe4`. En tema claro el dorado baja a `#96662a` por contraste.

## Reglas de datos

- El SQL de `migrations/` es la fuente de verdad; `src/db/schema.ts` es su
  espejo tipado. Si cambias uno, cambia el otro.
- Migraciones **aditivas** en el pipeline. Cualquier cambio destructivo se aplica
  a mano y con copia de seguridad.
- El acceso a D1 vive sólo en `src/db/repos/*`. Ninguna vista ni ruta escribe SQL.
- La puntuación se almacena como entero 0..10 (estrellas × 2). No la conviertas
  a decimal en la base de datos.
- Toda URL que vaya a acabar en un `href` se valida con `httpUrl()`, no con
  `z.string().url()`: este último acepta `javascript:` y sería XSS. Al pintarla,
  vuelve a pasarla por `safeUrl()`.

## Antes de dar algo por terminado

```bash
npm run preflight
```

Encadena secretos, lint, typecheck, tests unitarios y de integración, build,
`deploy --dry-run` en los tres entornos y E2E. Devuelve código distinto de cero
si algo falla. Para iterar rápido: `npm run preflight -- --quick`.

Para probar a mano: `npm run local` deja el entorno completo levantado
(D1 migrada y sembrada, R2, KV, Durable Objects y usuario administrador).
