# Cambios pendientes de commitear

Estado del árbol de trabajo respecto a `6a83857` (*feat: lista de pendientes e
identidad de marca*). **79 ficheros**: 58 modificados, 12 nuevos, 9 borrados.

`npm run preflight` pasa entero: lint, los cuatro typecheck, 251 tests
unitarios y de integración, 65 E2E en escritorio y móvil, compilación y
simulacro de despliegue en los tres entornos.

---

## 1. Rediseño visual completo

El sitio pasa del sistema anterior —azul marino y dorado, tipografías del
sistema, tarjetas con caja— al **Modernist / rejilla editorial** del brand kit,
con la marca **1C · Tres reglas**.

- `public/assets/styles.css` reescrito entero (~1.200 líneas).
- Tipografía **Archivo** autoalojada en `public/assets/fonts/`; fuera Fraunces
  e Inter, que se usaron en una versión intermedia.
- Marca en SVG en línea: `src/server/views/components/brand.tsx`.
- Iconografía Lucide propia: `src/server/views/components/icons.tsx`.
- `scripts/build-brand.py` ya no procesa `triangulo_brand.zip`: dibuja la marca
  1C y genera favicon, iconos de aplicación y tarjeta social.
- Se borran los PNG del logotipo antiguo (triángulo) de `public/assets/brand/`.

**Decisión que se apartó del kit**: el contenido se centra a 1480 px en vez de
los 1180 que especifica, y sin el lienzo gris. Fue una petición explícita.

## 2. La nota pasa de estrellas a escala sobre 10

Regla dura del brand kit. No toca la base de datos —ya se guardaba como entero
0..10, que es la escala publicada— pero sí la presentación:

- `formatScore()` en `src/types/domain.ts` sustituye a `formatStars()` en
  catálogo, ficha, panel y editor.
- El JSON-LD pasa de `bestRating: 5` a `bestRating: 10`.
- Dos tests que comprobaban el diseño anterior (media estrella, `alt` del
  logotipo) se actualizaron al nuevo sin debilitar lo que verifican.

## 3. Cabecera unificada y menú de usuario

- Una sola cabecera para todo el sitio: la navegación pública está siempre,
  también dentro del panel.
- Con sesión abierta, el botón de acceso se convierte en el nombre del usuario
  con un menú desplegable (`<details>` nativo, sin JavaScript obligatorio).
- Las secciones del panel bajan a una segunda barra.
- Pie de una sola línea, idéntico en todo el sitio.

## 4. Recomendaciones del público (funcionalidad nueva)

Cualquiera puede proponer una obra; la propuesta entra en una bandeja interna y
desde el panel se convierte en borrador de reseña, se manda a la lista de
pendientes o se descarta.

| Fichero | Qué es |
|---|---|
| `migrations/0002_recommendations.sql` | Tabla `recommendations`. **Migración aditiva sin aplicar en staging ni producción.** |
| `src/db/repos/recommendations.ts` | Repositorio |
| `src/server/services/recommendations.ts` | Lógica de conversión |
| `src/server/views/pages/recommend.tsx` | Formulario público (`/recomendar`) |
| `src/server/views/admin/recommendations.tsx` | Bandeja del panel |
| `tests/integration/recommendations.test.ts` | 16 tests |

Protegida igual que los comentarios: token de formulario firmado, comprobación
de origen, honeypot, Turnstile, 5 por hora y por IP, y un segundo tope en base
de datos. IP y agente de usuario pseudonimizados; ninguna consulta los expone.

## 5. Seguridad — cuatro correcciones

1. **Inyección SQL en `drizzle-orm`** (alta, GHSA-gpj5-g38j-94v9). Era la
   versión 0.38.4, dependencia de producción. Actualizada a 0.45.2.
2. **Identidad falsificable**: `clientIp()` aceptaba `X-Real-IP`, una cabecera
   del cliente, y con ella se elegía la propia identidad ante el limitador.
   Ahora sólo `CF-Connecting-IP`, que pone el borde.
3. **Antiduplicado frágil**: la detección de reportes repetidos comparaba el
   *texto* del error de base de datos. La actualización del ORM lo rompió en
   silencio (500 en vez de 409). Reescrito con `ON CONFLICT DO NOTHING`.
4. **Sin techo de tamaño** en los formularios públicos. Ahora 64 kB.

Endurecimiento adicional: cookie de sesión con prefijo `__Host-` fuera de
desarrollo; límite de peticiones en `/recomendar`.

Los otros 17 avisos de `npm audit` son de herramientas (vitest, wrangler,
esbuild, miniflare) y no se empaquetan en el Worker.

## 6. Móvil

- Fuera `dvh`, que cambia al plegarse la barra del navegador y hacía que la
  página pareciera cambiar de tamaño sola. Todo en `svh`.
- Cabecera de 102 px en cualquier móvil de 320 a 412 px (antes hasta 202).
- Campos a 16 px: por debajo, Safari en iOS amplía la página al enfocarlos.
- Objetivos táctiles de 44 px; ninguno por debajo de los 24 que pide WCAG 2.2.
- Zonas seguras (`env(safe-area-inset-*)`) en márgenes, pie y avisos.
- El widget de Turnstile vive en un hueco de altura fija: ya no mueve la
  tarjeta al cargar. Verificado con las claves de prueba de Cloudflare.

## 7. Otros arreglos de fondo

- **PBKDF2 a 100.000 iteraciones**: WebCrypto en Workers rechaza más, y con
  210.000 el login devolvía 500 en el runtime real. Un hash con más iteraciones
  de las que admite la plataforma ahora rechaza el acceso en vez de reventar.
- **`migrations/0001_watchlist.sql`**: un punto y coma dentro de un comentario
  partía la sentencia para el troceador de D1 remoto. Sólo cambia el comentario.
- **Los scripts de base de datos** usaban `tdl-db`, el nombre de la base de
  desarrollo, junto con `--env staging`. Ahora usan el binding `DB`.
- **Invalidación de caché por versión desplegada**: la clave incluye el id de
  la versión del Worker (`version_metadata`), así que publicar código nuevo deja
  atrás el HTML anterior. Antes convivían hasta una hora.
- **`Vary: Cookie`** en las respuestas cacheadas: sin él, quien visitaba una
  página sin sesión y entraba después seguía viendo su copia sin menú.
- **Cuarto tsconfig** (`tsconfig.e2e.json`): el cuerpo de `page.evaluate()`
  corre en el navegador y necesita `lib.DOM`, que en Node sigue prohibida.

## 8. Configuración de despliegue

`wrangler.jsonc` ya no tiene marcadores: dominio `triangulodelectores.site`,
identificadores reales de D1 y KV en los dos entornos, y claves públicas de
Turnstile.

---

## Antes de desplegar

```bash
npm run db:migrate:staging   # aplica 0002_recommendations.sql
npm run deploy:staging
```

Pendiente y **no automatizable**:

- [ ] Zona `triangulodelectores.site` activa en Cloudflare (NS delegados).
- [ ] SSL/TLS en Full (Strict) y Always Use HTTPS.
- [ ] Transformaciones de imagen activadas en la zona: `IMAGE_RESIZING` está en
      `true` y sin ellas `/cdn-cgi/image/` devuelve 404.
- [ ] Reglas del WAF y Rate Limiting (README §12).
- [ ] Bucket R2 de producción **no** público.
- [ ] Redirección de `www` al dominio raíz.
- [ ] Copia de seguridad de D1 antes de migrar producción.

## Dos cosas que decidir

- **`triangulo_brand.zip` aparece como borrado** y no fui yo quien lo quitó del
  árbol. Si lo moviste a propósito, el borrado entra en el commit; si no,
  recupéralo con `git checkout -- triangulo_brand.zip`.
- **`tdl_estilos.zip` y `tdl_brandkit.zip` están sin seguimiento.** Son el
  material de diseño del que sale todo el rediseño; versionarlos deja la
  procedencia clara, igual que se hizo con el pack de marca anterior.

## Commit sugerido

Todo esto es un cuerpo de trabajo grande pero coherente. Si prefieres partirlo:

1. Correcciones de seguridad y del runtime (PBKDF2, drizzle, `clientIp`,
   antiduplicado, migración, scripts de base de datos).
2. Rediseño visual y marca 1C.
3. Recomendaciones del público.
4. Adaptación a móvil.
5. Configuración de dominio y despliegue.
