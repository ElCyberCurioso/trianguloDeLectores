package site.triangulodelectores.lector.ui

import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.delay
import site.triangulodelectores.lector.data.local.Anotacion
import site.triangulodelectores.lector.data.local.ColorAnotacion
import site.triangulodelectores.lector.data.local.Rect
import site.triangulodelectores.lector.data.local.TipoAnotacion
import site.triangulodelectores.lector.pdf.CachePaginas
import site.triangulodelectores.lector.pdf.Coincidencia
import site.triangulodelectores.lector.pdf.DocumentoPdf
import site.triangulodelectores.lector.pdf.NotaIncrustada
import site.triangulodelectores.lector.pdf.Palabra
import site.triangulodelectores.lector.pdf.SeleccionTexto
import site.triangulodelectores.lector.pdf.seleccionarTexto
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.foundation.Image

/*
 * Las páginas del lector: la lista, el pintado de cada una y lo que se dibuja
 * encima.
 */

/**
 * Techo de rasterizado, en píxeles de ancho.
 *
 * Sin techo, ampliar hasta el tope pediría mapas de bits imposibles: a ocho
 * aumentos sobre una pantalla de 1080 son 8640 px de ancho, y una A4 a esa
 * escala pasa de cuatrocientos megas. Pasado el techo se sigue ampliando, pero
 * estirando lo ya pintado en vez de volver a pintarlo más grande: por encima de
 * unos tres aumentos la página se ve algo más blanda, y es el precio de no
 * reventar la memoria del proceso.
 *
 * El techo **no es una constante**: sale de la memoria que el sistema concede a
 * esta aplicación, que va de 96 MB en un teléfono modesto a 512 en uno grande.
 * Un número fijo o se queda corto en el bueno o tira el malo. Se reserva como
 * mucho un octavo del montón para una sola página, suponiéndola vez y media más
 * alta que ancha.
 */
internal val TECHO_ANCHO_RASTER: Int by lazy {
    val monton = Runtime.getRuntime().maxMemory()
    kotlin.math.sqrt(monton.toDouble() / (8.0 * 1.5 * 4.0))
        .toInt()
        .coerceIn(1200, 4096)
}


/**
 * Lo que espera una página recién llegada y sin nada que enseñar antes de
 * pedir su pintado. Más que un fotograma o dos —lo que dura en la lista una
 * página que pasa volando— y menos de lo que se percibe como espera.
 */
private const val ESPERA_ANTES_DE_PINTAR_MS = 60L

/**
 * Las páginas.
 *
 * Cada una reserva su hueco por proporción **antes** de pintarse: sin eso, la
 * lista da saltos según van llegando los mapas de bits y leer se vuelve un
 * ejercicio de puntería. Es el mismo criterio que en el sitio con el hueco del
 * widget de Turnstile.
 */
@Composable
internal fun PaginasDelDocumento(
    /**
     * Ancho al que se **dispone** la lista: el del hueco, siempre, pase lo que
     * pase con el zoom. Ampliar no es medir más ancho, es que lo ya medido lo
     * agrande la GPU.
     */
    anchoLista: Int,
    /** Alto sin ampliar, para que al aplicarle el zoom llene el hueco justo. */
    altoLista: Int,
    /** El zoom que aplica la GPU sobre lo dispuesto. */
    zoom: Float,
    /** Ancho al que se pintan los mapas de bits. Sólo decide la nitidez. */
    anchoRaster: Int,
    desplazamientoX: Float,
    pdf: DocumentoPdf,
    documentoId: String,
    cache: CachePaginas,
    estadoLista: androidx.compose.foundation.lazy.LazyListState,
    anotaciones: List<Anotacion>,
    notasIncrustadas: List<NotaIncrustada>,
    resultados: List<Coincidencia>,
    resultadoActual: Coincidencia?,
    papel: Papel,
    /** Trozos nítidos por índice de página, sólo cuando se estira. */
    mosaico: Map<Int, Trozo>,
    modoSubrayado: Boolean,
    colorActivo: ColorAnotacion,
    palabrasDe: suspend (Int) -> List<Palabra>,
    alSubrayar: (Int, Rect) -> Unit,
    alSubrayarTexto: (Int, List<Rect>, String) -> Unit,
    /** Índice de la página y punto tocado, en sus coordenadas sin ampliar. */
    alDobleToque: (Int, Offset) -> Unit,
    /** Un toque simple fuera del modo subrayado: índice y punto en 0..1 de la página. */
    alTocarPagina: (Int, Float, Float) -> Unit = { _, _, _ -> },
) {
    val densidad = LocalDensity.current
    if (anchoLista <= 1 || altoLista <= 0 || anchoRaster <= 1) return

    /*
     * Agrupadas una vez por cambio, no filtradas por página en cada
     * recomposición: con cientos de subrayados, cada fotograma del scroll
     * recorría la lista entera por cada página visible.
     */
    val anotacionesPorPagina = remember(anotaciones) { anotaciones.groupBy { it.pagina } }
    val notasPorPagina = remember(notasIncrustadas) { notasIncrustadas.groupBy { it.pagina } }
    val resultadosPorPagina = remember(resultados) { resultados.groupBy { it.pagina } }

    val anchoDp = with(densidad) { anchoLista.toDp() }
    val altoDp = with(densidad) { altoLista.toDp() }

    LazyColumn(
        state = estadoLista,
        modifier = Modifier
            /*
             * **La lista se dispone al ancho del hueco y nunca más.**
             *
             * Quien amplía es la GPU, con `scaleX`. Esto es lo que hace que la
             * cuenta del encuadre sea exacta por construcción: lo que se ve
             * ocupa `anchoLista * zoom` empezando en `desplazamientoX`, que es
             * literalmente el intervalo que acota `margenX()`. Cualquier otra
             * anchura mete un desfase entre lo que se dibuja y lo que el
             * encuadre cree que se dibuja, y entonces sobra documento por un
             * lado y falta por el otro.
             *
             * Y como el alto de cada página sale de este ancho, que no se
             * mueve, ampliar **no vuelve a medir nada**: no hay saltos de
             * página ni scroll que recolocar.
             */
            .width(anchoDp)
            .height(altoDp)
            /*
             * El zoom y el encuadre son una transformación de la GPU, no una
             * remedida: nada se vuelve a pintar por moverlos. El origen va en
             * la esquina superior izquierda para que la anchura ampliada salga
             * exactamente `anchoLista * zoom` y el encuadre se pueda acotar con
             * una cuenta y no a ojo.
             */
            .graphicsLayer {
                scaleX = zoom
                scaleY = zoom
                translationX = desplazamientoX
                transformOrigin = TransformOrigin(0f, 0f)
            },
        /*
         * Aire entre páginas: 8 dp. Con 2 el hueco se confundía con un filete
         * del propio documento —muchos libros llevan uno bajo la cabecera— y
         * no se sabía dónde acababa una página y empezaba otra. Lleva el fondo
         * de la aplicación, que no es el blanco del papel.
         */
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(pdf.paginas) { indice ->
            PaginaPdf(
                pdf = pdf,
                documentoId = documentoId,
                cache = cache,
                indice = indice,
                anchoPx = anchoRaster,
                anotaciones = anotacionesPorPagina[indice + 1].orEmpty(),
                notasIncrustadas = notasPorPagina[indice + 1].orEmpty(),
                resultados = resultadosPorPagina[indice + 1].orEmpty(),
                resultadoActual = resultadoActual?.takeIf { it.pagina == indice + 1 },
                papel = papel,
                trozo = mosaico[indice],
                modoSubrayado = modoSubrayado,
                colorActivo = colorActivo,
                palabrasDe = palabrasDe,
                alSubrayar = { rect -> alSubrayar(indice + 1, rect) },
                alSubrayarTexto = { rects, cita -> alSubrayarTexto(indice + 1, rects, cita) },
                alDobleToque = { punto -> alDobleToque(indice, punto) },
                alTocar = { x, y -> alTocarPagina(indice, x, y) },
            )
        }
    }
}

@Composable
private fun PaginaPdf(
    pdf: DocumentoPdf,
    documentoId: String,
    cache: CachePaginas,
    indice: Int,
    anchoPx: Int,
    anotaciones: List<Anotacion>,
    notasIncrustadas: List<NotaIncrustada>,
    resultados: List<Coincidencia>,
    resultadoActual: Coincidencia?,
    papel: Papel,
    /** El trozo nítido de esta página, si la página se está estirando. */
    trozo: Trozo?,
    modoSubrayado: Boolean,
    colorActivo: ColorAnotacion,
    palabrasDe: suspend (Int) -> List<Palabra>,
    alSubrayar: (Rect) -> Unit,
    alSubrayarTexto: (List<Rect>, String) -> Unit,
    alDobleToque: (Offset) -> Unit,
    alTocar: (Float, Float) -> Unit = { _, _ -> },
) {
    // El detector no se rehace al cambiar la lambda, sólo al cambiar sus
    // claves: sin esto seguiría llamando a la de la primera composición.
    val tocar by rememberUpdatedState(alTocar)
    // Si ya se midió, de entrada: así el hueco nace con su altura y no salta
    // al llegar la medida, que es lo que pasaba al volver a una página vista.
    var proporcion by remember(indice) { mutableStateOf(pdf.proporcionConocida(indice) ?: 1.414f) }
    /*
     * El mapa de bits se recuerda **por página, no por ancho**.
     *
     * Con el ancho en la clave, cada cambio de zoom lo ponía a nulo y la página
     * se quedaba en el blanco del fondo hasta que terminaba de pintarse la
     * nueva: ese era el parpadeo. Ahora el anterior sigue en pantalla —estirado
     * por la GPU, que para eso está la escala— y sólo se sustituye cuando la
     * versión nueva ya está lista.
     */
    var bitmap by remember(indice) { mutableStateOf<ImageBitmap?>(null) }

    /** El recuadro a mano. Sólo se usa donde no hay texto que seleccionar. */
    var arrastre by remember { mutableStateOf<Pair<Offset, Offset>?>(null) }

    /*
     * Las palabras de esta página, con su sitio.
     *
     * Se piden **al entrar en modo subrayado**, no al pintar la página: leer el
     * texto cuesta, y quien está leyendo y no marcando no tiene por qué pagarlo.
     * Lista vacía después de buscar significa que aquí no hay texto —un
     * escaneado sin OCR— y entonces se vuelve al recuadro a mano.
     */
    var palabras by remember(indice) { mutableStateOf<List<Palabra>>(emptyList()) }
    var textoBuscado by remember(indice) { mutableStateOf(false) }
    var seleccion by remember(indice) { mutableStateOf<SeleccionTexto?>(null) }

    LaunchedEffect(indice, modoSubrayado) {
        if (!modoSubrayado || textoBuscado) return@LaunchedEffect
        palabras = runCatching { palabrasDe(indice) }.getOrDefault(emptyList())
        textoBuscado = true
    }

    LaunchedEffect(indice) {
        if (pdf.proporcionConocida(indice) != null) return@LaunchedEffect
        proporcion = runCatching { pdf.proporcion(indice) }.getOrDefault(1.414f)
    }

    LaunchedEffect(indice, anchoPx) {
        // Lo que ya se enseña llega: al bajar el zoom no se repinta nada, la
        // GPU reduce lo que hay.
        if ((bitmap?.width ?: 0) >= anchoPx) return@LaunchedEffect

        val guardado = cache.obtener(documentoId, indice)
        if (guardado != null) {
            bitmap = guardado.asImageBitmap()
            if (guardado.width >= anchoPx) return@LaunchedEffect
            // Si no llega, se queda en pantalla estirado mientras se pinta
            // el bueno, en vez de dejar la página en blanco.
        }

        /*
         * Una página que no tiene nada que enseñar espera un poco antes de
         * ponerse en la cola.
         *
         * Al arrastrar la barra de posición o al lanzar el documento, las
         * páginas entran y salen de la lista en un fotograma o dos. Sin esta
         * espera cada una pedía su pintado, y como el renderer pinta de una en
         * una, la que de verdad se iba a quedar en pantalla esperaba detrás de
         * todas las que pasaron volando. La que se va antes de que acabe la
         * espera se cancela sin haber costado nada. Al leer no se nota: la
         * lista compone la página siguiente antes de que asome.
         */
        if (bitmap == null) delay(ESPERA_ANTES_DE_PINTAR_MS)

        val pintado = runCatching { pdf.pintar(indice, anchoPx) }.getOrNull()
        if (pintado != null) {
            cache.guardar(documentoId, indice, pintado)
            bitmap = pintado.asImageBitmap()
        }
    }

    Box(
        Modifier
            .fillMaxWidth()
            .aspectRatio(1f / proporcion)
            .background(fondoDe(papel))
            /*
             * Subrayar.
             *
             * Dos gestos con la misma forma y dos significados distintos según
             * lo que haya debajo. Con texto, el arrastre va **de una palabra a
             * otra** y se queda con todo lo que hay entre las dos en orden de
             * lectura, como al arrastrar sobre cualquier texto; sin texto, que
             * es lo que pasa en un escaneado, sigue dibujando el recuadro de
             * siempre. La decisión no es del usuario ni de un interruptor: la
             * toma la página, que es la que sabe si lleva letras.
             */
            .pointerInput(modoSubrayado, indice, palabras) {
                if (!modoSubrayado) return@pointerInput

                fun seleccionEntre(inicio: Offset, fin: Offset): SeleccionTexto? {
                    val ancho = size.width.toFloat()
                    val alto = size.height.toFloat()
                    if (ancho <= 0f || alto <= 0f) return null
                    return seleccionarTexto(
                        palabras,
                        inicio.x / ancho,
                        inicio.y / alto,
                        fin.x / ancho,
                        fin.y / alto,
                    )
                }

                detectDragGestures(
                    onDragStart = { inicio ->
                        arrastre = inicio to inicio
                        seleccion = seleccionEntre(inicio, inicio)
                    },
                    onDrag = { cambio, _ ->
                        cambio.consume()
                        val actualizado = arrastre?.copy(second = cambio.position) ?: return@detectDragGestures
                        arrastre = actualizado
                        seleccion = seleccionEntre(actualizado.first, actualizado.second)
                    },
                    onDragEnd = {
                        val marcado = seleccion
                        val recuadro = arrastre
                        if (marcado != null) {
                            alSubrayarTexto(marcado.rects, marcado.cita)
                        } else if (recuadro != null) {
                            val (inicio, fin) = recuadro
                            val ancho = size.width.toFloat()
                            val alto = size.height.toFloat()
                            if (ancho > 0 && alto > 0) {
                                // Coordenadas normalizadas 0..1 respecto a la
                                // página, no píxeles: así el subrayado cae en su
                                // sitio con cualquier zoom, en cualquier pantalla
                                // y también en el lector web.
                                val x = minOf(inicio.x, fin.x) / ancho
                                val y = minOf(inicio.y, fin.y) / alto
                                val w = kotlin.math.abs(fin.x - inicio.x) / ancho
                                val h = kotlin.math.abs(fin.y - inicio.y) / alto
                                alSubrayar(
                                    Rect(
                                        x.coerceIn(0f, 1f),
                                        y.coerceIn(0f, 1f),
                                        w.coerceIn(0f, 1f),
                                        h.coerceIn(0f, 1f),
                                    ),
                                )
                            }
                        }
                        arrastre = null
                        seleccion = null
                    },
                    onDragCancel = {
                        arrastre = null
                        seleccion = null
                    },
                )
            }
            .pointerInput(indice, modoSubrayado, palabras) {
                detectTapGestures(
                    onDoubleTap = { punto -> alDobleToque(punto) },
                    // Un toque marca **una palabra**. Es el gesto que falta
                    // cuando lo que se quiere subrayar es un nombre o una cifra:
                    // arrastrar sobre cinco letras con el dedo es puntería.
                    onTap = if (modoSubrayado && palabras.isNotEmpty()) {
                        { punto ->
                            val ancho = size.width.toFloat()
                            val alto = size.height.toFloat()
                            if (ancho > 0f && alto > 0f) {
                                seleccionarTexto(
                                    palabras,
                                    punto.x / ancho,
                                    punto.y / alto,
                                    punto.x / ancho,
                                    punto.y / alto,
                                )?.let { alSubrayarTexto(it.rects, it.cita) }
                            }
                        }
                    } else if (!modoSubrayado) {
                        // Fuera del modo subrayado, un toque es para seguir un
                        // enlace. Quien decide si lo había es el modelo.
                        { punto ->
                            val ancho = size.width.toFloat()
                            val alto = size.height.toFloat()
                            if (ancho > 0f && alto > 0f) tocar(punto.x / ancho, punto.y / alto)
                        }
                    } else {
                        null
                    },
                )
            },
    ) {
        /*
         * Mientras se pinta, el número de la página en gris, arriba a la
         * izquierda. Un rectángulo blanco a secas no dice si la página está
         * llegando o está en blanco de verdad; con el número se sabe por dónde
         * se va aunque el pintado tarde.
         */
        if (bitmap == null) {
            Text(
                "${indice + 1}",
                style = MaterialTheme.typography.labelMedium,
                color = Color(0xFF8B8785),
                modifier = Modifier.padding(12.dp),
            )
        }

        bitmap?.let {
            Image(
                bitmap = it,
                contentDescription = "Página ${indice + 1}",
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.FillBounds,
                colorFilter = filtroDe(papel),
            )
        }

        // Subrayados guardados y el que se está dibujando ahora mismo.
        Canvas(Modifier.fillMaxSize()) {
            /*
             * El trozo nítido, encima de la página estirada y debajo de todo lo
             * demás. Se coloca en coordenadas de la página, así que viaja con
             * ella al desplazarse y al cambiar el zoom: mientras no se pide uno
             * nuevo, se ve algo más blando, pero nunca descolocado. La escala
             * deshace la del pintado —un píxel del trozo es uno de pantalla al
             * zoom al que se pidió— y el origen sale de los píxeles enteros, no
             * de la región: así borde e imagen coinciden exactamente.
             */
            trozo?.let { t ->
                withTransform({
                    translate(t.region.izquierda / t.zoom, t.region.arriba / t.zoom)
                    scale(1f / t.zoom, 1f / t.zoom, pivot = Offset.Zero)
                }) {
                    drawImage(t.imagen, colorFilter = filtroDe(papel))
                }
            }

            anotaciones.filter { it.tipo == TipoAnotacion.HIGHLIGHT }.forEach { anotacion ->
                anotacion.rects.forEach { r ->
                    drawRect(
                        color = colorDe(anotacion.color).copy(alpha = 0.32f),
                        topLeft = Offset(r.x * size.width, r.y * size.height),
                        size = Size(r.w * size.width, r.h * size.height),
                    )
                }
            }

            anotaciones.filter { it.tipo == TipoAnotacion.NOTE }.forEach { anotacion ->
                // Una nota suelta no tiene zona: se marca con una pestaña en el
                // margen para saber que esa página lleva algo escrito.
                drawRect(
                    color = colorDe(anotacion.color),
                    topLeft = Offset(size.width - 10.dp.toPx(), 12.dp.toPx()),
                    size = Size(10.dp.toPx(), 28.dp.toPx()),
                )
            }

            /*
             * Las notas que trae el propio PDF, en trazo y sin relleno.
             *
             * No son nuestras y no se comportan como las nuestras: no se editan
             * ni se borran ni se sincronizan. Que se vean distintas es la forma
             * de no confundirlas con un subrayado propio -- el relleno es para
             * lo que uno ha marcado, el contorno para lo que venía puesto.
             */
            notasIncrustadas.forEach { nota ->
                val r = nota.rect ?: return@forEach
                drawRect(
                    color = Color(0xFF8A8A8A),
                    topLeft = Offset(r.x * size.width, r.y * size.height),
                    size = Size(r.w * size.width, r.h * size.height),
                    style = Stroke(width = 2f),
                )
            }

            /*
             * Los resultados de la búsqueda.
             *
             * En tinta y sin borde todos, y el que se está mirando en el rojo de
             * la marca y con borde: el rojo aquí significa «éste». Ni amarillo
             * ni ningún color de subrayado, porque lo encontrado no es algo que
             * uno haya marcado y no debe poder confundirse con ello.
             */
            resultados.forEach { resultado ->
                val esActual = resultado == resultadoActual
                resultado.rects.forEach { r ->
                    val arriba = Offset(r.x * size.width, r.y * size.height)
                    val medida = Size(r.w * size.width, r.h * size.height)
                    drawRect(
                        color = if (esActual) {
                            ROJO_RESULTADO.copy(alpha = 0.30f)
                        } else {
                            // Sobre el papel de noche la tinta no se vería.
                            (if (papel == Papel.NOCHE) Color.White else TINTA_RESULTADO).copy(alpha = 0.16f)
                        },
                        topLeft = arriba,
                        size = medida,
                    )
                    if (esActual) drawRect(color = ROJO_RESULTADO, topLeft = arriba, size = medida, style = Stroke(width = 3f))
                }
            }

            // Lo que se está marcando ahora mismo: los renglones si hay texto,
            // el recuadro si no lo hay.
            val enCurso = seleccion
            if (enCurso != null) {
                enCurso.rects.forEach { r ->
                    drawRect(
                        color = colorDe(colorActivo).copy(alpha = 0.35f),
                        topLeft = Offset(r.x * size.width, r.y * size.height),
                        size = Size(r.w * size.width, r.h * size.height),
                    )
                }
            } else {
                arrastre?.let { (inicio, fin) ->
                    drawRect(
                        color = colorDe(colorActivo).copy(alpha = 0.35f),
                        topLeft = Offset(minOf(inicio.x, fin.x), minOf(inicio.y, fin.y)),
                        size = Size(kotlin.math.abs(fin.x - inicio.x), kotlin.math.abs(fin.y - inicio.y)),
                    )
                    drawRect(
                        color = colorDe(colorActivo),
                        topLeft = Offset(minOf(inicio.x, fin.x), minOf(inicio.y, fin.y)),
                        size = Size(kotlin.math.abs(fin.x - inicio.x), kotlin.math.abs(fin.y - inicio.y)),
                        style = Stroke(width = 2f),
                    )
                }
            }
        }
    }
}

/*
 * Colores de los resultados, sobre el papel blanco de la página y no sobre el
 * fondo de la aplicación: por eso son fijos y no salen del esquema, que cambia
 * con el tema oscuro. Los de la marca: tinta y el rojo.
 */
private val TINTA_RESULTADO = Color(0xFF201E1D)

/**
 * Un trozo de página pintado a la resolución de la pantalla. [region] está en
 * píxeles del pintado a [zoom], que es el zoom al que se pidió.
 */
internal class Trozo(val region: RegionPx, val zoom: Float, val imagen: ImageBitmap)

/*
 * El papel, como filtro de color sobre la página ya pintada.
 *
 * Se filtra al dibujar y no al rasterizar: cambiar de papel no repinta ninguna
 * página ni invalida la caché, y la página que se está pintando llega ya con
 * el papel puesto. Lo que se dibuja encima —subrayados, resultados— no pasa
 * por el filtro: un subrayado amarillo tiene que seguir siendo amarillo.
 *
 * Sepia multiplica cada canal: el blanco queda en un crema y el negro sigue
 * siendo negro, así que el contraste del texto apenas cambia. Noche invierte y
 * comprime: el blanco baja a un gris casi negro y el negro sube a un gris
 * claro, no al blanco, que en una habitación a oscuras deslumbra igual que la
 * página que se quería quitar. Las fotos también se invierten; es el precio de
 * un modo noche que funciona con cualquier PDF, escaneado o no.
 *
 * El fondo de la página va a juego con lo que el filtro hace del blanco, para
 * que el hueco que se ve mientras una página llega no parpadee al llegar.
 */
private val MATRIZ_SEPIA = ColorMatrix(
    floatArrayOf(
        0.96f, 0f, 0f, 0f, 0f,
        0f, 0.92f, 0f, 0f, 0f,
        0f, 0f, 0.85f, 0f, 0f,
        0f, 0f, 0f, 1f, 0f,
    ),
)
private val MATRIZ_NOCHE = ColorMatrix(
    floatArrayOf(
        -0.75f, 0f, 0f, 0f, 220f,
        0f, -0.75f, 0f, 0f, 220f,
        0f, 0f, -0.75f, 0f, 220f,
        0f, 0f, 0f, 1f, 0f,
    ),
)
private val FILTRO_SEPIA = ColorFilter.colorMatrix(MATRIZ_SEPIA)
private val FILTRO_NOCHE = ColorFilter.colorMatrix(MATRIZ_NOCHE)

private fun filtroDe(papel: Papel): ColorFilter? = when (papel) {
    Papel.BLANCO -> null
    Papel.SEPIA -> FILTRO_SEPIA
    Papel.NOCHE -> FILTRO_NOCHE
}

/** Lo que el filtro hace del blanco: 255 × 0,96 / 0,92 / 0,85, y 220 − 0,75 × 255. */
private fun fondoDe(papel: Papel): Color = when (papel) {
    Papel.BLANCO -> Color.White
    Papel.SEPIA -> Color(0xFFF5EBD8)
    Papel.NOCHE -> Color(0xFF1D1D1D)
}
private val ROJO_RESULTADO = Color(0xFFEC3013)

/** Los cuatro colores del lector web, sin inventar ninguno más. */
fun colorDe(color: ColorAnotacion): Color = when (color) {
    ColorAnotacion.YELLOW -> Color(0xFFFFD400)
    ColorAnotacion.RED -> Color(0xFFEC3013)
    ColorAnotacion.GREEN -> Color(0xFF3FA34D)
    ColorAnotacion.BLUE -> Color(0xFF2D7DD2)
}
