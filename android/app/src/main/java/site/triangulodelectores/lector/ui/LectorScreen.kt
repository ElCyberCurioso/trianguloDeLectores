package site.triangulodelectores.lector.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import site.triangulodelectores.lector.data.local.Anotacion
import site.triangulodelectores.lector.data.local.ColorAnotacion
import site.triangulodelectores.lector.data.local.Rect
import site.triangulodelectores.lector.data.local.TipoAnotacion
import site.triangulodelectores.lector.pdf.CachePaginas
import site.triangulodelectores.lector.pdf.DocumentoPdf
import site.triangulodelectores.lector.pdf.NotaIncrustada
import site.triangulodelectores.lector.pdf.Palabra
import site.triangulodelectores.lector.pdf.SeleccionTexto
import site.triangulodelectores.lector.pdf.seleccionarTexto
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.foundation.Image

/**
 * El lector de PDF.
 *
 * Páginas en vertical, una detrás de otra, como en el lector web. El zoom es
 * por botones y por doble toque, **no por pellizco**, y es una decisión, no una
 * carencia: el pellizco compite con el gesto de arrastrar, que aquí es lo que
 * dibuja un subrayado, y una aplicación en la que a veces subrayas y a veces
 * haces zoom sin saber por qué es peor que una con un botón de más. Además, así
 * cada página se **repinta** al ampliar en vez de estirar el mapa de bits: el
 * texto se sigue leyendo a 300 %.
 */
@Composable
fun LectorScreen(
    modelo: LectorViewModel,
    cache: CachePaginas,
    alVolver: () -> Unit,
) {
    val estado by modelo.estado.collectAsState()
    val lista = rememberLazyListState()
    var panelAnotaciones by remember { mutableStateOf(false) }
    /** Hueco visible, en píxeles. Es la base del zoom y del encuadre. */
    var anchoViewport by remember { mutableStateOf(0) }
    var altoViewport by remember { mutableStateOf(0) }

    /*
     * Zoom visual y zoom rasterizado son cosas distintas, y separarlos es lo
     * que hace que el gesto vaya suelto.
     *
     * `estado.zoom` es lo que se ve y cambia con cada píxel del pellizco;
     * `zoomRaster` es la escala a la que están pintados los mapas de bits, y
     * sólo se mueve cuando el gesto para. Entre uno y otro hay un factor que
     * aplica la GPU con `graphicsLayer`, así que durante el pellizco no se
     * repinta ni una página: antes se rasterizaba todo lo visible en cada paso
     * de zoom, que es de donde salían el tirón y el parpadeo.
     */
    var zoomRaster by remember { mutableStateOf(1f) }

    /** Encuadre horizontal, en píxeles de pantalla. Negativo o cero. */
    var desplazamientoX by remember { mutableStateOf(0f) }

    /*
     * El zoom que ya se ha **pedido**, que no siempre es el que se ve.
     *
     * `estado.zoom` llega por `collectAsState` y no cambia hasta la siguiente
     * recomposición, pero dentro de un mismo evento del pellizco hay que acotar
     * el encuadre con el valor nuevo: con el viejo el margen se queda corto y el
     * punto que hay bajo los dedos se escapa mientras se amplía.
     */
    var zoomPedido by remember { mutableStateOf(estado.zoom) }
    LaunchedEffect(estado.zoom) { zoomPedido = estado.zoom }

    /**
     * Cuánto puede correrse el documento hacia la izquierda, en píxeles: lo que
     * sobresale por la derecha y nada más. Con el zoom al mínimo vale cero, y
     * entonces el único encuadre legal es el de la izquierda pegada al borde.
     */
    fun margenX(): Float = (anchoViewport * (zoomPedido - 1f)).coerceAtLeast(0f)

    /*
     * Reacotar el encuadre cuando cambia el zoom o el tamaño del hueco.
     *
     * El límite izquierdo depende del zoom y el derecho no, y ahí estaba la
     * asimetría: acotando sólo al arrastrar, reducir el zoom con el botón, con
     * el doble toque o girando el teléfono dejaba un desplazamiento que ya no
     * era legal. El documento se quedaba fuera de la vista por la izquierda y,
     * con el zoom otra vez a uno, ni siquiera se podía arrastrar para traerlo:
     * el gesto de un dedo sólo actúa si hay zoom. Hacia la derecha nunca pasó
     * porque ese tope es cero pase lo que pase.
     */
    LaunchedEffect(estado.zoom, anchoViewport) {
        desplazamientoX = desplazamientoX.coerceIn(-margenX(), 0f)
    }

    /*
     * Repintar cuando el zoom se queda quieto.
     *
     * El `delay` se cancela solo con cada cambio, así que durante el pellizco no
     * llega a dispararse: al soltar se rasteriza una vez, ya en su escala.
     *
     * Y hay que **recolocar el scroll**. La lista mide en píxeles de
     * rasterizado, y al cambiar el ancho cambia el alto de cada página en la
     * misma proporción: el desplazamiento que tenía guardado pasaría a caer en
     * otro sitio y la página daría un salto justo al soltar los dedos.
     *
     * **La recolocación va después de remedir, y ése era el fallo.**
     * `scrollToItem` fuerza una medida en el acto, y esa medida todavía usa las
     * alturas viejas: si el desplazamiento nuevo se sale de la página -- y se
     * sale en cuanto se amplía desde más abajo de `1/factor` de ella -- la
     * lista lo resuelve pasando a la página siguiente y guardando el resto.
     * Cuando acto seguido se compone con el ancho nuevo, ese resto se
     * reinterpreta en píxeles más grandes y el documento acaba una página
     * entera más abajo. Por eso el salto aparecía al pasar de 100 % y otra vez
     * al pasar de 200 %, y no por encima: ahí el techo de rasterizado ya no
     * deja crecer el ancho, no hay remedida y no había nada que recolocar.
     */
    LaunchedEffect(estado.zoom) {
        delay(180)
        if (anchoViewport <= 0 || zoomRaster == estado.zoom) return@LaunchedEffect

        val anterior = anchoRasterDe(anchoViewport, zoomRaster)
        val nuevo = anchoRasterDe(anchoViewport, estado.zoom)
        if (nuevo == anterior) {
            zoomRaster = estado.zoom
            return@LaunchedEffect
        }

        val indice = lista.firstVisibleItemIndex
        val destino = (lista.firstVisibleItemScrollOffset.toFloat() * nuevo / anterior).toInt()
        val altoAntes = lista.layoutInfo.visibleItemsInfo.firstOrNull { it.index == indice }?.size

        zoomRaster = estado.zoom

        // Esperar a que la lista esté medida con el ancho nuevo. El tope está
        // para no quedarse colgado si la página deja de estar visible por lo
        // que sea: más vale recolocar de más que no recolocar nunca.
        if (altoAntes != null) {
            withTimeoutOrNull(1_000) {
                snapshotFlow { lista.layoutInfo.visibleItemsInfo.firstOrNull { it.index == indice }?.size }
                    .first { it != null && it != altoAntes }
            }
        }

        lista.scrollToItem(indice, destino)
    }
    var notaEnCurso by remember { mutableStateOf(false) }

    val salir = {
        modelo.alSalir()
        alVolver()
    }
    BackHandler(onBack = salir)

    // Volver a donde se dejó. Sólo la primera vez que se conoce el progreso:
    // después, cualquier salto lo manda quien lee.
    LaunchedEffect(estado.progresoInicial, estado.paginas) {
        val progreso = estado.progresoInicial ?: return@LaunchedEffect
        if (estado.paginas == 0) return@LaunchedEffect
        lista.scrollToItem((progreso.pagina - 1).coerceIn(0, estado.paginas - 1))
    }

    // Página visible -> progreso. Se mira la lista, no cada gesto: es la propia
    // posición del scroll la que dice por dónde va la lectura.
    LaunchedEffect(lista, estado.paginas) {
        snapshotFlow {
            val info = lista.layoutInfo.visibleItemsInfo.firstOrNull()
            val alturaItem = info?.size ?: 1
            val desplazado = if (alturaItem > 0) (-(info?.offset ?: 0) * 1000L / alturaItem).toInt() else 0
            (lista.firstVisibleItemIndex + 1) to desplazado.coerceIn(0, 1000)
        }
            .distinctUntilChanged()
            .debounce(250)
            .collect { (pagina, scroll) -> modelo.posicion(pagina, scroll) }
    }

    /*
     * `Surface`, no un `Modifier.background`: además del fondo fija
     * `LocalContentColor`, que en Material 3 vale negro por omisión y no se
     * deriva del esquema. Sin él, la barra del lector salía en negro sobre el
     * fondo oscuro. Mismo caso que en los ajustes.
     */
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
        contentColor = MaterialTheme.colorScheme.onBackground,
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing),
        ) {
            BarraLector(
                titulo = estado.documento?.titulo ?: "",
                pagina = estado.paginaVisible,
                paginas = estado.paginas,
                marcada = estado.marcadores.any { it.pagina == estado.paginaVisible },
                modoSubrayado = estado.modoSubrayado,
                zoom = estado.zoom,
                alVolver = salir,
                alMarcar = { modelo.alternarMarcador(estado.paginaVisible) },
                alSubrayar = modelo::alternarModoSubrayado,
                alAnotar = { notaEnCurso = true },
                alZoom = modelo::cambiarZoom,
                alVerAnotaciones = { panelAnotaciones = true },
            )

            when {
                estado.cargando -> Aviso("Abriendo el documento…", Modifier.padding(16.dp))
                estado.error != null -> Aviso(estado.error!!, Modifier.padding(16.dp), acento = true)
                else -> {
                    if (estado.modoSubrayado) {
                        Aviso(
                            "Modo subrayado: arrastra sobre el texto, o tócalo para una palabra. " +
                                "En una página escaneada, que no lleva texto, se marca la zona.",
                            Modifier.padding(horizontal = 16.dp),
                            acento = true,
                        )
                    }

                    val pdf = modelo.pdf
                    if (pdf != null) {
                        /*
                         * Ancho al que se pinta, con techo.
                         *
                         * A 4x sin techo una página A4 son unos 4300 px de
                         * ancho y más de cien megas de mapa de bits, que es una
                         * forma seria de quedarse sin memoria. Pasado el techo
                         * se sigue ampliando, pero estirando lo ya pintado.
                         */
                        val anchoRaster = anchoRasterDe(anchoViewport, zoomRaster)

                        // Lo que le queda por hacer a la GPU: la diferencia
                        // entre lo que se ve y lo que está pintado. Vale 1
                        // cuando el zoom está quieto.
                        val escala = if (anchoViewport > 0) {
                            (anchoViewport * estado.zoom) / anchoRaster
                        } else {
                            1f
                        }

                        Box(
                            Modifier
                                .fillMaxSize()
                                .clipToBounds()
                                .background(MaterialTheme.colorScheme.background)
                                // El ancho se mide aquí, fuera de cualquier
                                // contenedor con scroll: dentro de uno, la
                                // anchura máxima es infinita y un
                                // `fillMaxWidth` se queda en cero.
                                .onSizeChanged {
                                    anchoViewport = it.width
                                    altoViewport = it.height
                                }
                                .gestosDeLectura(
                                    activo = !estado.modoSubrayado,
                                    zoom = { estado.zoom },
                                    alPellizcar = { factor, centroide ->
                                        /*
                                         * El zoom se ancla al punto medio entre
                                         * los dedos.
                                         *
                                         * Ampliar es acercarse a *algo*, y ese
                                         * algo es lo que hay entre los dedos:
                                         * ese punto del documento tiene que
                                         * quedarse quieto bajo ellos. Escalando
                                         * desde la esquina, como estaba, el
                                         * contenido se escapaba en diagonal y
                                         * había que recolocarlo a mano después
                                         * de cada pellizco.
                                         *
                                         * Se usa el factor **ya recortado** por
                                         * el techo y el suelo del zoom: con el
                                         * pedido, seguir pellizcando en el tope
                                         * movería el documento sin ampliarlo.
                                         */
                                        val anterior = zoomPedido
                                        val nuevo = (anterior * factor)
                                            .coerceIn(ZOOM_MINIMO, ZOOM_MAXIMO)
                                        val real = if (anterior > 0f) nuevo / anterior else 1f
                                        if (real != 1f) {
                                            zoomPedido = nuevo
                                            modelo.cambiarZoom(nuevo)

                                            // Horizontal: el punto bajo el
                                            // centroide no se mueve.
                                            desplazamientoX = (
                                                centroide.x - (centroide.x - desplazamientoX) * real
                                                ).coerceIn(-margenX(), 0f)

                                            // Vertical: lo mismo, pero el eje lo
                                            // lleva la lista, que mide en píxeles
                                            // de rasterizado: de ahí la escala.
                                            if (escala > 0f) {
                                                lista.dispatchRawDelta(
                                                    centroide.y * (1f - 1f / real) / escala,
                                                )
                                            }
                                        }
                                    },
                                    alArrastrar = { dx, dy ->
                                        desplazamientoX =
                                            (desplazamientoX + dx).coerceIn(-margenX(), 0f)
                                        // La lista se desplaza en sus propios
                                        // píxeles, que son los de rasterizado:
                                        // hay que deshacer la escala visual o
                                        // el dedo y el papel no van juntos.
                                        if (dy != 0f && escala > 0f) {
                                            lista.dispatchRawDelta(-dy / escala)
                                        }
                                    },
                                ),
                        ) {
                            PaginasDelDocumento(
                                anchoRaster = anchoRaster,
                                altoRaster = if (escala > 0f) (altoViewport / escala).toInt() else altoViewport,
                                escala = escala,
                                // Acotado también aquí: el efecto que recoloca
                                // el encuadre corre después de componer, y ese
                                // fotograma se vería descolocado.
                                desplazamientoX = desplazamientoX
                                    .coerceIn(-(anchoViewport * (estado.zoom - 1f)).coerceAtLeast(0f), 0f),
                                pdf = pdf,
                                documentoId = estado.documento?.id ?: "",
                                cache = cache,
                                estadoLista = lista,
                                anotaciones = estado.anotaciones,
                                notasIncrustadas = estado.notasIncrustadas,
                                modoSubrayado = estado.modoSubrayado,
                                colorActivo = estado.colorActivo,
                                palabrasDe = modelo::palabrasDe,
                                alSubrayar = modelo::subrayar,
                                alSubrayarTexto = modelo::subrayarTexto,
                                alDobleToque = {
                                    modelo.cambiarZoom(if (estado.zoom > 1.5f) 1f else 2f)
                                },
                            )
                        }
                    }
                }
            }
        }
    }

    if (panelAnotaciones) {
        // Las notas que trae el PDF se leen aquí y no al abrir el libro: hay que
        // recorrer las anotaciones de todas las páginas y eso no puede colgarse
        // de la apertura, que es cuando alguien está esperando para leer.
        LaunchedEffect(Unit) { modelo.leerNotasIncrustadas() }

        PanelAnotaciones(
            anotaciones = estado.anotaciones,
            marcadores = estado.marcadores.map { it.pagina },
            notasIncrustadas = estado.notasIncrustadas,
            leyendoNotasIncrustadas = estado.leyendoNotasIncrustadas,
            notasIncrustadasLeidas = estado.notasIncrustadasLeidas,
            notasIncrustadasIlegibles = estado.notasIncrustadasIlegibles,
            alCerrar = { panelAnotaciones = false },
            alIrA = { pagina ->
                panelAnotaciones = false
                modelo.posicion(pagina, 0)
            },
            alBorrar = modelo::borrarAnotacion,
        )
    }

    if (notaEnCurso) {
        DialogoNota(
            pagina = estado.paginaVisible,
            alGuardar = { texto ->
                modelo.anotar(estado.paginaVisible, texto)
                notaEnCurso = false
            },
            alCancelar = { notaEnCurso = false },
        )
    }
}

/**
 * Las páginas.
 *
 * Cada una reserva su hueco por proporción **antes** de pintarse: sin eso, la
 * lista da saltos según van llegando los mapas de bits y leer se vuelve un
 * ejercicio de puntería. Es el mismo criterio que en el sitio con el hueco del
 * widget de Turnstile.
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
private val TECHO_ANCHO_RASTER: Int by lazy {
    val monton = Runtime.getRuntime().maxMemory()
    kotlin.math.sqrt(monton.toDouble() / (8.0 * 1.5 * 4.0))
        .toInt()
        .coerceIn(1200, 4096)
}

/** Ancho al que conviene pintar para un zoom dado, con el techo aplicado. */
private fun anchoRasterDe(anchoViewport: Int, zoom: Float): Int =
    minOf((anchoViewport * zoom).toInt(), TECHO_ANCHO_RASTER).coerceAtLeast(1)

/**
 * Los gestos del lector: pellizco para el zoom y arrastre para el encuadre.
 *
 * Todo lo lleva **un solo detector**, y ese es justo el arreglo. Antes había un
 * contenedor con scroll horizontal por fuera y una lista vertical por dentro, y
 * cada uno atiende a un eje: Compose ata cada gesto a una orientación, así que
 * se podía ir en horizontal o en vertical pero nunca en diagonal. Repartiendo
 * aquí las dos componentes del mismo arrastre, la diagonal sale sola.
 *
 * Con **un dedo sólo actúa si hay zoom**. Sin zoom no hay nada que encuadrar y
 * conviene no tocar el gesto: así la lista se desplaza ella misma, con su
 * inercia y su rebote, que es como se lee un documento la mayor parte del
 * tiempo. Con **dos dedos** siempre, y consumiendo sólo cuando el pellizco ya
 * ha movido algo: un segundo dedo apoyado sin mover no congela la lectura.
 *
 * Va por la pasada `Initial`, que baja de fuera adentro. En la principal la
 * lista ya se habría quedado el gesto.
 */
private fun Modifier.gestosDeLectura(
    activo: Boolean,
    zoom: () -> Float,
    /** Factor del pellizco y punto medio entre los dedos, en píxeles del hueco. */
    alPellizcar: (Float, Offset) -> Unit,
    alArrastrar: (Float, Float) -> Unit,
): Modifier = if (!activo) this else pointerInput(Unit) {
    awaitEachGesture {
        awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        var pellizcando = false
        do {
            val evento = awaitPointerEvent(PointerEventPass.Initial)
            val dedos = evento.changes.count { it.pressed }
            val pan = evento.calculatePan()

            if (dedos >= 2) {
                val factor = evento.calculateZoom()
                if (factor != 1f) {
                    pellizcando = true
                    alPellizcar(factor, evento.calculateCentroid())
                }
                if (pellizcando) {
                    if (pan != Offset.Zero) alArrastrar(pan.x, pan.y)
                    evento.changes.forEach { if (it.pressed) it.consume() }
                }
            } else if (dedos == 1 && zoom() > 1.001f && pan != Offset.Zero) {
                alArrastrar(pan.x, pan.y)
                evento.changes.forEach { if (it.pressed) it.consume() }
            }
        } while (evento.changes.any { it.pressed })
    }
}

@Composable
private fun PaginasDelDocumento(
    /** Ancho al que se pintan las páginas, en píxeles. */
    anchoRaster: Int,
    /** Alto de la lista sin escalar, para que al escalarla llene el hueco. */
    altoRaster: Int,
    /** Lo que la GPU pone encima de lo ya pintado. Uno con el zoom quieto. */
    escala: Float,
    desplazamientoX: Float,
    pdf: DocumentoPdf,
    documentoId: String,
    cache: CachePaginas,
    estadoLista: androidx.compose.foundation.lazy.LazyListState,
    anotaciones: List<Anotacion>,
    notasIncrustadas: List<NotaIncrustada>,
    modoSubrayado: Boolean,
    colorActivo: ColorAnotacion,
    palabrasDe: suspend (Int) -> List<Palabra>,
    alSubrayar: (Int, Rect) -> Unit,
    alSubrayarTexto: (Int, List<Rect>, String) -> Unit,
    alDobleToque: () -> Unit,
) {
    val densidad = LocalDensity.current
    if (anchoRaster <= 1 || altoRaster <= 0) return

    val anchoDp = with(densidad) { anchoRaster.toDp() }
    val altoDp = with(densidad) { altoRaster.toDp() }

    LazyColumn(
        state = estadoLista,
        modifier = Modifier
            .width(anchoDp)
            .height(altoDp)
            /*
             * El zoom y el encuadre son una transformación de la GPU, no una
             * remedida: nada se vuelve a pintar por moverlos. El origen va en
             * la esquina superior izquierda para que la anchura escalada salga
             * exactamente `anchoRaster * escala` y el encuadre se pueda acotar
             * con una cuenta y no a ojo.
             */
            .graphicsLayer {
                scaleX = escala
                scaleY = escala
                translationX = desplazamientoX
                transformOrigin = TransformOrigin(0f, 0f)
            },
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        items(pdf.paginas) { indice ->
            PaginaPdf(
                pdf = pdf,
                documentoId = documentoId,
                cache = cache,
                indice = indice,
                anchoPx = anchoRaster,
                anotaciones = anotaciones.filter { it.pagina == indice + 1 },
                notasIncrustadas = notasIncrustadas.filter { it.pagina == indice + 1 },
                modoSubrayado = modoSubrayado,
                colorActivo = colorActivo,
                palabrasDe = palabrasDe,
                alSubrayar = { rect -> alSubrayar(indice + 1, rect) },
                alSubrayarTexto = { rects, cita -> alSubrayarTexto(indice + 1, rects, cita) },
                alDobleToque = alDobleToque,
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
    modoSubrayado: Boolean,
    colorActivo: ColorAnotacion,
    palabrasDe: suspend (Int) -> List<Palabra>,
    alSubrayar: (Rect) -> Unit,
    alSubrayarTexto: (List<Rect>, String) -> Unit,
    alDobleToque: () -> Unit,
) {
    var proporcion by remember(indice) { mutableStateOf(1.414f) }
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
        proporcion = runCatching { pdf.proporcion(indice) }.getOrDefault(1.414f)
    }

    LaunchedEffect(indice, anchoPx) {
        val guardado = cache.obtener(documentoId, indice, anchoPx)
        if (guardado != null) {
            bitmap = guardado.asImageBitmap()
            return@LaunchedEffect
        }
        val pintado = runCatching { pdf.pintar(indice, anchoPx) }.getOrNull()
        if (pintado != null) {
            cache.guardar(documentoId, indice, anchoPx, pintado)
            bitmap = pintado.asImageBitmap()
        }
    }

    Box(
        Modifier
            .fillMaxWidth()
            .aspectRatio(1f / proporcion)
            .background(Color.White)
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
                    onDoubleTap = { alDobleToque() },
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
                    } else {
                        null
                    },
                )
            },
    ) {
        bitmap?.let {
            Image(
                bitmap = it,
                contentDescription = "Página ${indice + 1}",
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.FillBounds,
            )
        }

        // Subrayados guardados y el que se está dibujando ahora mismo.
        Canvas(Modifier.fillMaxSize()) {
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

/** Los cuatro colores del lector web, sin inventar ninguno más. */
fun colorDe(color: ColorAnotacion): Color = when (color) {
    ColorAnotacion.YELLOW -> Color(0xFFFFD400)
    ColorAnotacion.RED -> Color(0xFFEC3013)
    ColorAnotacion.GREEN -> Color(0xFF3FA34D)
    ColorAnotacion.BLUE -> Color(0xFF2D7DD2)
}

@Composable
private fun DialogoNota(pagina: Int, alGuardar: (String) -> Unit, alCancelar: () -> Unit) {
    var texto by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = alCancelar,
        title = { Text("Nota en la página $pagina", style = MaterialTheme.typography.titleMedium) },
        text = {
            Box(
                Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .padding(12.dp),
            ) {
                BasicTextField(
                    value = texto,
                    onValueChange = { texto = it },
                    // 16 sp mínimo en lo que se escribe: por debajo, el teclado
                    // de iOS amplía la página y en Android se lee mal igual.
                    textStyle = TextStyle(
                        fontSize = MaterialTheme.typography.bodyLarge.fontSize,
                        color = MaterialTheme.colorScheme.onSurface,
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(120.dp),
                )
            }
        },
        confirmButton = { TextButton(onClick = { alGuardar(texto) }) { Text("Guardar") } },
        dismissButton = { TextButton(onClick = alCancelar) { Text("Cancelar") } },
    )
}
