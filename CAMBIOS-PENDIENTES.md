# Cambios pendientes de commitear

*Al 4 de septiembre de 2026.* Reescrito de cero: lo que había antes en este
documento —aplicación Android inicial, medio punto en las notas, exclusividad
entre pendientes y reseñas, estrellas en el editor— ya está commiteado. Lo que
sigue es exactamente lo que marca `git status` ahora mismo: 16 ficheros
modificados y 3 nuevos.

**El código ya está desplegado en producción y en staging** —Worker, las dos
migraciones y el APK 1.1.0— **pero no está commiteado.** Sigue en pie lo de
siempre: no hay ningún punto de git al que volver si algo se rompe. Verificado
en verde: `preflight` completo, 240 tests de integración, typecheck y ESLint.

---

## 1. Biblioteca en papel desde el móvil — funcionalidad nueva

La aplicación Android ya no es sólo lector de PDF: ahora consulta y gestiona el
catálogo en papel, con alta por ISBN o a mano.

**Servidor** (`src/server/routes/movil.ts`): seis rutas nuevas bajo
`/api/movil/biblioteca`, detrás del mismo guardián de token de dispositivo que
el resto de la API. No reimplementan nada: llaman a `LibraryService`, el mismo
que usa la web, así que heredan el antiduplicado por ISBN (409, no 400), la
descarga de portada a R2 y la auditoría. La consulta a Open Library y el orden
del catálogo los hace el Worker, no el teléfono, por las mismas razones que en
la web (IP de quien consulta, columna `surname` que no existe en SQL).

**Aplicación** (`ui/BibliotecaScreen.kt`, `ui/BibliotecaViewModel.kt`, nuevos):
pantalla con búsqueda con debounce, filtros por estado, cuatro criterios de
orden, portadas cacheadas en memoria y un editor que sirve para alta y edición.
El catálogo **no se guarda en local** —a diferencia de la estantería de PDF—
porque se edita poco y se consulta con red.

**Trampa documentada:** los campos de texto opcionales del servidor aceptan
`undefined` o `""` pero no `null` (Zod `.optional()` no es lo mismo que
nullable); el DTO de envío usa cadenas vacías por defecto, nunca nulos.

Tests: 12 nuevos en `tests/integration/movil.test.ts` (alta, listado, búsqueda,
edición, borrado, ISBN duplicado → 409, estado inventado → 400, sin token → 401,
cookie del panel → 401).

**Pendiente, no empezado:** escanear el código de barras en vez de teclear el
ISBN. Exige el permiso `CAMERA`, que la aplicación no pide hoy; lo dejé fuera a
propósito sin decisión del usuario.

## 2. Lector de PDF: gestos, zoom y encaje

Cuatro fallos de la misma sesión de pruebas, todos en `ui/LectorScreen.kt`
salvo el indicado:

- **Página en blanco con cualquier PDF.** `horizontalScroll` medía con anchura
  infinita y `fillMaxWidth()` se quedaba en el mínimo (cero) por dentro; el
  ancho se mide ahora fuera del contenedor de scroll.
- **Texto negro sobre fondo oscuro** (`ui/AjustesScreen.kt` también).
  `LocalContentColor` vale negro fijo en Material 3 y no se deriva del tema:
  sólo lo cambia un `Surface`. Ambas pantallas eran `Column` pelados.
- **Parpadeo en blanco al hacer zoom y gesto no fluido.** Cada paso de zoom
  repintaba todas las páginas visibles. Ahora el zoom que se ve
  (`graphicsLayer`, GPU) y el zoom al que se pinta (`zoomRaster`) son cosas
  distintas; éste sólo se mueve 180 ms después de que el gesto para, y el mapa
  de bits anterior se queda en pantalla (estirado) hasta que el nuevo está
  listo.
- **No había diagonal al arrastrar.** Un `horizontalScroll` envolviendo un
  `LazyColumn` vertical son dos ejes que Compose no combina. Sustituido por un
  único detector (`gestosDeLectura`) que reparte las dos componentes del mismo
  arrastre.
- **El zoom no se anclaba al punto medio entre los dedos.** Escalaba desde la
  esquina y el contenido se escapaba en diagonal. Corregido a mano en los dos
  ejes con `calculateCentroid()`, usando el factor ya recortado por el techo y
  el suelo del zoom.
- **Techo de zoom, 400 % → 800 %.** El techo de rasterizado ya no es una
  constante: sale de `Runtime.maxMemory()`, reservando como mucho un octavo del
  montón para una sola página. Pasado un ~3× la página se estira en vez de
  repintarse.

## 3. Estantería: cabecera compacta

`ui/EstanteriaScreen.kt`. La cabecera ocupaba dos filas más la marca bajo el
título —unos 130 dp antes del primer documento—. Ahora es una sola fila:
título, «Abrir PDF» y un menú `···` con «Biblioteca», «Sincronizar ahora» y
«Ajustes». La marca de tres reglas se movió a la pantalla de estantería vacía.

## 4. Botón de descarga del APK ilegible

`public/assets/styles.css`. `.prose a` (especificidad 0,1,1) ganaba a
`.btn--primary` (0,1,0): la etiqueta salía en rojo de enlace sobre el relleno
rojo del botón, casi invisible hasta el `:hover`. Añadidas reglas
`.prose a.btn*` con la especificidad correcta.

## 5. `migrations/0004_movil.sql`: comentario corregido, no re-aplicado

Un `--` dentro de un comentario de bloque (`/** ... -- ... */`) hacía que el
troceador de D1 remoto se comiera el `*/` de cierre; SQLite seguía comentando
hasta el siguiente `*/`, y las columnas `device_name` y `platform` de
`device_tokens` nunca llegaron a crearse **en producción ni en staging**
—sólo se ve pasando por el troceador remoto, ni tests ni entorno local lo
detectan—. El emparejamiento fallaba con 500 en el `INSERT`.

**Ya reparado a mano en las dos bases remotas** (no por esta migración: el
pipeline es aditivo y esto tocaba una tabla ya desplegada). El cambio que
queda pendiente de commitear es sólo la corrección del comentario en el
fichero fuente, para que una base nueva se cree bien desde el principio.

## 6. `values-night/colors.xml` (nuevo)

`@color/fondo` tenía un solo valor, oscuro, mientras Compose sigue la
preferencia del sistema: en tema claro se veía el fondo de ventana oscuro por
detrás de cualquier pantalla sin `Surface` propio. Añadida la variante
`values-night` con el fondo claro en `values/colors.xml` y el oscuro en
`values-night/colors.xml`.

---

## Estado del despliegue

**Producción y staging están al día con este árbol de trabajo** —no con
git—. Migraciones `0004_movil.sql` y `0005_nota_media.sql` aplicadas en los
dos. Worker desplegado dos veces en esta sesión (versión de producción
`584e2a21…`, de staging `238277ae…`). APK **1.1.0** (versionCode 6) publicado
en el bucket de producción; es el primero con la biblioteca en papel.

`device_tokens` reparado a mano en producción y en staging (ver §5): la tabla
estaba vacía en los dos casos, así que no hubo pérdida de datos.

## Commit sugerido

1. Lector de PDF: gestos, zoom y encaje (§2).
2. Estantería compacta y botón de descarga legible (§3, §4).
3. Corrección del comentario en `0004_movil.sql` (§5) y `values-night` (§6).
4. Biblioteca en papel desde el móvil, servidor y aplicación (§1).
