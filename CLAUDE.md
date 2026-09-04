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
- **El widget de Turnstile puede no llegar nunca** —lo bloquea una extensión, la
  red falla— y entonces el formulario se envía sin token. Ese caso se cuenta:
  el hueco lleva dentro un aviso oculto que el cliente destapa a los 8 segundos
  (`data-turnstile-fallback`) y el servidor distingue los códigos de error en
  `turnstileMessageForCodes()`. No lo devuelvas a un único mensaje genérico: sin
  recuadro visible y sin explicación, no hay forma de entrar ni de saber por qué.
- **El interruptor de Turnstile del panel está detrás del propio login.** Si
  deja fuera a quien administra, la salida es `npm run turnstile:off -- --env
  production`, que escribe en `settings` y purga la caché de KV sin navegador.
  Siguen en pie el límite por IP, el global y el bloqueo de cuenta.
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
5. **Las notas van sobre 10 y con coma** (`formatScore`), siempre con un
   decimal: «8,0» y «7,5» ocupan lo mismo y una columna de notas no baila.
   Internamente son un entero en **medios puntos**, 0..20.
6. **Las portadas, en color; los fotogramas del cuerpo, en blanco y negro**
   (`filter: grayscale(1) contrast(1.08)` sólo en `.prose img`). Desvío
   deliberado del kit, pedido: el kit pone todas las imágenes en gris, pero la
   portada es identidad de la obra y se queda en color. Portadas 2:3,
   fotogramas 16:10. Si falta material, marcador gris.
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
- **La puntuación se almacena en medios puntos**: un entero 0..20 en
  `reviews.rating_half`, que son 0,0 a 10,0 de medio en medio. No la guardes
  como decimal: 7,5 no tiene representación exacta en binario y un entero se
  compara, se ordena y se indexa sin sorpresas. La conversión vive sólo en
  `scoreToHalf()` / `halfToScore()` y se pinta con `formatScore()`.
- **`reviews.rating` es columna heredada y no la lee nadie.** Sigue existiendo
  con su CHECK 0..10 y su NOT NULL porque cambiarlos obliga a reconstruir la
  tabla, que es destructivo. La rellena `conNotaHeredada()` en el repositorio
  —el único sitio por el que pasan todas las escrituras— con la nota redondeada.
  Retirarla se hará a mano y con copia de seguridad.
- **El campo del formulario se llama `ratingHalf` y lleva el entero**, no la
  nota con decimales: así no hay que decidir qué hacer cuando un teclado
  español escribe «7,5» con coma en vez de «7.5».
- **La nota se pone con estrellas, y debajo hay un `input[type=range]`**, no un
  puñado de botones ni veintiún radios. Es lo que hace que el control funcione
  sin JavaScript, se maneje con el teclado y tenga un objetivo táctil grande en
  el teléfono, donde diez estrellas partidas por la mitad dejarían zonas de
  pulsación de quince píxeles. Las estrellas son dos capas superpuestas y la de
  acento se recorta: el `overflow` es lo que dibuja la media estrella.
- **El relleno de las estrellas va por `data-half` y una regla de CSS por
  valor**, nunca por `style=`: la CSP no lleva `unsafe-inline`. Son veintiuna
  líneas porque `attr()` todavía no vale para longitudes.
- **Con JavaScript, el puntero habla con las estrellas y no con el
  deslizador** (`.rating--js` invierte los `pointer-events`). El deslizador
  reparte su anchura contando el ancho del pulgar, así que su mapeo y el de las
  estrellas no coinciden: pulsar sobre la séptima dejaba un 6,5. El deslizador
  se queda para el teclado y los lectores de pantalla.
- **Al señalar se previsualiza, no se fija** (`.rating--preview`). Sólo el ratón
  previsualiza: un dedo que arrastra fija directamente.
- **El cero se pone con un botón**, no pulsando en el borde: la mitad izquierda
  de la primera estrella vale 0,5 y con el ratón no habría forma de volver a
  «sin nota». Nace oculto y lo destapa la isla, con su fila reservada de
  antemano para no empujar el formulario al aparecer.
- **Un punto y coma dentro de un comentario SQL parte la sentencia** para el
  troceador de D1 remoto, aunque en local funcione. No los pongas.
- **Un `--` dentro de un comentario de bloque se come el `*/`.** El troceador de
  D1 remoto borra desde `--` hasta el final de la línea sin mirar si está dentro
  de un `/* … */`, así que el comentario se queda abierto y SQLite sigue
  comentando hasta el siguiente `*/`. En `0004_movil.sql` eso se llevó por
  delante las columnas `device_name` y `platform` de `device_tokens`, y el
  emparejamiento del móvil fallaba con un 500 en el `INSERT` **en los dos
  entornos remotos**. Ni los tests ni el entorno local lo ven: sólo pasa por el
  troceador lo que se aplica en remoto. Nada de `--` dentro de un comentario.
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

## Reglas de la biblioteca privada (`books.`)

Vive en el **mismo Worker** que el sitio público, repartida por host en
`src/server/index.tsx`. `books.<dominio>` entra en `booksApp` y todo lo demás en
`app`. Son dos aplicaciones Hono con cadenas de middleware separadas a
propósito: ninguna cabecera, ninguna caché y ninguna ruta de una alcanza a la
otra.

- **La sesión no se comparte con el panel.** La cookie lleva prefijo `__Host-`,
  que la ata al host exacto. Entrar en `/admin` no abre `books.` ni al revés, y
  eso es la propiedad que se busca, no un efecto colateral.
- **El login de la biblioteca no cierra la sesión del panel.** `attemptLogin()`
  acepta `revokeOtherSessions: false` justo para eso: comparten tabla de
  usuarios y se usan a la vez.
- **El guardián va antes que las rutas**, con lista de exenciones explícita
  (`PUBLIC_PATHS` y `/assets/`). Una ruta nueva nace protegida. No lo cambies
  por comprobaciones ruta a ruta.
- **La CSP del subdominio añade dos cosas y sólo ahí**: `'wasm-unsafe-eval'`
  —lo pide pdf.js para JBIG2, JPEG2000 y color, que es lo que lleva un libro
  escaneado— y `camera=(self)` en `Permissions-Policy`, para el escáner. Sigue
  sin `unsafe-inline` y sin `unsafe-eval`. El dominio principal no cambia.
- **`isSafeMediaKey()` sólo reconoce `reviews/covers/`. No lo amplíes.** Es lo
  que impide que la ruta pública `/media/*` sirva un PDF o un backup. Lo de la
  biblioteca vive en `books/pdf/`, `books/covers/` y `backups/library/`, y sale
  únicamente por rutas autenticadas del subdominio.
- **Los PDF se suben en streaming**, nunca con `parseBody()`: son hasta 50 MB y
  bufferizarlos revienta la memoria del Worker. El cuerpo va en crudo y el
  título viaja en la query. R2 exige longitud conocida, así que el flujo pasa
  por `FixedLengthStream` — sin él falla con «Provided readable stream must have
  a known length».
- **El tipo se comprueba por los primeros bytes** (`%PDF-`), en un
  `TransformStream` que aborta la subida en cuanto lo sabe. El `Content-Type`
  declarado no decide nada, igual que en las portadas.
- **La huella antiduplicado es el MD5 que calcula R2**, no un SHA-256 nuestro:
  hacerlo aquí obligaría a tener el fichero entero en memoria. No es un control
  de seguridad, sólo evita subir dos veces el mismo libro.
- **Los subrayados se guardan en coordenadas normalizadas 0..1** respecto a la
  página, nunca en píxeles: así caen en su sitio con cualquier zoom y en
  cualquier pantalla.
- **El id del documento va en el `WHERE` de toda operación sobre una
  anotación**, además del id de la anotación. Sin eso, conocer un identificador
  bastaría para borrar la anotación de otro documento.
- **Las portadas se guardan siempre, nunca se enlazan.** Da igual el origen —la
  primera página del PDF, un fichero subido o una dirección de otro sitio—:
  todas pasan por `validateImage()` y acaban en R2 bajo `books/covers/`. Guardar
  la URL de un tercero dejaría el catálogo a merced de que la cambie, la borre o
  registre a quien la mira.
- **La portada por omisión la pinta el navegador**, no el Worker: rasterizar un
  PDF en el servidor exigiría traerse una librería entera y gastar CPU de la
  petición. Se genera al subir el fichero, cuando ya está en el navegador, y el
  lector la rellena para los documentos antiguos que aún no la tienen.
- **Descargar una imagen de una URL es superficie de SSRF.** Las guardas están
  en `lib/remote-image.ts`: sólo http/https, puertos 80 y 443, sin direcciones
  privadas ni de metadatos, sin IPv6 literal, **sin seguir redirecciones** y con
  techo real de bytes leídos. No relajes ninguna sin sustituirla por otra cosa.
- **Los metadatos por ISBN los consulta el Worker**, no el navegador: la CSP
  mantiene `connect-src 'self'` y la IP de quien usa la aplicación no llega a
  Open Library. La portada también la descarga el servidor y la guarda en R2,
  con la misma validación que una imagen subida a mano.
- **pdf.js y ZXing se autoalojan** (`scripts/build-client.mjs` los copia a
  `public/assets/`). Son dependencias de *desarrollo*: las de runtime siguen
  siendo tres. El decodificador de códigos va en su propio bundle y sólo se
  carga donde no existe `BarcodeDetector`.
- **El catálogo se ordena en el Worker, no en SQL** (`lib/library-sort.ts`).
  SQLite compara códigos de carácter y pone «Álvarez» detrás de «Zapata»;
  además el apellido no es una columna, hay que derivarlo de `authors`. Lo que
  no tiene dato va siempre al final y todos los criterios desempatan por título.
  El criterio entra por una lista cerrada de Zod: elige un comparador ya
  escrito, nunca una columna ni SQL que venga de la URL.
- **La importación de MyLibrary la traduce el servidor**
  (`src/server/lib/mylibrary.ts`), no el script: ahí están las decisiones
  discutibles y ahí se pueden probar. El script (`scripts/import-mylibrary.py`,
  en Python porque `node:sqlite` no existe en Node 20) sólo extrae y envía.
- **Las portadas de esa importación son opcionales y llevan orden explícito**
  (`--portadas <orden>`). El `elementHashcode` del fichero no sirve para
  emparejar —es el `hashCode()` de identidad de la JVM que exportó, comprobado
  contra todos los campos y combinaciones— y el orden bueno no está
  documentado: la suposición del orden por ID falló contra la exportación real
  **aunque las cantidades cuadrasen**. Que coincidan es condición necesaria, no
  suficiente. Hay un `--diagnostico` que vuelca muestras de cada hipótesis para
  compararlas a ojo. No pongas las portadas por omisión ni añadas heurísticas
  que adivinen: una portada en el libro equivocado es peor que ninguna.
- **El backup diario cuelga del cron que ya había** (`0 4 * * *`). Vuelca los
  registros —no los ficheros— a `backups/library/<fecha>.json.gz` con
  `CompressionStream`, y conserva 30 días.

## Reglas de la lista de pendientes

- **Un pendiente y su reseña no coexisten.** En cuanto una obra tiene reseña,
  su entrada en la cola queda enlazada (`review_id`) y terminada, y **el
  listado público filtra por el vínculo, no por el estado**: un item convertido
  al que alguien devuelve a «pendiente» volvería a la portada conviviendo con
  su propia reseña.
- **El emparejado es automático en los dos sentidos** y por título normalizado
  + tipo de contenido (`enlazarPendienteDe`, `resenaDelMismoTitulo`): al crear
  o publicar una reseña, y al dar de alta un pendiente cuya obra ya está
  reseñada. Antes esto sólo pasaba con el botón «convertir», así que escribir
  la reseña a mano dejaba el duplicado.
- **Los títulos se comparan con `slugify()` en el Worker, no con `LOWER()` en
  SQL**: SQLite no toca los acentos, así que «Amélie» y «amelie» no le parecen
  lo mismo.
- **Dar de alta un pendiente ya reseñado no es un error**: se guarda enlazado y
  fuera de la cola. Quien lo escribe no tiene por qué acordarse de lo que
  reseñó hace dos años, y un «ya existe» obliga a ir a buscarlo.

## Reglas de la aplicación Android (`android/`)

Un lector de PDF para el teléfono, en el mismo repositorio. Funciona solo con
documentos del dispositivo y, si se empareja, sincroniza con la biblioteca
privada. El APK se descarga de `/aplicacion` del sitio público.

- **La aplicación no usa la sesión del navegador.** La cookie caduca a las 2 h
  de inactividad y el CSRF exige un `Origin` que un cliente nativo no manda.
  Su credencial es un token de dispositivo en `Authorization: Bearer`
  (`device_tokens`, migración `0004_movil.sql`), guardado **hasheado** con
  SHA-256, de 90 días renovables y revocable de uno en uno. No relajes el CSRF
  ni el prefijo `__Host-` para que entre el móvil: esa es exactamente la salida
  que se descartó.
- **El emparejamiento pasa por `attemptLogin()`** con `establishSession: false`.
  Así hereda el límite global, el hash señuelo, el bloqueo por intentos y la
  auditoría. No escribas un login paralelo para el móvil.
- **El guardián de `/api/movil` va antes que sus rutas**, con una única
  exención explícita (`POST /api/movil/sesion`). Se monta **antes** que
  `booksRoutes` en `src/server/index.tsx` para poder aplicar el suyo, y lo que
  no case cae igualmente en el guardián de la cookie, que responde 401.
- **Los conflictos los decide SQLite, no JavaScript.** `mergeProgress`,
  `mergeAnnotation` y `mergeBookmark` comparan dentro del `ON CONFLICT DO
  UPDATE` (`setWhere`). Leer antes y decidir después deja una ventana entre la
  lectura y la escritura.
- **Las marcas de tiempo del cliente se recortan al reloj del servidor**, con un
  minuto de margen. Un teléfono con la fecha adelantada ganaría todos los
  conflictos futuros.
- **Las anotaciones se borran en lógico** (`deleted_at`), y toda lectura filtra
  por `IS NULL`. Sin lápida, lo borrado en la web revive en la siguiente
  sincronización del teléfono.
- **La bajada de sincronización devuelve `documentIds` entero.** Las fichas de
  documento sí se borran de verdad, así que es la única forma de que el móvil
  se entere de una baja.
- **El teléfono sube y luego baja, en ese orden.** Al revés, lo del servidor
  pisaría cambios locales todavía sin enviar.
- **La cabecera de la estantería es una sola fila.** Con dos filas y la marca
  bajo el título se gastaban unos 130 dp antes del primer documento, y la lista
  —que es lo que se viene a ver— empezaba fuera de la pantalla. Sólo «Abrir PDF»
  se queda a la vista; «Sincronizar» vive en el menú porque se pulsa de tarde en
  tarde y además la sincronización automática ya la hace sola. La marca se mudó
  a la pantalla de estantería vacía, donde sobra sitio.
- **Una pantalla sin `Surface` pinta el texto en negro.** `LocalContentColor`
  vale negro fijo en Material 3 y **no** se deriva del esquema de color: lo
  cambia un `Surface`, no `MaterialTheme`. La estantería se libraba porque su
  `Scaffold` lleva uno dentro; los ajustes y el lector eran `Column` pelados y
  salían en negro sobre el fondo oscuro. Un `Modifier.background` arregla el
  fondo y no el texto: hace falta el `Surface`, con `color` y `contentColor`.
- **El ancho de las páginas se mide fuera del scroll horizontal.**
  `horizontalScroll` mide su contenido con anchura infinita y `Box` baja el
  mínimo a cero, así que un `fillMaxWidth()` por dentro se queda en cero: la
  lista no llegaba a componerse y el lector salía en blanco con cualquier PDF.
- **`PdfRenderer` no tiene capa de texto**, y eso es lo que decide la interfaz:
  no hay selección de palabras, ni búsqueda, ni `quote` en las anotaciones. Los
  subrayados se hacen arrastrando un recuadro y se guardan en las mismas
  coordenadas normalizadas 0..1 que el lector web. No prometas selección de
  texto sin cambiar de motor.
- **El zoom se ancla al punto medio entre los dedos**, nunca a una esquina.
  Ampliar es acercarse a algo, y ese algo es lo que hay entre los dedos: ese
  punto del documento se queda quieto debajo. `transformOrigin` sigue en la
  esquina —es lo que hace que la anchura escalada sea una multiplicación y el
  encuadre se pueda acotar con una cuenta—, así que la compensación se hace a
  mano en los dos ejes con el factor **ya recortado** por el techo y el suelo:
  con el factor pedido, seguir pellizcando en el tope movería el documento sin
  ampliarlo. El eje vertical lo lleva la lista, que mide en píxeles de
  rasterizado, de ahí la división por la escala.
- **El techo de rasterizado sale de la memoria concedida, no de una constante.**
  `Runtime.maxMemory()` va de 96 MB a 512 según el teléfono; un número fijo o se
  queda corto en el bueno o tira el malo. Se reserva como mucho un octavo del
  montón para una sola página. Por encima de unos tres aumentos la página se
  estira en vez de repintarse: se ve más blanda, y es el precio de llegar a ocho
  aumentos sin reventar el proceso.
- **El zoom que se ve y el zoom al que se pinta son dos cosas distintas.**
  `estado.zoom` sigue al dedo y lo aplica la GPU con `graphicsLayer`;
  `zoomRaster` es la escala de los mapas de bits y sólo se mueve cuando el gesto
  para, 180 ms después. Rasterizar en cada paso del pellizco era lo que daba el
  tirón. Al cambiar `zoomRaster` hay que **recolocar el scroll**: la lista mide
  en píxeles de rasterizado y el alto de cada página cambia con el ancho, así
  que sin recolocarlo la página salta al soltar los dedos.
- **El mapa de bits de una página se recuerda por página, nunca por ancho.** Con
  el ancho en la clave, cada cambio de zoom lo ponía a nulo y la página se
  quedaba en blanco hasta terminar de repintarse. El anterior tiene que seguir
  en pantalla, estirado, hasta que el nuevo esté listo.
- **Un único detector se ocupa de todos los gestos** (`gestosDeLectura`). Con un
  contenedor de scroll horizontal por fuera y una lista vertical por dentro,
  Compose ata cada gesto a una orientación y **no hay diagonal**: hay que
  repartir a mano las dos componentes del mismo arrastre. Con un dedo sólo actúa
  si hay zoom —sin él conviene dejar que la lista se desplace sola, con su
  inercia—; con dos, siempre, y consumiendo sólo cuando el pellizco ya ha movido
  algo, para que un segundo dedo apoyado no congele la lectura. Va por la pasada
  `Initial`, que baja de fuera adentro; en la principal la lista ya se habría
  quedado el gesto. Se desactiva en modo subrayado.
- **La biblioteca en papel también se gestiona desde el teléfono**, con las
  mismas reglas: el alta pasa por `LibraryService`, no por una segunda
  implementación, así que hereda el antiduplicado por ISBN (409, no 400: el
  móvil dice «ya lo tienes» en vez de «revisa los campos»), la descarga de la
  portada a R2 y la auditoría. **La consulta a Open Library la hace el Worker**,
  igual que en la web: la dirección de quien usa la aplicación no llega a un
  tercero. El orden del catálogo también es del Worker, por lista cerrada.
- **El catálogo no se guarda en local.** Se lee de la biblioteca cada vez. La
  estantería de PDF sí se guarda, porque se lee sin red; el catálogo se consulta
  delante de las baldas, se edita poco y son fichas de texto. Guardarlo sería
  otra sincronización que mantener a cambio de casi nada.
- **Los campos de texto opcionales se envían vacíos, nunca nulos.** «Opcional»
  en Zod significa que puede faltar, no que pueda valer `null`: un nulo
  explícito devuelve un 400 sin explicación. La cadena vacía sí la entiende. Los
  numéricos sí admiten nulo, que es como se dice «sin año».
- **El token se cifra con el Keystore de Android** (AES/GCM) y
  `allowBackup="false"`. La copia de seguridad de Google no puede llevarse una
  credencial de este teléfono a otro.
- **Ningún permiso de almacenamiento.** Los PDF se abren con
  `ACTION_OPEN_DOCUMENT` y permiso persistente sobre esa URI. Un `ACTION_VIEW`
  que llega de otra aplicación no admite permiso persistente: se importa como
  efímero y se dice por qué.
- **Kotlin admite comentarios de bloque anidados**: un `/*` dentro de un KDoc
  abre otro comentario que nunca se cierra y el fichero entero deja de
  compilar con «Unclosed comment» al final. No escribas rutas con comodín
  dentro de un comentario.
- **La compilación contra staging lleva `applicationId` propio** (sufijo
  `.staging`) y su nombre en el lanzador. Sin eso, instalar el APK de staging
  encima del de producción lo sustituye —misma firma— y hereda su base de
  datos: documentos de un entorno apuntando al otro.
- **El almacén de claves de firma no vive en el repositorio.** Se pasa por
  propiedades de Gradle (`-PtdlKeystore=…`). Sin ellas se compila igual, sin
  firmar.
- **`npm run apk:publish` lee la versión del `build.gradle.kts`**, no de un
  argumento, y sube el manifiesto **después** del binario. Un manifiesto que
  anuncia una versión y entrega otra no se nota hasta que alguien no recibe la
  actualización.

## Reglas de operación y despliegue

La cuenta de Cloudflare está en **plan Free**, y eso decide cosas del código:

- **Nada de `limits.cpu_ms` ni de funciones de pago en `wrangler.jsonc`.** Un
  `cpu_ms` puesto ahí dejó el Worker de producción devolviendo 1101 en toda
  petición que hiciera E/S —sólo respondía `/robots.txt`, el único handler sin
  ella—, y hoy la API lo rechaza al desplegar con el código 100328.
- **Las Transformaciones de imagen no están activas**, así que `IMAGE_RESIZING`
  va en `false` en staging y en producción. Con `true`, cada portada pide
  `/cdn-cgi/image/…` y recibe un 404. Si algún día se activan, se vuelve a
  `true` en los dos.
- **Bot Fight Mode bloquea en el borde a los clientes que se identifican como
  scripts.** Un `User-Agent` de `Python-urllib` recibe un 403 que **no llega al
  Worker**. Por eso `scripts/import-mylibrary.py` manda un agente propio. Para
  distinguir quién rechaza, mira `X-Request-Id`: sólo lo ponemos nosotros —
  `cf-ray` lo lleva todo lo que pasa por Cloudflare, respuestas nuestras
  incluidas.

Sobre los dominios:

- **Un Custom Domain no se puede crear si el nombre ya tiene un registro DNS
  propio.** El apex estuvo devolviendo 522 por eso: había un registro proxied
  del registrador apuntando a un origen muerto. Se borra primero el registro y
  luego se crea el dominio.
- **Recién publicado un subdominio, los resolutores domésticos siguen
  contestando «no existe» un rato.** Es caché negativa, no una caída: se
  compara `dig +short <host>` con `dig @1.1.1.1 +short <host>`. El script de
  importación trae `--ip` para saltárselo.
- **El de staging es `books-staging.` y no `books.staging.`**: el certificado
  universal de Cloudflare cubre un solo nivel de subdominio.

Y una trampa de la que ya se ha salido dos veces:

- **El interruptor de Turnstile del acceso vive detrás del propio acceso.** Si
  deja fuera a quien administra, la salida sin navegador es
  `npm run turnstile:off -- --env production`.

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

*Al 3 de septiembre de 2026.*

- Desplegado en **staging** y en **producción**:
  `https://triangulodelectores.site` y `https://staging.triangulodelectores.site`,
  con la biblioteca privada en `books.triangulodelectores.site` y
  `books-staging.triangulodelectores.site`.
- **Los dos entornos no llevan el mismo código.** Staging va por delante:
  tiene las cinco migraciones (`0004_movil` y `0005_nota_media` incluidas), la
  API de la aplicación Android, la descarga del APK, el medio punto en las notas
  y el control de estrellas. **Producción se quedó en `f169a49`**: tres
  migraciones y nada de eso. Desplegarla exige aplicar antes las dos migraciones
  que le faltan.
- **El sitio público está vacío**: 0 reseñas y 0 pendientes en producción. Lo
  que sí tiene contenido es la biblioteca privada, con el catálogo de 229 libros
  importado desde MyLibrary.
- **La aplicación Android existe y compila**, en `android/`. El APK firmado está
  publicado en el bucket de staging y se descarga de
  `staging.triangulodelectores.site/aplicacion`. **Nunca se ha ejecutado en un
  teléfono**: no hay dispositivo ni emulador en la máquina de desarrollo, así
  que está verificada de compilación y firma, no de uso.
- **El almacén de claves de firma vive fuera del repositorio**, en
  `~/.tdl/tdl-release.jks`, con su contraseña en `~/.tdl/firma.properties`.
  Perderlo significa no poder publicar más actualizaciones de la aplicación:
  cópialo a un sitio seguro. El APK de staging lleva `applicationId` propio
  (`…lector.staging`), así que convive con el de producción en el mismo teléfono.
- `www.triangulodelectores.site` **devuelve 522**: le queda un registro DNS
  apuntando a un origen muerto, el mismo caso que tuvo el apex. Sin resolver.
- `wrangler.jsonc` no tiene marcadores pendientes: dominios, D1, KV, R2 y claves
  públicas de Turnstile son reales en los dos entornos.
- Hay trabajo **sin commitear** —la aplicación Android y su API, el medio punto
  en las notas, la exclusividad entre pendientes y reseñas, y el control de
  estrellas—, y **producción está corriendo código que sólo existe en el árbol
  de trabajo**: no hay ningún punto de git al que volver.
  `CAMBIOS-PENDIENTES.md` lo detalla.
- Pendiente en el **panel de Cloudflare**, que ningún script puede hacer: borrar
  el registro DNS de `www` y sustituirlo por una redirección al apex; SSL/TLS en
  Full (Strict) y Always Use HTTPS; las reglas de WAF y Rate Limiting del
  README §12; y comprobar que el bucket R2 de producción **no** es público.
- El informe de auditoría con las mejoras aún no implementadas (páginas de
  categoría y género, canonical de las URLs filtradas, paginación de
  comentarios, buscador sobre FTS5, reseñas relacionadas) vive en un artefacto
  publicado, no en el repositorio. Las de prioridad alta siguen pendientes.
