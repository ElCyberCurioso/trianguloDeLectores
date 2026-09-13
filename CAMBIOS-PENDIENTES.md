# Cambios pendientes de commitear

*Al 13 de septiembre de 2026.*

Reescrito: lo que había antes en este documento —la biblioteca en papel desde el
móvil, los gestos y el zoom del lector, la cabecera compacta de la estantería, el
botón de descarga del APK, la corrección del comentario de `0004_movil.sql` y
`values-night/colors.xml`— **ya está commiteado** en `d16c5b8`. Se comprobó
fichero a fichero contra `HEAD`, no de memoria: el documento se había quedado
describiendo como pendiente algo que ya no lo estaba.

Lo que sigue es lo que marca `git status` ahora mismo: **42 ficheros modificados
y 15 nuevos**.

**Producción y staging llevan §1 y §2 desplegados; §3 no.** La migración
`0006_periodos_y_episodios.sql` está aplicada en los dos entornos. Sigue en pie
lo de siempre: no hay ningún punto de git al que volver si algo se rompe.

Verificado en verde: `preflight` completo —272 tests de integración, 20
unitarios nuevos, E2E y los tres dry-runs—, salvo el chequeo «Sin secretos en el
repositorio», que falla por dos motivos ajenos a este trabajo: los volcados
`backup-prod-*.sql` que hay en el directorio (ignorados por git) y un token
falso en `tests/integration/movil.test.ts`.

---

## 1. Lector de Android: subrayar texto, zoom, notas del PDF y escáner

*Desplegado. APK 1.2.0 publicado en producción; el árbol va ya por 1.2.1.*

**Capa de texto** (`pdf/TextoPdf.kt`, `pdf/Seleccion.kt`, nuevos). `PdfRenderer`
pinta y no lee, así que el mismo fichero se abre una segunda vez con
**PdfBox-Android**, que no pinta nada pero dice dónde cae cada palabra. El
subrayado ya no marca una zona: va de una palabra a otra **en orden de lectura**,
un rectángulo por renglón y con su `cita`, igual que el lector web. Un toque
marca una palabra. En una página sin texto —un escaneado sin OCR— sigue el
recuadro a mano, y lo decide la página, no un interruptor. La capa se abre tarde
(al entrar en modo subrayado o al pedir las notas) y a fichero temporal.

**El encuadre del zoom se escapaba por la izquierda.** Se acotaba sólo al
arrastrar, y el tope izquierdo depende del zoom mientras el derecho es cero
siempre: bajar el zoom con el botón, con el doble toque o girar el teléfono
dejaba un desplazamiento ya ilegal, y con el zoom otra vez a uno no había forma
de traer el documento —el gesto de un dedo sólo actúa si hay zoom—. Ahora se
reacota al cambiar el zoom o el hueco, y también al pintar. Dentro del pellizco
se acota con el zoom **pedido**, no con el de la composición, que va una
recomposición por detrás.

**Notas incrustadas del propio PDF**, en los dos lectores. pdf.js y PDFBox las
tenían delante desde siempre y los dos las tiraban.

**Escáner de código de barras** (`ui/EscanerIsbn.kt`, nuevo): CameraX más ZXing
en Java puro, el mismo descodificador que la reserva del lector web. Permiso
`CAMERA` nuevo, `required="false"`, pedido al entrar en el escáner.

Dependencias nuevas del proyecto Android: `pdfbox-android`, `zxing:core`,
CameraX y `lifecycle-runtime-compose`, con sus reglas de R8. APK de release:
9,2 MB.

Tests: 7 de `SeleccionTest` (JVM, los primeros del proyecto Android).

## 2. Pendientes gestionables desde su página, periodos y reseñas por episodio

*Desplegado, con la migración `0006` aplicada en los dos entornos.*

**La gestión de pendientes se muda a su propia página.** Estaba repartida entre
`/pendientes` y el panel. Ahora, con sesión, la tarjeta entera lleva a la
edición y arriba hay un botón de añadir. Rutas nuevas `/pendientes/nuevo` y
`/pendientes/:id/editar` detrás de `requireAdmin` y `requireCsrf`. Formulario
compartido con el panel (`components/watchlist-form.tsx`).

**Filtro por varios campos** en la página pública. Lo que se puede ver no lo
decide la URL: sin sesión, `status` y `visibility` se recortan antes de tocar la
base de datos.

**El año pasa a ser un periodo** (`year`, `year_end`, `year_ongoing`) más
`seasons`, escrito en un solo campo de texto que traduce `parseYearRange()`. Las
búsquedas comparan por solape.

**Reseñas por temporada y capítulo** en `review_episodes`, con estadísticas en
la ficha pública: media, valorados sobre el total, mejor y peor, media por
temporada y reparto de notas en once cajones.

**El resumen sube de 600 a 4.000 caracteres.**

Tests: 13 de `parseYearRange`, 7 de `computeEpisodeStats` y 26 de integración.

## 3. Tres fallos de uso: modal, filtros y documentos que se perdían

***Sin desplegar.*** Sin migración.

**Dos barras de desplazamiento en el modal de reseñas.** El `<dialog>` y
`.modal__content` llevaban los dos `max-height: 88svh`, y el navegador le pone
`overflow: auto` al diálogo por su cuenta. Ahora el diálogo recorta y el
contenido es el único que se desplaza. El `display` va en `.modal[open]` y no en
`.modal`, porque un `display: flex` suelto le gana al `display: none` que el
navegador da a los diálogos cerrados.

**Los filtros no filtraban, y en los tres listados del sitio.** Un `<select>` en
«Todos» manda `type=`, la cadena vacía; para Zod eso no es «ausente» sino un
valor fuera del enum, así que `safeParse` fallaba y la ruta caía a los valores
por omisión, reseteando el filtro entero, búsqueda incluida. Arreglado en
`F.queryParams()`, que quita los parámetros vacíos antes de validar.

**Android: un PDF abierto desde otra aplicación se perdía.** La URI de un
`ACTION_VIEW` es un préstamo de un solo uso, y WhatsApp y Telegram la sirven
desde una caché suya que vacían cuando quieren. `importarEfimero()` se trae
ahora una copia a `filesDir/importados`. Versión **1.2.1** (versionCode 8), sin
publicar.

Tests: 3 de integración para los filtros y 1 de E2E para el modal.

---

## Lo que no se ha podido probar

- **Nada de la aplicación Android se ha ejecutado nunca en un teléfono**: no hay
  dispositivo ni emulador en esta máquina. El subrayado sobre texto, el escáner,
  el encuadre del zoom y la copia del documento importado están verificados de
  compilación, R8 y firma, no de uso.
- El alta y la edición de pendientes desde la página pública y la ficha de
  episodios sólo se han probado contra workerd, no en el sitio con una sesión
  real.

## Estado del despliegue

**Producción y staging están al día con §1 y §2 de este árbol de trabajo** —no
con git—. Último despliegue, **12 de septiembre de 2026**: producción
`25ab7c89…`, staging `c2130308…`, con `0006_periodos_y_episodios.sql` aplicada
antes en los dos entornos y verificada columna a columna.

Copias de seguridad previas en `backup-prod-2026-09-12-antes-0006.sql` y
`backup-prod-staging-2026-09-12-antes-0006.sql`, fuera del repositorio.

Datos en producción tras la migración: 229 libros, 137 pendientes, 2 reseñas.

APK **1.2.0** (versionCode 7) publicado en el bucket de producción, firmado con
el mismo certificado que el 1.1.0 —comprobado contra el binario que servía el
sitio antes de subir el nuevo—. El **1.2.1 del árbol no está publicado**.

## Commit sugerido

1. Lector de Android: capa de texto, encuadre del zoom, notas incrustadas y
   escáner de códigos de barras (§1).
2. Migración `0006`, pendientes gestionables desde su página, periodos de años y
   reseñas por episodio (§2).
3. Modal con una sola barra, filtros que vuelven a filtrar y documentos
   importados que no se pierden (§3).
