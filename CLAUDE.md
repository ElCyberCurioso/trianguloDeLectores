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
- Cuatro tsconfig separados por runtime: `tsconfig.json` (Worker, sin
  `lib.DOM`), `tsconfig.client.json` (navegador, con DOM), `tsconfig.node.json`
  (scripts y herramientas, sin DOM) y `tsconfig.e2e.json` (tests de Playwright,
  con DOM porque el cuerpo de `page.evaluate()` corre en el navegador).
  `npm run typecheck` corre los cuatro.
- **PBKDF2 tiene techo: 100.000 iteraciones.** WebCrypto en Workers rechaza más
  con `NotSupportedError`, aunque OWASP recomiende 600.000 y Node lo permita.
  No lo subas: el login devolvería 500 en el runtime real y no en local.

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
- **La IP sale sólo de `CF-Connecting-IP`** (`clientIp()`). Ninguna otra
  cabecera vale: las pone el cliente y alimentan el limitador, así que aceptar
  `X-Real-IP` permitía elegirse la propia identidad.
- **No detectes errores de base de datos leyendo su texto.** El antiduplicado de
  reportes lo hacía y se rompió en silencio al actualizar el ORM. Usa
  `ON CONFLICT DO NOTHING` y comprueba el resultado.
- Los formularios públicos llevan techo de tamaño (`assertBodySize`, 64 kB),
  token de formulario firmado, comprobación de origen, honeypot y Turnstile.
- La cookie de sesión lleva prefijo `__Host-` fuera de desarrollo.
- Sólo hay tres dependencias de runtime: `hono`, `zod` y `drizzle-orm`. Antes de
  añadir una cuarta, piénsalo dos veces; `npm audit` sobre ellas debe estar
  limpio (el resto de avisos son de herramientas y no se empaquetan).

## Reglas de marca y estilo

El sistema visual es **Modernist / rejilla editorial** y la marca es
**1C · Tres reglas**, ambos definidos en el brand kit (`tdl_brandkit.zip`).
`public/assets/styles.css` implementa sus tokens; consúmelos siempre como
variables CSS, nunca como hex sueltos.

Reglas que no se rompen:

1. **Ninguna esquina redondeada.** Los radios valen 0 en todo el sitio.
2. **Nada centrado**, ni las etiquetas de botón: una etiqueta más estrecha que
   su botón empieza en el padding izquierdo.
3. **Un solo rojo, y siempre significa algo.** `#ec3013` no decora. Como texto
   pequeño o relleno de botón se usa `--color-accent-700`, que es el único que
   llega a contraste AA.
4. **Las reglas de 1 px y 2 px no se sustituyen por aire**: 2 px entre secciones
   y bajo la cabecera, 1 px dentro de una sección.
5. **Las notas van sobre 10 y con coma** (`formatScore`). Internamente siguen
   siendo un entero 0..10.
6. **Las imágenes, en blanco y negro** (`filter: grayscale(1) contrast(1.08)`).
   Portadas 2:3, fotogramas 16:10. Si falta material, marcador gris.
7. **Las tres reglas de la marca: 100 / 66 / 33, en ese orden.** Nunca con
   puntas redondeadas, ni centrada, ni toda en rojo, ni invertida.

- La marca vive en **SVG en línea** (`src/server/views/components/brand.tsx`),
  no en ficheros de imagen: hereda `currentColor` y así sirve sobre fondo, sobre
  tinta y sobre acento sin duplicar versiones por tema.
- Los únicos mapas de bits son el favicon, los iconos de aplicación y la tarjeta
  social. Se generan con `python3 scripts/build-brand.py` y llevan el isotipo en
  caja de tinta, nunca sobre fondo claro.
- **Iconos**: Lucide, trazo 2,2 y remate recto, en `components/icons.tsx`. Un
  icono por medio y nunca dos medios con el mismo (`MEDIA_ICON`). El único
  propio es el de filtro, reservado a controles de orden y filtrado.
- **Tipografía**: Archivo para todo, autoalojada en `public/assets/fonts/`.
  800 en titulares y cifras, 600 en metadatos, 400 en cuerpo. Nada de enlazar a
  Google Fonts: filtraría la IP de cada visitante a un tercero.
- **Tema oscuro por omisión.** `:root` ya son los valores oscuros; el claro vive
  en `:root[data-theme="light"]`. No se consulta `prefers-color-scheme`: la
  decisión es del sitio y quien quiera el claro lo elige con el conmutador.
- Dos desvíos deliberados del kit, ambos pedidos: el contenido se centra a
  1480 px (el kit dice 1180 sobre lienzo gris), y el tema oscuro no existe en el
  kit —se deriva intercambiando hueso y tinta y subiendo el rojo un paso—.

## Reglas de móvil

- **Nunca `dvh`.** La altura dinámica cambia cuando el navegador móvil pliega su
  barra, y todo lo dimensionado con ella se redibuja: la página parece cambiar
  de tamaño sola. Usa `svh`.
- **Los campos de texto, a 16 px como mínimo.** Por debajo, Safari en iOS amplía
  la página al enfocarlos. Ojo con la especificidad: `.select` es un selector de
  clase y gana al de elemento aunque la media query vaya después.
- **44 px de alto en lo que se pulsa** (`@media (pointer: coarse)`); nunca por
  debajo de los 24 px que exige WCAG 2.2 SC 2.5.8.
- Márgenes, pie y avisos respetan `env(safe-area-inset-*)`.
- **Lo que llega por JavaScript necesita su hueco reservado de antemano.** El
  widget de Turnstile vive en `.turnstile-slot`, de altura fija y con el widget
  en posición absoluta: así no mueve nada al cargar. Mismo criterio para
  cualquier cosa que se inserte después del primer pintado.

## Reglas de datos

- El SQL de `migrations/` es la fuente de verdad; `src/db/schema.ts` es su
  espejo tipado. Si cambias uno, cambia el otro.
- Migraciones **aditivas** en el pipeline. Cualquier cambio destructivo se aplica
  a mano y con copia de seguridad.
- El acceso a D1 vive sólo en `src/db/repos/*`. Ninguna vista ni ruta escribe SQL.
- La puntuación se almacena como entero 0..10, que es también la escala
  publicada. Se muestra con `formatScore()`. No la conviertas a decimal en la
  base de datos.
- **Un punto y coma dentro de un comentario SQL parte la sentencia** para el
  troceador de D1 remoto, aunque en local funcione. No los pongas.
- Los comandos de base de datos usan el **binding** (`DB`), no el nombre de la
  base: `tdl-db` sólo existe en desarrollo y falla con `--env staging`.
- Toda URL que vaya a acabar en un `href` se valida con `httpUrl()`, no con
  `z.string().url()`: este último acepta `javascript:` y sería XSS. Al pintarla,
  vuelve a pasarla por `safeUrl()`.

## Reglas de caché

- La clave de caché lleva dos sellos: el de contenido (KV, `cachever:*`) y el de
  **versión desplegada** (`version_metadata`). Publicar código nuevo deja atrás
  el HTML anterior sin purgar nada a mano.
- Nada con sesión entra en la caché compartida (`isCacheable`), y las respuestas
  cacheadas llevan `Vary: Cookie` para que el navegador tampoco reutilice una
  copia anónima después de iniciar sesión.

## Antes de dar algo por terminado

```bash
npm run preflight
```

Encadena secretos, lint, typecheck, tests unitarios y de integración, build,
`deploy --dry-run` en los tres entornos y E2E. Devuelve código distinto de cero
si algo falla. Para iterar rápido: `npm run preflight -- --quick`.

Para probar a mano: `npm run local` deja el entorno completo levantado
(D1 migrada y sembrada, R2, KV, Durable Objects y usuario administrador).

## Estado del proyecto

- Desplegado en **staging**: `https://staging.triangulodelectores.site`.
  Producción configurada pero **sin desplegar**.
- `wrangler.jsonc` no tiene marcadores pendientes: dominio, D1, KV y claves
  públicas de Turnstile son reales en los dos entornos.
- Hay trabajo **sin commitear**: ver `CAMBIOS-PENDIENTES.md`, que resume qué
  cambió, qué queda por hacer a mano en el panel de Cloudflare y qué decisiones
  quedan abiertas.
- El informe de auditoría con las mejoras aún no implementadas (páginas de
  categoría y género, canonical de las URLs filtradas, paginación de
  comentarios, buscador sobre FTS5, reseñas relacionadas) vive en un artefacto
  publicado, no en el repositorio. Las de prioridad alta siguen pendientes.
