# Triángulo de Lectores

Catálogo y plataforma de reseñas de **libros, novelas, películas, series, anime, cómics, manga y videojuegos**, construido **para Cloudflare desde la primera línea**: no es una aplicación Node adaptada después.

- Público: catálogo filtrable, ficha en modal accesible, puntuación de 0 a 5 con medias estrellas, spoilers ocultables, comentarios anidados y reportes. Y una **lista de pendientes** con lo que está en cola por ver, leer o jugar.
- Privado: panel en `/admin` con editor enriquecido, gestión de portadas en R2, cola de pendientes convertible en reseña de un clic, moderación con umbral automático de reportes y auditoría.

---

## Índice

1. [Arquitectura](#1-arquitectura)
2. [Decisiones técnicas](#2-decisiones-técnicas-y-por-qué)
3. [Requisitos](#3-requisitos)
4. [Instalación y desarrollo local](#4-instalación-y-desarrollo-local)
5. [Docker](#5-docker)
6. [Recursos de Cloudflare](#6-crear-los-recursos-de-cloudflare)
7. [Secretos y variables](#7-secretos-y-variables)
8. [Base de datos D1](#8-base-de-datos-d1)
9. [Almacenamiento R2 e imágenes](#9-almacenamiento-r2-e-imágenes)
10. [KV y Durable Objects](#10-kv-y-durable-objects)
11. [Caché e invalidación](#11-caché-e-invalidación)
12. [Turnstile, WAF y rate limiting](#12-turnstile-waf-y-rate-limiting)
13. [DNS y SSL/TLS](#13-dns-y-ssltls)
14. [Seguridad](#14-seguridad)
15. [SEO](#15-seo)
15b. [Lista de pendientes](#15b-lista-de-pendientes)
15c. [Recursos de marca](#15c-recursos-de-marca)
15d. [Biblioteca privada (books.)](#15d-biblioteca-privada-books)
16. [Privacidad y RGPD](#16-privacidad-y-rgpd)
17. [Observabilidad y analítica](#17-observabilidad-y-analítica)
18. [Testing](#18-testing)
19. [CI/CD](#19-cicd)
20. [Despliegue y rollback](#20-despliegue-y-rollback)
21. [Estructura del proyecto](#21-estructura-del-proyecto)
22. [Comandos](#22-comandos)
23. [Limitaciones conocidas](#23-limitaciones-conocidas)

---

## 1. Arquitectura

```text
                         Persona usuaria
                                │
                                ▼
                       Cloudflare DNS  (registro proxied)
                                │
                                ▼
                   Cloudflare CDN + WAF + Bot Fight
                                │
                    ┌───────────┴───────────┐
                    │                       │
                    ▼                       ▼
             Cache API del borde     Cloudflare Turnstile
                    │                (validado server-side)
                    ▼
        ┌───────────────────────────────────────────┐
        │           Cloudflare Worker               │
        │  Hono + SSR (hono/jsx)                    │
        │  ├── Frontend público (HTML renderizado)  │
        │  ├── Panel /admin                         │
        │  ├── API pública (comentarios, reportes)  │
        │  ├── Autenticación por sesión             │
        │  └── Middleware: CSP, CSRF, rate limit    │
        └───────────────────────────────────────────┘
             │          │           │            │
             ▼          ▼           ▼            ▼
           D1        R2 (MEDIA)    KV        Durable Objects
        (relacional) (portadas)  (caché +   (rate limit +
                                 config)     moderación)
             │
             └──> Workers Static Assets (CSS, JS, iconos)
```

Un único Worker sirve HTML, API y panel. **No hay servidor Node, ni PostgreSQL, ni Redis, ni S3.** Todo el estado vive en servicios de Cloudflare.

---

## 2. Decisiones técnicas (y por qué)

### Hono + SSR en lugar de Next.js

Next.js *puede* correr en Workers vía `@opennextjs/cloudflare`, pero exige `nodejs_compat`, un caché incremental sobre KV y un runtime bastante más pesado. Para un catálogo de reseñas eso es coste sin beneficio. Se eligió **Hono con renderizado en servidor**:

| Prioridad del proyecto | Qué aporta esta elección |
|---|---|
| Compatibilidad con Cloudflare | API 100 % Web estándar, sin `nodejs_compat`, arranque en frío mínimo |
| Seguridad | **CSP estricta real**: `nonce` + `strict-dynamic`, sin `unsafe-inline` ni `unsafe-eval`. Next inyecta scripts y estilos en línea que obligan a relajarla |
| Rendimiento | HTML desde el borde; el cliente recibe ~8 kB de JS (islas), no un bundle de framework |
| Mantenibilidad | Un solo proceso mental: rutas → servicios → repositorios |

El frontend **funciona sin JavaScript**: filtros con `<form method="get">`, comentarios y reportes con formularios nativos, ficha completa en `/resena/:slug`. El JS sólo añade el modal, los toasts y el envío sin recarga.

### D1 + Drizzle

D1 es SQLite gestionado y transaccional, suficiente de sobra para este dominio. **Drizzle ORM** funciona sobre el driver nativo de D1 sin APIs de Node (Prisma clásico no). Todo el acceso pasa por `src/db/repos/*`, así que ninguna capa superior conoce SQL ni D1.

Las migraciones son **SQL escrito a mano** en `migrations/`, no generado: así se conservan los `CHECK` constraints, las claves foráneas y los índices compuestos que un generador tiende a perder. `drizzle-kit` queda para inspección.

### PBKDF2 en lugar de Argon2/bcrypt

Workers no ofrece Argon2id ni bcrypt nativos y las implementaciones WASM engordan el bundle y consumen presupuesto de CPU. **PBKDF2-HMAC-SHA256 con 210 000 iteraciones** es una primitiva aprobada por OWASP, disponible en WebCrypto y ejecutada en código nativo. El número de iteraciones se guarda dentro del hash, así que se puede subir y re-hashear de forma transparente en el siguiente login.

### Durable Objects para lo que KV no puede hacer

KV es eventualmente consistente y limita las escrituras por clave; usarlo de contador de rate limiting daría falsos negativos. Los DO dan **ejecución serializada y estado fuerte por clave**, que es justo lo que necesitan el limitador y la decisión de umbral de reportes. Sin Redis externo.

### Sanitizador propio

Workers no expone DOM, así que DOMPurify no es viable. `src/server/lib/sanitize.ts` tokeniza el HTML y **reconstruye** la salida con allowlist: nada del input llega al output sin pasar por el escapador. Está cubierto por 25 tests con vectores XSS reales.

### Servicios externos: ninguno

No hace falta nada fuera de Cloudflare. Si en el futuro el catálogo creciera hasta necesitar búsqueda full-text avanzada o agregaciones analíticas pesadas, la conversación sería sobre **D1 con FTS5** primero y **Workers Analytics Engine** después, antes que sobre un servicio externo.

---

## 3. Requisitos

- **Node.js 20 o superior** (`node -v`)
- **npm 10 o superior**
- Cuenta de Cloudflare con **Workers Paid** recomendado (Durable Objects requiere plan de pago; el resto funciona en gratuito con límites de CPU más ajustados)
- `wrangler` se instala como dependencia del proyecto: no hace falta global
- Opcional: Docker y Docker Compose para el entorno reproducible

---

## 4. Instalación y desarrollo local

```bash
git clone <url-del-repositorio>
cd triangulo-de-lectores

npm install
npm run local
```

`npm run local` deja el entorno completo listo y arranca el servidor. Hace, en orden:

1. crea `.dev.vars` con un `HASH_PEPPER` aleatorio si no existe (fichero ignorado por git);
2. compila los bundles de cliente;
3. aplica las migraciones de D1 local;
4. carga los datos de ejemplo (categorías, géneros, plataformas, ajustes y tres reseñas);
5. crea el usuario administrador si todavía no hay ninguno — la contraseña se pide por teclado y no queda en disco;
6. levanta `wrangler dev` con D1, R2, KV y Durable Objects simulados por Miniflare.

Opciones útiles:

```bash
npm run local:reset          # borra .wrangler/state y empieza de cero
npm run local -- --port 3000 # otro puerto
npm run local -- --no-seed   # sin datos de ejemplo
npm run local -- --no-build  # sin recompilar el cliente
```

Nada de esto toca Cloudflare: todo el estado vive en `.wrangler/state`, en tu máquina.

Si prefieres los pasos sueltos:

```bash
cp .dev.vars.example .dev.vars   # y pon un HASH_PEPPER real
npm run db:migrate:local
npm run db:seed:local
npm run admin:create
npm run dev
```

- Público: <http://localhost:8787>
- Panel: <http://localhost:8787/admin>

En local `TURNSTILE_ENABLED` está en `false`, así que los formularios no piden verificación anti-bot.

Para empezar de cero: `npm run local:reset` (o `npm run db:reset:local` si sólo
quieres reconstruir la base sin arrancar el servidor).

---

### Probar el subdominio privado en local

`wrangler dev` responde a cualquier `Host`, pero el navegador necesita resolver
el nombre. Basta con una línea en `/etc/hosts`:

```text
127.0.0.1   books.localhost
```

y entrar en `http://books.localhost:8787`. El host lo declara `BOOKS_URL` en
`wrangler.jsonc`, porque en local el prefijo `books.` sobre `localhost:8787` no
se puede deducir.

---

## 5. Docker

Docker es **sólo para desarrollo**: producción es Cloudflare, no un contenedor.

```bash
cp .env.example .env
docker compose up --build

# En otra terminal, preparar la base de datos dentro del contenedor
docker compose exec app npm run db:migrate:local
docker compose exec app npm run db:seed:local
docker compose exec app npm run admin:create
```

No hay servicios auxiliares: D1, R2, KV y los Durable Objects los emula Miniflare **dentro del mismo contenedor**, con las mismas APIs que en producción. Añadir PostgreSQL o Redis aquí sólo crearía diferencias con el entorno real.

---

## 6. Crear los recursos de Cloudflare

```bash
npx wrangler login
```

### D1

```bash
npx wrangler d1 create tdl-db            # desarrollo
npx wrangler d1 create tdl-db-staging
npx wrangler d1 create tdl-db-prod
```

Copia cada `database_id` a su bloque en `wrangler.jsonc`, sustituyendo los marcadores `REPLACE_WITH_*`.

### R2

```bash
npx wrangler r2 bucket create tdl-media-dev
npx wrangler r2 bucket create tdl-media-staging
npx wrangler r2 bucket create tdl-media-prod
```

**No hagas público el bucket.** Las imágenes se sirven a través del Worker (`/media/*`) o de un dominio de R2 controlado; el acceso directo al bucket no debe existir.

### KV

```bash
npx wrangler kv namespace create CACHE
npx wrangler kv namespace create CONFIG
# repetir con --env staging y --env production
```

### Durable Objects

No requieren creación previa: se declaran en `wrangler.jsonc` (`RateLimiter`, `ModerationCoordinator`) y la migración `v1` los registra con backend SQLite en el primer `deploy`.

### Comprobar la configuración

```bash
npx wrangler types --env-interface CloudflareBindings src/types/worker-configuration.d.ts
npm run build      # dry-run: valida bindings y empaqueta el Worker
```

---

## 7. Secretos y variables

**Variables públicas** (en `wrangler.jsonc`, por entorno): `ENVIRONMENT`, `SITE_NAME`, `SITE_URL`, `SITE_LOCALE`, `TURNSTILE_SITE_KEY`, `TURNSTILE_ENABLED`, `IMAGE_RESIZING`, `LOG_LEVEL`, `MEDIA_PUBLIC_BASE` (opcional),
`BOOKS_URL` (origen del subdominio privado; si falta se deduce como `books.` + el host de `SITE_URL`).

**Secretos** (nunca en el repositorio):

| Secreto | Para qué |
|---|---|
| `HASH_PEPPER` | HMAC que pseudonimiza IP/User-Agent y firma los tokens de formularios públicos |
| `TURNSTILE_SECRET_KEY` | Validación server-side de Turnstile |

```bash
npx wrangler secret put HASH_PEPPER --env production
npx wrangler secret put TURNSTILE_SECRET_KEY --env production
# ídem para --env staging

npx wrangler secret list --env production
```

En local van en `.dev.vars` (ignorado por git). `npm run secrets:check` escanea el repositorio en busca de credenciales filtradas y forma parte del pipeline.

> Cambiar `HASH_PEPPER` invalida la deduplicación de reportes existentes y los tokens de formulario en vuelo. Es un cambio consciente, no rutinario.

---

## 8. Base de datos D1

Esquema en `migrations/0000_init.sql`; espejo tipado en `src/db/schema.ts`.

**Tablas**: `users`, `sessions`, `categories`, `genres`, `platforms`, `reviews`, `review_genres`, `review_platforms`, `comments`, `comment_reports`, `settings`, `audit_log`, `media_objects`.

Todas con clave primaria, claves foráneas con `ON DELETE` explícito, `UNIQUE` donde toca (slugs, email normalizado, un reporte por persona y comentario), índices compuestos para cada orden del catálogo y `created_at` / `updated_at` en epoch ms UTC.

Dos detalles que merecen mención:

- **Puntuación**: se guarda como entero `0..10`, que es también la escala publicada. Permite ordenar por índice y validar con un `CHECK`, sin decimales flotantes. Se muestra con `formatScore` (sobre 10 y con coma).
- **Comentarios**: árbol por *materialized path* (`path` = `<segmento padre>/<segmento propio>/`, con el segmento derivado del timestamp en base 36). Ordenar por `path` da recorrido en profundidad y cronológico; el subárbol es `path LIKE '<path>%'`, que **usa el índice**. Sin CTE recursivo en cada lectura pública.

### Comandos

```bash
npm run db:migrate:local        # local
npm run db:migrate:staging      # staging (remoto)
npm run db:migrate:prod         # producción (remoto)

npm run db:seed:local
npm run db:reset:local          # SOLO local: borra y reconstruye

npx wrangler d1 execute tdl-db --local --command "SELECT COUNT(*) FROM reviews"
```

### Migraciones nuevas

Crea `migrations/000N_descripcion.sql`. **Sólo cambios aditivos en el pipeline automático**: `CREATE TABLE`, `ADD COLUMN`, `CREATE INDEX`. Cualquier `DROP` o `ALTER` con pérdida de datos se aplica a mano, con copia de seguridad previa y ventana de mantenimiento:

```bash
npx wrangler d1 export tdl-db-prod --env production --remote --output backup-$(date +%F).sql
```

---

## 9. Almacenamiento R2 e imágenes

Estructura de claves:

```text
reviews/
  covers/
    2026/
      a3/
        a3f1c9e2-....webp
```

El cliente **no influye en la ruta**: ni nombre, ni extensión, ni carpeta. La clave la genera el servidor (`buildCoverKey`) con UUID y shard, lo que cierra path traversal y sobrescritura.

Controles en cada subida:

- tamaño máximo **5 MB** y mínimo razonable;
- **sniffing por magic bytes** — el `Content-Type` declarado se ignora, así que un `.php` renombrado a `.png` se rechaza, igual que un SVG;
- formatos aceptados: **JPEG, PNG, WebP, AVIF**;
- dimensiones entre 100 y 8000 px (evita bombas de descompresión);
- registro en `media_objects` para auditar y localizar huérfanos;
- borrado que se niega si alguna reseña sigue usando la imagen.

### R2 frente a Cloudflare Images

Reparto deliberado:

| Dónde | Qué |
|---|---|
| **R2** | El **original** subido por el administrador. Almacenamiento barato, sin coste de egreso, bucket privado |
| **Cloudflare Images (transformaciones)** | Las **variantes** (`thumb` 160, `card` 400, `hero` 900, `og` 1200×630) generadas al vuelo vía `/cdn-cgi/image/...`, con `format=auto` para negociar AVIF/WebP |

No se duplican derivados en R2: las transformaciones se facturan por imagen transformada y quedan cacheadas en el borde, así que almacenarlas otra vez sería pagar dos veces por lo mismo. Al cliente **nunca** se le envía el original: las tarjetas usan `srcset` con las tres anchuras.

Si `IMAGE_RESIZING` está en `false` (desarrollo local, o una zona sin el producto activo) se sirve el original con caché inmutable. Degradación limpia, sin workaround.

Para servir por dominio propio de R2, crea el dominio personalizado en el bucket y define `MEDIA_PUBLIC_BASE`. El origen se añade automáticamente a `img-src` en la CSP.

---

## 10. KV y Durable Objects

**KV** (`CACHE`, `CONFIG`) se usa sólo donde su consistencia eventual es aceptable:

- caché de lectura de los ajustes (la fuente de verdad es la tabla `settings` en D1);
- sellos de versión de la caché del borde;
- contador del badge de pendientes (TTL de 30 s).

Nunca sustituye a la base de datos relacional.

**Durable Objects**:

| Clase | Instancia por | Función |
|---|---|---|
| `RateLimiter` | `<scope>:<ip pseudonimizada>` | Ventana deslizante con penalización; `reset()` tras login correcto |
| `ModerationCoordinator` | `comment:<id>` | Serializa la decisión de umbral: dos reportes simultáneos no pueden disparar la transición (ni su entrada de auditoría) dos veces |

Ambos usan el backend SQLite y programan `alarm()` para liberar almacenamiento inactivo.

---

## 11. Caché e invalidación

**Se cachea** (Cache API del borde + `Cache-Control`):

| Recurso | Borde | Navegador |
|---|---|---|
| Catálogo `/` | 300 s | 60 s |
| Ficha `/resena/:slug` | 600 s | 120 s |
| Páginas estáticas | 3600 s | 600 s |
| `sitemap.xml`, `rss.xml` | 1800 s | 300–600 s |
| Portadas y assets con hash | 1 año, `immutable` | 1 año |

**Nunca se cachea**: `/admin/*`, cualquier petición con cookie de sesión, respuestas con `Authorization`, ni nada que dependa de quién pregunta. La comprobación vive en `isCacheable()` y está cubierta por tests.

**Nonce de la CSP y caché.** La CSP lleva `nonce`, y una respuesta cacheada no puede regenerarlo: si la cabecera se recalculase en cada petición dejaría de casar con el `nonce` del HTML guardado y el navegador bloquearía nuestros propios scripts. Por eso la CSP se adjunta **dentro** de la respuesta antes de guardarla, de modo que cabecera y cuerpo viajan juntos. Consecuencia asumida: una página pública comparte `nonce` durante su TTL. Las páginas privadas (panel y cualquier petición autenticada) no se cachean nunca y conservan un `nonce` por petición.

**Invalidación por versionado de clave**: la cache key incluye un sello guardado en KV. Publicar, editar, borrar una reseña o moderar un comentario incrementa el sello y deja inalcanzables todas las entradas anteriores al instante. Es la alternativa correcta a purgar por tag, que requiere plan Enterprise.

La clave normaliza y ordena los parámetros de consulta, lo que evita duplicados equivalentes y cierra el envenenamiento de caché por parámetros desconocidos.

---

## 12. Turnstile, WAF y rate limiting

### Turnstile

Se puede activar de forma independiente en login, comentarios y reportes desde `/admin/ajustes`. **La validación es siempre server-side** contra `siteverify`; el token del cliente no significa nada por sí solo. Si falta el secreto, **falla cerrado**, nunca abierto.

Claves de prueba de Cloudflare para desarrollo: sitio `1x00000000000000000000AA`, secreto `1x0000000000000000000000000000000AA`.

### WAF (configuración en el dashboard)

La aplicación está diseñada para convivir con el WAF, **sin depender de él**. Recomendado en Security → WAF:

1. **Managed Rules**: Cloudflare Managed Ruleset y OWASP Core Ruleset en modo bloqueo, sensibilidad media.
2. **Rate Limiting Rules** (complementan a los Durable Objects, actuando antes de llegar al Worker):
   - `/admin/login` → 10 peticiones / 10 min por IP → bloquear 15 min
   - `/api/*` → 60 peticiones / min por IP → gestionar
   - `/admin/api/media/*` → 20 peticiones / 10 min por IP
3. **Bot Fight Mode** o Super Bot Fight Mode activo.
4. **Custom rule**: bloquear `http.request.uri.path contains "/admin"` salvo desde las IP de confianza, si el panel es de uso individual.
5. **Managed Transforms**: eliminar cabeceras que revelen la pila.

### Rate limiting en la aplicación

| Endpoint | Límite | Penalización |
|---|---|---|
| Login (por IP) | 5 / 15 min | 15 min |
| Login (global) | 50 / hora | 10 min |
| Comentarios | 5 / 10 min | 10 min |
| Reportes | 10 / hora | 1 hora |
| Subidas | 30 / hora | — |
| Escrituras del panel | 120 / min | — |
| API pública | 120 / min | — |

La identidad es la **IP pseudonimizada** (HMAC + pepper): se limita sin almacenar ni propagar la IP en claro.

---

### Cuando el recuadro de Turnstile no aparece

El widget se carga desde `challenges.cloudflare.com`, y eso lo bloquean con
frecuencia las extensiones de privacidad y el bloqueo de rastreadores de algunos
navegadores. Cuando pasa, el recuadro no se pinta, el formulario viaja sin token
y el servidor lo rechaza.

Para que eso no sea un callejón sin salida:

- el hueco del widget lleva dentro un aviso oculto que el JavaScript destapa si
  a los ocho segundos el script no ha cargado;
- el mensaje del servidor distingue los casos: sin token, token caducado o clave
  mal configurada.

Si el acceso al panel se queda bloqueado por esto, el interruptor de Turnstile
está en `/admin/ajustes`… que a su vez está detrás del login. La salida sin
navegador:

```bash
npm run turnstile:off -- --env production   # desactiva la comprobación del acceso
npm run turnstile:on  -- --env production   # vuelve a activarla
```

Escribe en la tabla `settings` y purga la caché de ajustes en KV. Mientras está
desactivado siguen en pie el límite de 5 intentos por IP cada 15 minutos, el
límite global de 50 por hora y el bloqueo de la cuenta tras 5 fallos.

---

## 13. DNS y SSL/TLS

1. Añade el dominio a Cloudflare y apunta los nameservers.
2. Los registros del sitio deben estar **proxied** (nube naranja) para que WAF, CDN y caché actúen.
3. SSL/TLS → **Full (Strict)**.
4. Activa **Always Use HTTPS**, **Automatic HTTPS Rewrites** y **TLS 1.3**.
5. Mínimo TLS 1.2.
6. HSTS: la aplicación envía `Strict-Transport-Security` fuera de desarrollo. Actívalo también en el dashboard sólo cuando estés seguro del dominio y los subdominios; el `preload` es difícil de revertir.

Los dominios personalizados del Worker se declaran en `wrangler.jsonc` (`routes` con `custom_domain: true`) y se crean solos al desplegar.

---

## 14. Seguridad

| Riesgo | Mitigación |
|---|---|
| **XSS** | Sanitizador por allowlist en servidor antes de guardar; comentarios en texto plano escapados al renderizar; CSP con `nonce` + `strict-dynamic`, sin `unsafe-inline` ni `unsafe-eval` |
| **Inyección SQL** | Drizzle parametriza todo; los comodines de `LIKE` se escapan; los ordenamientos y filtros son enumeraciones cerradas validadas con Zod |
| **CSRF** | Cookies `SameSite=Strict`, comprobación de origen y token sincronizador ligado a la sesión comparado en tiempo constante. Los formularios públicos anónimos usan token HMAC firmado y caducable |
| **Fuerza bruta** | Rate limit por IP y global mediante DO + bloqueo de cuenta a los 5 fallos + Turnstile |
| **Session fixation** | Todas las sesiones previas se invalidan al autenticar; se emite un token nuevo |
| **Session hijacking** | En base de datos vive `SHA-256(token)`, nunca el token; cookies `HttpOnly`, `Secure`, `SameSite=Strict`; caducidad deslizante (2 h) y techo absoluto (12 h) |
| **Escalada de privilegios** | El rol se lee siempre de la sesión en base de datos; nada que envíe el cliente influye |
| **IDOR** | Los identificadores son UUID v4 y toda ruta del panel exige rol ADMIN |
| **Mass assignment** | Zod con esquemas cerrados: los campos no declarados se descartan |
| **Subidas maliciosas** | Magic bytes, límite de tamaño, límites de dimensiones, clave generada en servidor, `Content-Disposition: inline` y CSP `sandbox` al servir |
| **Clickjacking** | `frame-ancestors 'none'` + `X-Frame-Options: DENY` |
| **Cache poisoning** | Cache key normalizada, `Vary` explícito, nada autenticado entra en caché |
| **Abuso de reportes** | Índice único (comentario, reportante), Durable Object serializador, rate limit y Turnstile |
| **Fugas por logs** | Redacción recursiva por nombre de clave: contraseñas, tokens, cookies y secretos nunca se escriben |

Cabeceras enviadas en cada respuesta HTML: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`.

### Revisión previa a producción

```bash
npm run secrets:check      # nada de credenciales en el repositorio
npm run lint
npm run typecheck
npm test                   # unitarios + integración
```

Comprobación manual recomendada antes de abrir al público:

- [ ] El bucket R2 **no** es público.
- [ ] `wrangler secret list` muestra `HASH_PEPPER` y `TURNSTILE_SECRET_KEY` en cada entorno.
- [ ] `/admin` devuelve `X-Robots-Tag: noindex` y `Cache-Control: no-store`.
- [ ] La CSP de producción no contiene `unsafe-inline`.
- [ ] SSL/TLS en Full (Strict) y HSTS activo.
- [ ] Las Rate Limiting Rules del WAF están creadas.
- [ ] La contraseña del administrador es larga y única.

---

## 15. SEO

- Slug editable y único por reseña, con sufijo automático ante colisiones.
- `<title>`, meta description, `canonical`, Open Graph y Twitter/X Cards por reseña, con imagen `og` de 1200×630 generada por Cloudflare Images.
- **JSON-LD Schema.org**: `Review` con `itemReviewed` tipado según el contenido (`Book`, `Movie`, `TVSeries`, `ComicSeries`, `VideoGame`…) y `reviewRating` en escala 0–5. La home lleva `WebSite` con `SearchAction`.
- `sitemap.xml` con todas las publicadas y `lastmod`, `rss.xml` con las 20 últimas.
- `robots.txt` permite el contenido público, bloquea `/admin`, `/api` y los parciales del modal. **Fuera de producción bloquea el sitio entero**, para que staging no se indexe.
- El panel envía `X-Robots-Tag: noindex, nofollow` y `<meta name="robots" content="noindex">`.
- Contenido renderizado en servidor: indexable sin ejecutar JavaScript.

---

## 15b. Lista de pendientes

La cola de trabajo: lo que hay por ver, leer o jugar antes de reseñarlo.

**Es la lista del administrador**, no una por visitante — no hay registro de
usuarios y añadirlo sería contrario a la minimización de datos que sigue el
resto del sitio. Cada entrada puede marcarse **pública** (aparece en
`/pendientes`) o **privada** (sólo visible en el panel).

Tabla `watchlist_items`, deliberadamente más ligera que `reviews`: título, tipo,
año, autor, categoría, nota, enlace, prioridad, estado y portada opcional. Sin
puntuación ni cuerpo, porque todavía no hay opinión que dar.

| Estado | Significado | ¿Sale en público? |
|---|---|---|
| `PENDING` | En cola | Sí |
| `IN_PROGRESS` | Viéndolo ahora | Sí, en «Ahora mismo» |
| `DONE` | Terminado o ya reseñado | No |
| `DROPPED` | Abandonado | No |

Prioridad `HIGH` / `MEDIUM` / `LOW`. Ordena la cola del panel y destaca las
tarjetas públicas.

**Convertir en reseña** crea un borrador con los datos ya conocidos y la
portada, arranca el cuerpo con la nota del pendiente (escapada, porque es texto
plano y el cuerpo es HTML), marca el item como terminado y enlaza ambos
registros. La reseña **nace como borrador**: publicar sigue siendo un acto
explícito.

Para llenar la lista de golpe, `/admin/pendientes` acepta un título por línea
(máximo 50) con tipo y prioridad por defecto.

La página pública se cachea en el borde con su propio sello de versión
(`cachever:watchlist`), independiente del de las reseñas.

## 15c. Marca y sistema visual

El sitio implementa el brand kit **Modernist / rejilla editorial** con la marca
**1C · Tres reglas** (`tdl_brandkit.zip`). Los tokens viven en
`public/assets/styles.css` y se consumen siempre como variables CSS.

### La marca

Tres reglas horizontales de anchura 100 % / 66 % / 33 %, la tercera en acento,
alineadas a la izquierda. Insinúan el triángulo sin dibujarlo. Proporciones
fijas: grosor = 1/5 del alto del bloque, hueco = 0,6 × grosor, área de respeto
= 1 × el alto del isotipo.

Vive en **SVG en línea** (`src/server/views/components/brand.tsx`), no en
ficheros de imagen: los rectángulos heredan `currentColor`, así que la misma
marca sirve sobre fondo, sobre tinta y sobre acento sin duplicar versiones por
tema ni descargar nada.

| Sitio | Pieza |
|---|---|
| Cabecera (público y panel) | Lockup horizontal: isotipo + nombre |
| Mancheta de portada | Lockup vertical + lema |
| Acceso al panel | Lockup vertical |
| Pie | Nombre en peso 800 |

### Los mapas de bits

Sólo lo que un navegador no resuelve con SVG en línea. Se generan con Pillow,
que no es dependencia del proyecto:

```bash
pip install Pillow
python3 scripts/build-brand.py
```

`favicon.ico` (16/32/48), `apple-touch-icon.png`, `icon-192.png`,
`icon-512.png` y `assets/brand/og-default.jpg` (1200×630). Todos llevan el
isotipo **en caja de tinta**, nunca sobre fondo claro: a 16 px las reglas
necesitan el contraste máximo.

### Color y tipografía

Fondo `#f3f2f2`, tinta `#201e1d`, acento `#ec3013`. Proporción de uso: ~90 %
fondo y tinta, ~7 % grises de imagen, ~3 % acento. El rojo puro no alcanza
contraste AA como texto pequeño ni como relleno de un botón de 14 px, así que
esos dos casos usan `--color-accent-700`; el puro queda para filetes, cifras y
marcas de estado.

El tema oscuro no viene en el kit: se deriva intercambiando hueso y tinta y
subiendo el rojo un paso.

Tipografía **Archivo** en todo, autoalojada en `public/assets/fonts/`
(subconjunto latino, un solo fichero variable de 400 a 800). No se enlaza a
Google Fonts: filtraría la IP de cada visitante a un tercero, que en la UE es
un problema de RGPD.

### Iconos

Lucide, trazo 2,2 y remate recto, en `components/icons.tsx`. Un icono por medio
y nunca dos medios con el mismo (`MEDIA_ICON`): película `film`, libro
`book-open`, serie `tv`, videojuego `gamepad-2`, anime `sparkles`. El único
icono propio es el de filtro —las tres reglas de la marca giradas—, reservado a
controles de orden y filtrado.

### Reglas que no se rompen

Ninguna esquina redondeada · nada centrado · un solo rojo y siempre significa
algo · las reglas de 1 y 2 px no se sustituyen por aire · las notas van sobre
10 y con coma · las portadas en color y los fotogramas en blanco y negro · las
tres reglas de la marca,
100 / 66 / 33, en ese orden.

---

## 15d. Biblioteca privada (`books.`)

Un subdominio autenticado, en el **mismo Worker** que el sitio público. El
reparto se hace por host en `src/server/index.tsx`, antes de cualquier
middleware: `books.<dominio>` entra en `booksApp` y el resto en `app`. Son dos
aplicaciones Hono con cadenas separadas, no un prefijo de rutas, para que no se
pueda colar una cabecera de una en la otra.

Tiene dos mitades:

**Documentos PDF.** Se suben (hasta 50 MB), se leen dentro de la aplicación con
pdf.js autoalojado, y de cada uno se guarda por dónde va la lectura, sus notas y
sus subrayados.

**Biblioteca física.** Catálogo de los libros en papel, con alta por ISBN o
leyendo el código de barras con la cámara, portada y ficha editable.

### Acceso

Misma tabla `users` y mismo login que el panel: PBKDF2, bloqueo por intentos,
límite por IP y límite global. Lo que **no** se comparte es la sesión: la cookie
lleva prefijo `__Host-`, que la ata al host exacto, así que entrar en `/admin` no
abre la biblioteca ni al revés. Es deliberado — un fallo en un sitio no arrastra
al otro.

El guardián de autenticación va *antes* de las rutas, con lista de exenciones
explícita, de modo que una ruta nueva nace protegida.

### Cabeceras

La CSP del subdominio se separa de la del sitio público en dos puntos, y sólo
ahí:

| Directiva | Cambio | Por qué |
|---|---|---|
| `script-src` | añade `'wasm-unsafe-eval'` | pdf.js descodifica JBIG2, JPEG2000 y perfiles de color en WebAssembly, que es justo lo que lleva un libro escaneado. Permite instanciar WASM y nada más: no habilita `eval()` ni `new Function()` |
| `Permissions-Policy` | `camera=(self)` | el escáner de códigos de barras |

Sigue sin `unsafe-inline` y sin `unsafe-eval`. Además, nada se cachea
(`private, no-store`) y todo va con `X-Robots-Tag: noindex`.

### Almacenamiento

| Prefijo en R2 | Qué guarda | Cómo se sirve |
|---|---|---|
| `books/pdf/` | los PDF | ruta autenticada, con soporte de `Range` |
| `books/covers/` | portadas de la biblioteca | ruta autenticada |
| `backups/library/` | copias diarias | descarga autenticada |

`isSafeMediaKey()` sólo reconoce `reviews/covers/`, así que **la ruta pública
`/media/*` no puede servir nada de esto**, ni por error. Hay un test que lo fija.

La subida va en streaming hacia R2: 50 MB en memoria no caben con holgura en un
Worker. El cuerpo de la petición es el fichero en crudo — no multipart — y pasa
por un `TransformStream` que comprueba que empieza por `%PDF-` y aborta en
cuanto sabe que no. Como R2 exige longitud conocida, el flujo se encauza por
`FixedLengthStream`.

El visor pide rangos: sin respuestas `206` habría que descargar el libro entero
antes de pintar la primera página.

### Ordenar el catálogo

La búsqueda de la biblioteca admite diez criterios: apellido del autor, título,
nombre del autor, orden de alta, año de publicación (en los dos sentidos),
número de páginas (ídem), estado y nota. Se eligen con un desplegable que
conserva la búsqueda y el filtro de estado.

**Por omisión se ordena por apellido del autor**, que es como está ordenada la
biblioteca en papel: entrar y ver el catálogo en el mismo orden que la
estantería es lo que permite localizar un libro sin pensar. El valor vive en
`LIBRARY_SORT_DEFAULT` (`types/domain.ts`), del que tiran la validación, la
ruta y el desplegable — declararlo en cada sitio acabaría con tres respuestas
distintas.

**La ordenación se hace en el Worker, no en SQL**, por dos motivos que no son de
comodidad:

- **SQLite no sabe ordenar en español.** Compara códigos de carácter, así que
  «Álvarez» acaba detrás de «Zapata». `Intl.Collator('es')` sí, y el runtime
  trae ICU completo.
- **El apellido no es una columna.** `authors` es un texto con los autores
  separados por coma, tal y como venía del catálogo de origen.

El coste no cambia nada: la lista ya se traía entera —son cientos de fichas— y
ordenar en memoria no añade ni una lectura a D1.

El apellido se deriva con una heurística documentada en `lib/library-sort.ts`:
**el nombre de pila es la primera palabra y el apellido es el resto**, quitando
las partículas iniciales. Así «Miguel de Cervantes» se archiva por la C y
«Gabriel García Márquez» por García Márquez, que es como se ordena en español.

Lo que no tiene dato va **siempre al final**, se ordene ascendente o
descendente: de las 229 fichas importadas, 137 no traen año y 66 no traen
páginas, y verlas primero al pedir «más reciente» escondería el catálogo.

Todos los criterios desempatan por título, para que la lista no cambie de orden
entre recargas.

### Importar un catálogo desde MyLibrary

`scripts/import-mylibrary.py` trae a la biblioteca la exportación de MyLibrary,
la aplicación de Android desde la que salió el catálogo. Su zip contiene una
base SQLite con las tablas `BOOK` y `AUTHOR`, y un fichero aparte con las
portadas en base64.

```bash
# Análisis: no escribe nada, dice qué encontraría
python3 scripts/import-mylibrary.py mylibrary.zip --url https://books.triangulodelectores.site

# Importación de verdad
python3 scripts/import-mylibrary.py mylibrary.zip --url https://books.triangulodelectores.site --apply
```

**Por qué Python**: leer un fichero SQLite desde Node necesita `node:sqlite`,
que no existe hasta Node 22, y el proyecto va con el 20. En Python está en la
biblioteca estándar, igual que la lectura del zip. Ninguna dependencia nueva, y
ya había precedente con `scripts/build-brand.py`.

**Reparto de trabajo**: el script extrae y envía; la traducción de una ficha al
vocabulario de la biblioteca la hace el servidor
(`src/server/lib/mylibrary.ts`), porque ahí es donde están las decisiones
discutibles y ahí se pueden probar.

**Si el nombre no resuelve** justo después de publicar el subdominio, no es que
esté caído: los routers domésticos cachean las respuestas negativas, y si se
consultó el nombre antes de que existiera siguen contestando «no existe» durante
un rato. Se comprueba con `dig +short <host>` contra el resolutor propio y
contra `@1.1.1.1`; si sólo responde el segundo, es eso. `--ip <dirección>` salta
el DNS del sistema para esa ejecución, manteniendo el nombre para el SNI y la
cabecera `Host`.

**Si el borde devuelve 403**, es Bot Fight Mode o una regla del WAF bloqueando a
un cliente que no es un navegador. El script se identifica como
`TrianguloDeLectores-Import/1.0`; se puede cambiar con `--agente`, o crear una
regla «Skip» para tu IP mientras dure la importación. La salida distingue quién
rechaza mirando `X-Request-Id`, que sólo ponemos nosotros — `cf-ray` no vale,
porque lo lleva todo lo que pasa por Cloudflare.

**Es reanudable y no duplica.** Guarda el progreso en `.import-mylibrary.json`,
así que si se corta a mitad se vuelve a lanzar y sigue. Además, un ISBN que ya
está en el catálogo devuelve 409 y se salta: la importación se puede repetir
entera sin miedo.

**Lo que no cabe en una columna se conserva en las notas** con su etiqueta:
resumen, serie, categorías, comentarios, fechas de lectura, enlaces a tiendas y
el identificador de origen. Un ISBN con el dígito de control mal se descarta
—guardarlo como bueno rompería el antiduplicado— pero queda anotado, porque casi
siempre es un dígito mal tecleado que se puede arreglar a mano.

#### El enlace entre portada e imagen

Es la parte frágil de la importación, y conviene saber por qué.

El fichero de imágenes trae un `elementHashcode`, pero **no sirve para
emparejar**: es el `hashCode()` de identidad de la JVM que hizo la exportación.
Comprobado por dos vías — no coincide con el hash de ningún campo, ni con
ninguna combinación de hasta cuatro campos usando la fórmula con la que Java
combina varios valores.

Lo único que queda es el orden, y **cuál es no está documentado**. La primera
suposición (por ID de la ficha) resultó falsa contra la exportación real: 228
imágenes para 228 libros con `COVER_PATH`, las cantidades cuadraban, y aun así
los títulos no correspondían con las portadas. Que las cantidades coincidan es
condición necesaria, no suficiente.

Por eso **las portadas son opcionales y hay que decir con qué orden**:

```bash
# Vuelca muestras de cada hipótesis, una carpeta por orden
python3 scripts/import-mylibrary.py miBiblioteca.zip --url … --diagnostico

# En cada carpeta, el nombre del fichero es el título y el contenido la portada
# que le tocaría. La carpeta en la que corresponden indica el orden bueno.
python3 scripts/import-mylibrary.py miBiblioteca.zip --url … --portadas fichero --apply
```

Órdenes que se prueban: por ID, por nombre del fichero de imagen en orden
alfabético (`1.png`, `10.png`, `100.png`…, que es lo que hace un listado de
directorio), por título, **por apellido del autor** —con dos desempates
posibles a igual autor, título u orden de alta—, por nombre completo del autor
y por ID descendente.

La comparación alfabética quita los acentos antes de ordenar. Con el valor en
crudo se comparan códigos de carácter y «Álvarez» acaba detrás de «Zapata», que
no es el orden de ninguna aplicación con configuración regional ni el de ninguna
estantería.

Sin `--portadas` no se sube ninguna imagen: se importan sólo las fichas. Una
portada en el libro equivocado es peor que ninguna portada, y con 229 registros
no se detectaría hasta mucho después.

### Portadas de los PDF

Cada documento de la estantería tiene portada. Por omisión es **su primera
página**, rasterizada por pdf.js en el navegador justo después de subir el
fichero —el Worker no puede hacerlo sin una librería de PDF entera, y el fichero
ya está delante en ese momento—. Los documentos subidos antes de que existieran
las portadas la reciben la primera vez que se abren en el lector, donde pdf.js
ya está cargado.

También se puede poner a mano: subiendo una imagen o indicando una dirección.

**En los tres casos la imagen se guarda en R2.** Nunca se deja la URL de un
tercero en un `src`: si mañana ese servidor la cambia, la borra o registra a
quien la mira, el catálogo lo sufre. Lo que viaja al servidor es la dirección;
lo que se queda es el fichero.

Ir a buscar una imagen a una dirección que alguien escribe es superficie de
SSRF, así que `lib/remote-image.ts` sólo admite http y https por los puertos 80
y 443, rechaza direcciones privadas, de bucle, `.local`, `.internal`, los
endpoints de metadatos de nube e IPv6 literal, **no sigue redirecciones** —el
truco clásico para convertir una URL permitida en otra cosa— y corta la lectura
al llegar al límite de tamaño aunque el servidor mienta en `Content-Length`.

### Notas y subrayados

Los rectángulos se guardan **normalizados de 0 a 1** respecto al tamaño de la
página, no en píxeles: así el subrayado cae en su sitio con cualquier zoom y en
cualquier pantalla. El texto seleccionado se guarda aparte como cita, y se pinta
siempre con `textContent` — viene de un PDF, que puede llevar cualquier cosa
dentro.

La posición de lectura se guarda con retardo mientras se desplaza, y otra vez al
ocultarse la pestaña con `keepalive`, que es lo único que sobrevive a cerrar la
aplicación.

### ISBN y cámara

La ficha la consulta **el Worker** contra Open Library, nunca el navegador: así
`connect-src 'self'` se mantiene y la IP de quien usa la aplicación no llega a un
tercero. La portada también la descarga el servidor y la guarda en R2, con la
misma validación por magic bytes que una imagen subida a mano.

Para leer el código de barras se usa `BarcodeDetector` nativo donde existe
(Chrome, Android). Donde no —Safari, Firefox— se carga ZXing en JavaScript puro,
en un bundle aparte y sólo en ese momento: sin esa reserva la cámara no
funcionaría justo en el iPhone, que es donde más sentido tiene escanear un libro.

El ISBN se valida con su dígito de control y se normaliza siempre a ISBN-13. Un
EAN-13 que no empiece por 978/979 se rechaza: es un código de barras, pero no de
un libro.

### Copia diaria

Cuelga del cron que ya existía (`0 4 * * *`). Vuelca a
`backups/library/<fecha>.json.gz` el catálogo, las fichas de los PDF, el progreso
y las anotaciones, comprimido con `CompressionStream`. **Los ficheros PDF no
entran**: ya están en R2, que es donde iría la copia, y duplicarlos gastaría
cuota sin proteger de lo que de verdad puede perderse, que es la base de datos.
Se conservan 30 días y se pueden descargar desde `/copias`.

---

## 16. Privacidad y RGPD

Pensado para público de España y la UE:

- **Minimización**: al comentar sólo se pide un alias, que puede ser un seudónimo. No hay registro obligatorio ni email.
- **Sin IP en claro**: la dirección y el user-agent se guardan como HMAC irreversible con pepper secreto, sólo para limitar el spam y deduplicar reportes.
- **Cookies estrictamente necesarias**: `tdl_session` (12 h, sólo tras iniciar sesión) y `tdl_rid` (identificador aleatorio, 180 días, para no reportar dos veces). Ninguna de seguimiento ni publicitaria; no hace falta banner de consentimiento para estas.
- El tema claro/oscuro vive en `localStorage` y nunca viaja al servidor.
- **Retención limitada**: el registro de auditoría se purga automáticamente (365 días por defecto, configurable) mediante Cron Trigger; las sesiones caducadas se eliminan en el mismo proceso.
- **Supresión**: la acción «Borrar definitivamente» de moderación elimina el comentario y su subárbol de forma irreversible.
- Páginas de [privacidad](/privacidad) y [cookies](/cookies) incluidas y enlazadas desde el pie.
- Analítica: **Cloudflare Web Analytics**, sin cookies ni huella digital. Se añade desde el dashboard; no requiere tocar el código.

Para activar la purga programada, añade en `wrangler.jsonc` del entorno correspondiente:

```jsonc
"triggers": { "crons": ["0 4 * * *"] }
```

---

## 17. Observabilidad y analítica

**Workers Logs** está activado (`observability.enabled`). Los logs son JSON estructurado con `requestId` (el `CF-Ray`), ruta, método, estado, duración y país.

```bash
npx wrangler tail --env production
npx wrangler tail --env production --status error
```

Se registra: errores no controlados, fallos de autenticación, límites alcanzados, Turnstile rechazado, errores de base de datos y de subida.

**Nunca se registra**: contraseñas, tokens, cookies, secretos ni claves de API. La redacción es recursiva por nombre de clave (`src/server/lib/logger.ts`) y está cubierta por tests.

Además, la tabla `audit_log` guarda quién hizo qué y cuándo dentro del panel, consultable desde el dashboard.

---

## 18. Testing

```bash
npm run test:unit          # lógica pura, en Node
npm run test:integration   # dentro de workerd, con D1/R2/KV/DO reales
npm test                   # ambos
npm run test:e2e           # Playwright
```

**Unitarios** (`tests/unit/`): sanitizado con vectores XSS reales, validación de esquemas, conversión de puntuaciones, umbral de moderación, hashing y pseudonimización, validación de imágenes y claves de R2, slugs, y la validación de la lista de pendientes.

**Integración** (`tests/integration/`): corren en **workerd**, el mismo runtime que Cloudflare, con Miniflare proporcionando D1, R2, KV y Durable Objects auténticos. Sin mocks. Cubren autenticación completa, CSRF, cabeceras de seguridad, CRUD de reseñas, filtros y paginación, comentarios anidados con límite de profundidad, moderación, reportes con deduplicación y umbral, subidas a R2 con MIME spoofing y path traversal, caché, rate limiting, y la lista de pendientes completa (alta, cola, visibilidad pública y conversión en reseña).

**E2E** (`tests/e2e/`): el recorrido completo — login, crear reseña, subir portada, publicar, visualizar en modal, comentar, responder, reportar, alcanzar el umbral, moderar, eliminar y restaurar — más un bloque de accesibilidad que incluye **navegación con el sitio sin JavaScript**.

`npm run test:e2e` reinicia el estado local (`.wrangler/state`), aplica migraciones, siembra datos, crea el administrador de pruebas y levanta `wrangler dev`. El reinicio es deliberado: **el rate limiting es real**, y repetir la suite sin limpiar acabaría bloqueando los comentarios — que es exactamente lo que debe ocurrir en producción. Si prefieres conservar tus datos locales, ejecuta `node scripts/e2e-prepare.mjs && npx playwright test`.

Para apuntar a un entorno desplegado:

```bash
E2E_BASE_URL=https://staging.triangulodelectores.site npm run test:e2e
```

---

## 19. CI/CD

`.github/workflows/ci.yml`:

```text
push a main
   ↓
instalar dependencias
   ↓
escaneo de secretos → lint → typecheck → tests unitarios → tests de integración → build
   ↓
migraciones en staging → desplegar staging
   ↓
E2E contra staging
   ↓
migraciones en producción → desplegar producción → comprobación de humo
```

Si algo falla, **no se despliega**: cada etapa depende de la anterior. El entorno `production` de GitHub puede exigir aprobación manual añadiendo revisores en la configuración del repositorio.

`.github/workflows/security.yml` corre semanalmente y en cada PR: `npm audit`, escaneo de secretos y verificación de que el código del Worker no importa APIs de Node incompatibles.

Secretos necesarios en GitHub (Settings → Secrets and variables → Actions):

| Secreto | Uso |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Permisos: *Workers Scripts: Edit*, *D1: Edit*, *Workers KV Storage: Edit*, *Workers R2 Storage: Edit* |
| `CLOUDFLARE_ACCOUNT_ID` | Cuenta destino |
| `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD` | Usuario de pruebas en staging |

---

## 20. Despliegue y rollback

### Antes de subir nada

```bash
npm run preflight
```

Ejecuta de una vez toda la verificación previa a producción y devuelve código
distinto de cero si algo falla:

| Comprobación | Qué mira |
|---|---|
| Entorno | Node ≥ 20 y dependencias instaladas |
| Secretos | Que no haya credenciales en el repositorio |
| Configuración | Marcadores `REPLACE_WITH_` pendientes en producción y flags de compatibilidad |
| Runtime | Que el código del Worker no importe APIs de Node |
| Calidad | ESLint y TypeScript (Worker, cliente y herramientas) |
| Tests | Unitarios + integración en workerd real |
| Build | Bundles de cliente y `deploy --dry-run` en los tres entornos |
| E2E | Recorrido completo con Playwright |

Variantes:

```bash
npm run preflight -- --quick                        # sin E2E ni dry-run
npm run preflight -- --skip-e2e                     # sin E2E
npm run preflight -- --base http://127.0.0.1:8787   # E2E contra tu `npm run local`
```

Al terminar imprime además la lista de comprobaciones que ningún script puede
hacer por ti (bucket R2 privado, secretos puestos, SSL/TLS, WAF, copia de
seguridad de D1). Repásala antes de desplegar.

### Primer despliegue

```bash
npm run build                      # dry-run: valida bindings
npm run db:migrate:staging
npm run deploy:staging
npm run admin:create -- --env staging

# Verificación manual en staging, y después:
npm run db:migrate:prod
npm run deploy
npm run admin:create -- --env production
```

### Comprobaciones tras desplegar

```bash
curl -s https://triangulodelectores.site/health
curl -sI https://triangulodelectores.site | grep -i content-security-policy
curl -sI https://triangulodelectores.site/admin | grep -i x-robots-tag
curl -s https://triangulodelectores.site/robots.txt
```

Y a mano: iniciar sesión, crear una reseña, subir portada, publicarla, comentar, reportar y moderar.

### Rollback

```bash
npx wrangler deployments list --env production
npx wrangler rollback --env production                 # a la anterior
npx wrangler rollback <deployment-id> --env production # a una concreta
```

`rollback` revierte **el código, no la base de datos**. Por eso las migraciones son aditivas: una versión anterior del Worker sigue funcionando contra un esquema más nuevo. Si una migración fuera incompatible, restaura primero desde el export:

```bash
npx wrangler d1 export tdl-db-prod --env production --remote --output backup.sql
```

---

## 21. Estructura del proyecto

```text
src/
├── server/
│   ├── index.tsx            # entrada del Worker: rutas, errores, cron, export de DO
│   ├── routes/              # public.tsx · api-public.ts · admin.tsx · books.tsx
│   ├── middleware/          # security (CSP) · context · auth (RBAC/CSRF) · ratelimit
│   ├── services/            # reglas de negocio: reviews, comments, media, stats,
│   │                        #   documents, library, backup
│   ├── lib/                 # crypto · sanitize · cache · images · seo · turnstile · …
│   └── views/               # SSR con hono/jsx: layout, components, pages, admin, books
├── client/                  # islas del navegador (app.ts, admin.ts, books.ts,
│                            #   scanner.ts) → esbuild
├── db/
│   ├── schema.ts            # espejo tipado del SQL
│   ├── client.ts            # Drizzle sobre D1
│   └── repos/               # única capa que conoce SQL
├── do/                      # Durable Objects + reglas puras
├── types/                   # bindings y vocabulario del dominio
└── validation/              # esquemas Zod

migrations/                  # SQL aplicado a D1
public/                      # assets estáticos servidos por el Worker
scripts/                     # build de cliente y de marca, seed, admin, reset, secretos
tests/
├── unit/  ├── integration/  └── e2e/

wrangler.jsonc  ·  Dockerfile  ·  docker-compose.yml  ·  .dev.vars.example  ·  .env.example
```

---

## 22. Comandos

```bash
npm install                # instalar dependencias
npm run local              # entorno local completo, listo para probar
npm run local:reset        # ídem, partiendo de cero
npm run preflight          # verificación completa antes de producción
npm run dev                # sólo el servidor (sin preparar datos)
npm run build:client       # empaquetar las islas del navegador
npm run build              # dry-run del Worker (valida bindings)
npm run lint               # ESLint
npm run typecheck          # TypeScript (Worker + cliente + herramientas)
npm test                   # tests unitarios + integración
npm run test:e2e           # Playwright
npm run secrets:check      # escaneo de secretos

npm run db:migrate:local   # migraciones locales
npm run db:seed:local      # datos de ejemplo
npm run db:reset:local     # reconstruir la base local
npm run admin:create       # crear o actualizar el administrador

npm run deploy:staging     # desplegar en staging
npm run deploy             # desplegar en producción
```

---

## 23. Limitaciones conocidas

Dicho con claridad, porque conviene saberlo antes y no después:

- **Búsqueda**: es `LIKE` sobre título, título original, autor y resumen. Correcto hasta unos pocos miles de reseñas. A partir de ahí, el paso siguiente es una tabla virtual **FTS5 en D1** sincronizada por triggers, no un servicio externo.
- **Durable Objects requiere Workers Paid.** En plan gratuito el rate limiting cae en modo permisivo controlado (falla abierto) y la protección real la aportan las Rate Limiting Rules del WAF. El límite de 10 ms de CPU del plan gratuito además aprieta en el login por el coste de PBKDF2; si es tu caso, baja las iteraciones o usa el plan de pago.
- **`document.execCommand`** sustenta el editor enriquecido. Está marcado como obsoleto pero sigue funcionando en todos los navegadores actuales y evita traerse un editor de 300 kB. La autoridad sobre el HTML es en cualquier caso el sanitizador del servidor.
- **Cloudflare Images (transformaciones)** se factura aparte y requiere activarlo en la zona. Con `IMAGE_RESIZING=false` el sitio funciona sirviendo originales, a costa de peso.
- **Sin registro de usuarios**: el rol `USER` existe en el modelo de datos y en las comprobaciones de permisos, pero no hay pantalla de alta. Comentar es anónimo por diseño (minimización de datos).
- **Paginación por `OFFSET`**: perfectamente válida a esta escala; con catálogos muy grandes convendría paginación por cursor.
