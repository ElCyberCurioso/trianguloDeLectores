# Cambios pendientes de commitear

Estado del árbol respecto a `ff298d3`. **60 ficheros**: 28 nuevos y 32
modificados; unas 2.000 líneas añadidas sin contar los ficheros nuevos.

Todo lo que había antes en este documento —el rediseño Modernist, la nota sobre
10, las recomendaciones del público, la cabecera unificada— **ya está en
`ff298d3` y desplegado**. Lo que queda aquí es sólo lo que todavía no está en
git.

`npm run preflight -- --skip-e2e` pasa entero: secretos, lint, los cuatro
typecheck, **369 tests** unitarios y de integración, compilación y simulacro de
despliegue en los tres entornos.

---

## 1. Biblioteca privada (`books.`) — funcionalidad nueva

Un subdominio autenticado dentro del mismo Worker, repartido por host en
`src/server/index.tsx`. Dos mitades: los PDF que se leen dentro de la aplicación
y el catálogo de los libros en papel.

**Lector de PDF** con pdf.js autoalojado: subida en streaming hasta 50 MB,
servicio por rangos, progreso de lectura, notas y subrayados en cuatro colores.
Portada por omisión sacada de la primera página, o puesta a mano subiendo una
imagen o indicando una dirección — que el servidor descarga y guarda, nunca
enlaza.

**Catálogo en papel** con alta por ISBN contra Open Library, lectura del código
de barras con la cámara y ordenación por diez criterios.

**Copia diaria** del catálogo colgada del cron que ya existía.

Ficheros nuevos: `migrations/0003_books.sql`, `src/server/routes/books.tsx`,
`src/server/views/books/`, `src/server/services/{documents,library,backup}.ts`,
`src/db/repos/{documents,library}.ts`, `src/client/{books,scanner}.ts` y seis
módulos en `src/server/lib/`.

## 2. Importación del catálogo de MyLibrary

`scripts/import-mylibrary.py` vuelca la exportación de la aplicación de Android
(229 libros con sus portadas en base64). La traducción de fichas la hace el
servidor, donde se puede probar; el script sólo extrae y envía.

El emparejamiento de las portadas **es por orden y hay que elegirlo**
(`--portadas <orden>`): el `elementHashcode` del fichero de origen no sirve, y
el orden bueno no está documentado. Hay un `--diagnostico` que vuelca muestras
de cada hipótesis. El detalle está en el README.

## 3. Correcciones sobre lo ya desplegado

- **Login**: extraído a `src/server/lib/login.ts` y compartido por el panel y la
  biblioteca. La comprobación anti-bot ya no se exige a un formulario que no
  pinta el widget, que devolvía 401 en cada intento.
- **Turnstile**: el hueco del widget lleva dentro un aviso que se destapa si el
  script de Cloudflare no carga, y los mensajes de error distinguen entre falta
  de token, token caducado y clave mal configurada.
- **Vista previa de portadas**: sale de la URL que devuelve el servidor y no de
  un `blob:`, que la CSP bloquea.
- **Móvil**: la estantería, el lector y el catálogo, revisados en navegador real
  a 390 px.
- **SVG de la marca e iconos** llevan `xmlns`, para que sigan siendo válidos
  fuera del documento.
- **`extractYear`** compartido: la copia que había en el cliente de Open Library
  perdía el año en las fechas tipo «c1998».

## 4. Configuración

- `wrangler.jsonc`: rutas y `BOOKS_URL` de los subdominios en los tres entornos;
  fuera `limits.cpu_ms`, que no existe en plan Free y dejaba el Worker roto;
  `IMAGE_RESIZING` a `false` en los dos entornos publicados.
- `scripts/turnstile.mjs`: activa o desactiva la comprobación del acceso sin
  navegador. El interruptor vivía detrás del propio login.

---

## Estado del despliegue

Producción y staging están **al día** con este árbol: el último despliegue de
producción es del 31 de agosto a las 20:07 UTC y la migración `0003_books.sql`
está aplicada en los dos entornos.

Si se toca código antes de commitear, hay que volver a desplegar. Y conviene
commitear pronto: **producción está corriendo código que sólo existe en el árbol
de trabajo**, así que ahora mismo no hay ningún punto de git al que volver.

## Pendiente en el panel de Cloudflare

No lo puede hacer ningún script.

- [ ] **`www.triangulodelectores.site` devuelve 522.** Tiene un registro DNS
      proxied apuntando a un origen que no responde — exactamente lo que le
      pasaba al apex. Hay que borrar ese registro y crear una regla de
      redirección al dominio raíz.
- [ ] SSL/TLS en Full (Strict) y Always Use HTTPS.
- [ ] Reglas del WAF y Rate Limiting (README §12).
- [ ] Bucket R2 de producción **no** público.
- [ ] Transformaciones de imagen: no están activas y no entran en el plan Free.
      Por eso `IMAGE_RESIZING` está en `false` en los dos entornos: con `true`,
      cada portada pide `/cdn-cgi/image/…` y recibe un 404. Si algún día se
      activan, hay que volver a ponerlo en `true` en staging y en producción.
- [ ] Bot Fight Mode bloquea al script de importación con un 403 si se
      identifica como cliente de Python. Está resuelto mandando un agente
      propio, pero si vuelve a molestar, la salida limpia es una regla «Skip»
      para la IP desde la que se importe.

## Contenido

Producción tiene el catálogo de la biblioteca importado, pero **cero reseñas y
cero pendientes**: el sitio público funciona y está vacío.

## Commit sugerido

Es un cuerpo de trabajo grande pero coherente. Si se prefiere partirlo:

1. Biblioteca privada: subdominio, lector de PDF, catálogo y copia diaria.
2. Importación desde MyLibrary.
3. Correcciones sobre lo desplegado (login compartido, Turnstile, móvil, SVG).
4. Configuración de despliegue y utilidades de operación.
