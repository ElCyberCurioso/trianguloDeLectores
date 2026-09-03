# Cambios pendientes de commitear

Estado del árbol respecto a `f169a49`. **38 ficheros modificados** (unas 1.700
líneas añadidas) y **11 rutas nuevas**, una de ellas el proyecto Android entero:
37 ficheros de fuente y unas 4.200 líneas.

Lo que había antes en este documento —la biblioteca privada del subdominio
`books.`, la importación del catálogo de MyLibrary, el login compartido, los
mensajes de Turnstile y la configuración de despliegue— **ya está en `f169a49`**.
Aquí queda sólo lo que todavía no está en git.

Verificación completa en verde: los cuatro `typecheck`, `eslint`, **406 tests**
unitarios y de integración, y **65 de Playwright**.

---

## 1. Aplicación Android y su API — funcionalidad nueva

Un lector de PDF para el teléfono (`android/`, Kotlin + Compose, `minSdk` 26).
Lee PDF del propio dispositivo sin cuenta ni red —con subrayados, notas y
páginas marcadas que no salen de ahí— y, si se empareja, sincroniza en los dos
sentidos lo de la biblioteca privada.

**Por qué una credencial aparte.** La aplicación no puede usar la sesión del
navegador: la cookie caduca a las 2 h de inactividad y el CSRF exige un `Origin`
que un cliente nativo no manda. En vez de aflojar ninguna de las dos cosas, hay
un **token de dispositivo** en `Authorization: Bearer` (`device_tokens`), guardado
hasheado con SHA-256, de 90 días renovables y revocable de uno en uno. El
emparejamiento pasa por `attemptLogin()` con `establishSession: false`, así que
hereda el límite global, el hash señuelo, el bloqueo por intentos y la auditoría
sin duplicarlos.

**Cómo se resuelven los conflictos.** Gana la escritura más reciente, y la
comparación la hace SQLite dentro del `ON CONFLICT DO UPDATE`. Las marcas de
tiempo del cliente se recortan al reloj del servidor —un teléfono con la fecha
adelantada ganaría todos los conflictos futuros—, las anotaciones pasan a
borrarse en lógico —sin lápida, lo borrado en la web revivía en la siguiente
sincronización— y la bajada trae `documentIds` entero, que es la única forma de
enterarse de un documento dado de baja.

**Distribución del APK.** Página `/aplicacion` con la descarga, la suma SHA-256 y
las instrucciones; `/aplicacion/descargar` sirviendo el binario desde R2 con la
clave revalidada; `/aplicacion/version.json` para que la propia aplicación avise
de que hay versión nueva, porque sin Play Store no hay quien lo haga por ella.
`npm run apk:publish` sube binario y manifiesto, en ese orden.

Ficheros nuevos: `android/`, `migrations/0004_movil.sql`,
`src/server/routes/movil.ts`, `src/server/lib/{device-auth,apk}.ts`,
`src/db/repos/devices.ts`, `src/server/views/pages/app.tsx`,
`scripts/publish-apk.mjs`, `tests/integration/{movil,aplicacion}.test.ts`.

**28 tests nuevos**, sobre todo de lo que no debe pasar: que la cookie no abra la
API del móvil, que el token no abra el panel, que una fecha del futuro se
recorte, que un borrado no reviva, que un lote desmesurado se rechace y que un
manifiesto manipulado no pueda hacer que la ruta pública sirva otro objeto del
bucket.

## 2. Medio punto en las notas

El editor ya prometía «de 0 a 10, con medio punto de precisión», pero el
desplegable ofrecía once enteros y la columna tenía `CHECK (rating BETWEEN 0 AND
10)`: la promesa estaba en la etiqueta y en ningún sitio más.

La nota se guarda ahora en **medios puntos** —entero 0..20 en
`reviews.rating_half`— y se convierte sólo en `scoreToHalf()` / `halfToScore()`.
La columna `rating` no se toca: cambiar su `CHECK` obliga a reconstruir la tabla
y el pipeline es aditivo, así que queda como herencia, la rellena el repositorio
con el redondeo y no la lee nadie.

## 3. Un pendiente y su reseña ya no coexisten

El listado público filtra por el vínculo (`review_id`) y no por el estado, y el
emparejado es automático por título normalizado y tipo de contenido en los dos
sentidos: al crear o publicar una reseña, y al dar de alta un pendiente cuya obra
ya está reseñada. Antes eso sólo lo hacía el botón «convertir», así que escribir
la reseña a mano dejaba la misma obra anunciada como «por ver» y publicada a la
vez.

## 4. La nota se pone con estrellas

Diez estrellas con medio punto, en el editor del panel. Se pulsa sobre la
estrella —o sobre su mitad— y al pasar el ratón se previsualiza la nota que se va
a poner. Debajo sigue habiendo un `input[type=range]` de verdad, que es lo que
deja el control usable sin JavaScript, con el teclado y con el dedo; en cuanto
hay JavaScript el puntero pasa a hablar con las estrellas, porque el deslizador
reparte su anchura contando el ancho del pulgar y pulsar sobre la séptima dejaba
un 6,5. El relleno va por `data-half` y una regla de CSS por valor, nunca por
`style=`, que la CSP rechazaría.

Ficheros: `migrations/0005_nota_media.sql`, `src/types/domain.ts`,
`src/db/repos/{reviews,watchlist}.ts`,
`src/server/services/{reviews,watchlist}.ts`, `src/server/routes/admin.tsx`,
`src/server/lib/seo.ts`, el editor del panel, `src/client/admin.ts`,
`public/assets/styles.css` y `scripts/seed.sql`.

---

## Estado del despliegue

**Staging está al día con este árbol.** Las migraciones `0004_movil.sql` y
`0005_nota_media.sql` están aplicadas allí, y el APK de la aplicación (compilado
contra staging, con `applicationId` propio) está publicado en su bucket.

**Producción no.** Sigue con el código de `f169a49`: sin las dos migraciones, sin
la API del móvil y sin la página de descarga. Desplegarla exige aplicar las dos
migraciones antes que el código.

Sigue en pie lo de siempre: **producción está corriendo código que sólo existe en
el árbol de trabajo**, así que no hay ningún punto de git al que volver.

## Commit sugerido

1. Aplicación Android, su API y la distribución del APK.
2. Medio punto en las notas y exclusividad entre pendientes y reseñas.
3. La nota en estrellas en el editor del panel.
