package site.triangulodelectores.lector.ui

import androidx.compose.material3.Text
import site.triangulodelectores.lector.pdf.EnlaceInterno
import site.triangulodelectores.lector.pdf.EnlaceExterno
import site.triangulodelectores.lector.pdf.Enlace
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.material3.TextButton
import androidx.compose.material3.AlertDialog
import androidx.compose.ui.platform.LocalContext
import android.net.Uri
import android.content.Intent
import androidx.compose.ui.graphics.asImageBitmap
import kotlin.math.roundToInt
import kotlinx.coroutines.flow.collectLatest
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarDuration
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.rememberSplineBasedDecay
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import site.triangulodelectores.lector.data.local.Anotacion
import site.triangulodelectores.lector.pdf.CachePaginas
import site.triangulodelectores.lector.pdf.Coincidencia

/**
 * El lector de PDF.
 *
 * Páginas en vertical, una detrás de otra, como en el lector web. El zoom va
 * por pellizco, doble toque y botones, y los tres se anclan a un punto
 * (`ampliarEn`). El pellizco no choca con el subrayado porque el modo subrayado
 * desactiva el detector de gestos entero: ahí arrastrar sólo marca.
 */
// `debounce` sigue marcado como vista previa en kotlinx.coroutines y es lo que
// evita una escritura del progreso por fotograma.
@OptIn(kotlinx.coroutines.FlowPreview::class)
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
     * `estado.zoom` es lo que se ve: lo aplica la GPU sobre una lista que se
     * dispone siempre al ancho del hueco, y cambia con cada píxel del pellizco.
     * `zoomRaster` no cambia el tamaño de nada: sólo dice a cuántos píxeles se
     * pinta el mapa de bits de cada página, o sea lo nítida que se ve, y se
     * mueve cuando el gesto para. Antes se rasterizaba todo lo visible en cada
     * paso del pellizco, que es de donde salían el tirón y el parpadeo.
     */
    var zoomRaster by remember { mutableStateOf(1f) }

    /** Encuadre horizontal, en píxeles de pantalla. Negativo o cero. */
    var desplazamientoX by remember { mutableStateOf(0f) }

    /*
     * El mismo encuadre, en **fracción del documento**, para que sobreviva al
     * giro.
     *
     * Los píxeles no sirven de una orientación a otra: el documento ampliado
     * mide `anchoViewport * zoom` y las dos cosas cambian al girar, así que un
     * desplazamiento guardado en vertical cae en otro sitio en horizontal. Lo
     * que sí se conserva es qué parte del documento queda oculta por la
     * izquierda, que va de 0 a `(zoom - 1) / zoom` **independientemente del
     * ancho de la pantalla**: por eso al reponerla nunca hay que recortar nada.
     *
     * Va en `rememberSaveable` porque es lo único de aquí que el modelo no
     * sabe: el zoom vive en el modelo y sobrevive solo, pero el encuadre es de
     * la pantalla.
     */
    var fraccionEncuadre by rememberSaveable { mutableStateOf(0f) }
    var encuadreRepuesto by remember { mutableStateOf(false) }

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
    fun margenX(): Float = margenEncuadre(anchoViewport, zoomPedido)

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
        /*
         * Y aquí mismo se repone el encuadre después de girar, que es cuando
         * se conoce el ancho nuevo. Una sola vez por composición: a partir de
         * ahí manda el dedo, y volver a calcularlo pisaría lo que se arrastre.
         */
        if (anchoViewport > 0 && !encuadreRepuesto) {
            desplazamientoX = encuadreDeFraccion(fraccionEncuadre, anchoViewport, estado.zoom)
            encuadreRepuesto = true
        }
        desplazamientoX = desplazamientoX.coerceIn(-margenX(), 0f)
    }

    /*
     * Apuntar la fracción cada vez que el encuadre se mueve.
     *
     * No se puede derivar al guardar el estado: `rememberSaveable` guarda lo
     * que hay, no una cuenta. Y no se apunta hasta haber repuesto, o el cero
     * con el que nace la composición nueva borraría lo que se venía de
     * guardar antes de que el hueco llegue a medirse.
     */
    LaunchedEffect(Unit) {
        snapshotFlow { Triple(desplazamientoX, anchoViewport, estado.zoom) }
            .collect { (x, ancho, zoom) ->
                if (!encuadreRepuesto) return@collect
                fraccionDeEncuadre(x, ancho, zoom)?.let { fraccionEncuadre = it }
            }
    }

    /*
     * Repintar cuando el zoom se queda quieto.
     *
     * El `delay` se cancela solo con cada cambio, así que durante el pellizco no
     * llega a dispararse: al soltar se rasteriza una vez, ya en su escala.
     *
     * **Y no hay nada más que hacer aquí.** La lista se mide siempre al ancho
     * del hueco, así que `zoomRaster` no cambia el alto de ninguna página: sólo
     * cambia la resolución del mapa de bits que se mete en el mismo sitio. Sin
     * remedida no hay scroll que recolocar, que es de donde salían los dos
     * intentos anteriores de arreglar el salto.
     */
    LaunchedEffect(estado.zoom) {
        delay(180)
        if (anchoViewport > 0) zoomRaster = estado.zoom
    }
    /*
     * La barra se quita de en medio al bajar y vuelve al subir.
     *
     * En horizontal se come un tercio de la pantalla y deja el documento en una
     * rendija. En vertical estorba menos, pero el criterio es el mismo: tenerlo
     * distinto según cómo se sujete el teléfono sería una cosa más que explicar,
     * y al leer se baja mucho más de lo que se toca un control.
     *
     * Se mira **el sitio de la lista**, no un `nestedScroll`: con zoom, el
     * desplazamiento vertical lo mete el detector de gestos con
     * `dispatchRawDelta`, que no pasa por la cadena de scroll anidado y ahí no
     * se vería nada. El par (página, desplazamiento dentro de ella) sí crece y
     * decrece siempre, y con eso se sabe hacia dónde se va sin necesidad de
     * saber cuánto mide cada página.
     */
    var barraVisible by remember { mutableStateOf(true) }
    val umbralPantalla = with(LocalDensity.current) { 32.dp.toPx() }
    LaunchedEffect(lista) {
        var previo = lista.firstVisibleItemIndex to lista.firstVisibleItemScrollOffset
        var recorrido = 0f
        snapshotFlow { lista.firstVisibleItemIndex to lista.firstVisibleItemScrollOffset }
            .collect { actual ->
                /*
                 * El umbral es de pantalla, no de la lista.
                 *
                 * La lista mide sin ampliar, así que un umbral fijo en sus
                 * píxeles obligaría a arrastrar ocho veces más al octavo
                 * aumento para lo mismo. Dividiendo por el zoom, el dedo
                 * recorre siempre lo mismo.
                 */
                val umbral = (umbralPantalla / zoomPedido.coerceAtLeast(0.01f)).coerceAtLeast(1f)
                val avance = when {
                    actual.first > previo.first -> umbral
                    actual.first < previo.first -> -umbral
                    else -> (actual.second - previo.second).toFloat()
                }
                previo = actual

                // Al cambiar de sentido se empieza a contar de nuevo: si no, un
                // arrastre largo hacia abajo dejaría crédito acumulado y la
                // barra tardaría en volver aunque se subiera del tirón.
                recorrido = if (recorrido > 0f && avance < 0f || recorrido < 0f && avance > 0f) {
                    avance
                } else {
                    recorrido + avance
                }

                if (recorrido >= umbral) barraVisible = false
                if (recorrido <= -umbral) barraVisible = true

                // Arriba del todo la barra está siempre. Es donde se llega al
                // abrir el libro, y sin esto podría abrirse sin barra y sin
                // manera evidente de volver.
                if (actual.first == 0 && actual.second == 0) barraVisible = true
            }
    }

    /*
     * Con el modo subrayado puesto, la barra no se esconde: el interruptor para
     * salir de él está ahí dentro, y esconderlo deja atrapado a quien lo haya
     * encendido sin querer.
     */
    val mostrarBarra = barraVisible || estado.modoSubrayado ||
        estado.busqueda != null || estado.cargando || estado.error != null

    /*
     * El lanzamiento cuando hay zoom.
     *
     * Sin zoom lo hace la lista sola y con sus curvas; con zoom el gesto se lo
     * queda el detector y hay que devolvérselo aquí. Se usa el mismo
     * decaimiento que Compose da a cualquier lista, así que el documento frena
     * como frena todo lo demás del teléfono y no como algo escrito aparte.
     */
    val decaimiento = rememberSplineBasedDecay<Float>()
    val ambito = rememberCoroutineScope()
    var lanzamiento by remember { mutableStateOf<Job?>(null) }

    var notaEnCurso by remember { mutableStateOf(false) }
    var notaEditada by remember { mutableStateOf<Anotacion?>(null) }
    var irAPagina by remember { mutableStateOf(false) }
    var verResultados by remember { mutableStateOf(false) }
    var verMiniaturas by remember { mutableStateOf(false) }

    /*
     * «Deshacer» después de subrayar.
     *
     * Un toque en falso en modo subrayado deja una marca, y antes la única
     * forma de quitarla era ir al panel, encontrarla y borrarla. El aviso dura
     * lo de cualquier aviso corto de Android; si desaparece, ya no se deshace:
     * deshacer es de lo que se acaba de hacer.
     */
    val avisos = remember { SnackbarHostState() }
    LaunchedEffect(estado.ultimoSubrayado) {
        if (estado.ultimoSubrayado == null) return@LaunchedEffect
        val respuesta = avisos.showSnackbar(
            message = "Subrayado",
            actionLabel = "Deshacer",
            duration = SnackbarDuration.Short,
        )
        if (respuesta == SnackbarResult.ActionPerformed) modelo.deshacerSubrayado() else modelo.olvidarDeshacer()
    }

    /*
     * La pantalla no se apaga mientras se lee.
     *
     * Leer es mirar sin tocar durante minutos, y el apagado del sistema está
     * pensado para lo contrario. Va en la vista y no en la ventana: así se
     * quita sola al salir del lector, sin tener que acordarse de devolver la
     * bandera de la actividad.
     */
    val vista = LocalView.current
    val contexto = LocalContext.current
    DisposableEffect(vista) {
        vista.keepScreenOn = true
        onDispose { vista.keepScreenOn = false }
    }

    /**
     * Cambia el zoom dejando quieto el punto [centro] del hueco.
     *
     * Ampliar es acercarse a *algo*: entre los dedos en el pellizco, bajo el
     * dedo en el doble toque, el centro de la pantalla con los botones. Antes
     * sólo el pellizco se anclaba; el doble toque y los botones ampliaban desde
     * la esquina superior izquierda y el sitio que se estaba leyendo se iba
     * fuera de la vista.
     *
     * Se usa el factor **ya recortado** por el techo y el suelo del zoom: con el
     * pedido, seguir pellizcando en el tope movería el documento sin ampliarlo.
     */
    fun ampliarEn(pedido: Float, centro: Offset) {
        val anclado = anclarZoom(zoomPedido, pedido, centro.x, centro.y, desplazamientoX, anchoViewport)
            ?: return
        zoomPedido = anclado.zoom
        modelo.cambiarZoom(anclado.zoom)
        desplazamientoX = anclado.desplazamientoX
        if (anclado.deltaLista != 0f) lista.dispatchRawDelta(anclado.deltaLista)
    }

    /*
     * El zoom de los botones y del doble toque, **animado**.
     *
     * Saltar de golpe de uno a dos aumentos hacía perder de vista lo que se
     * estaba leyendo: el documento aparecía en otro sitio sin que se viera
     * cómo había llegado. Cada fotograma pasa por `ampliarEn` con el mismo
     * centro, y como cada paso deja quieto ese punto, el conjunto también.
     *
     * El pellizco no se anima, va con el dedo. Y cualquier toque o pellizco
     * para la animación en seco, como para la inercia.
     */
    var animacionZoom by remember { mutableStateOf<Job?>(null) }
    fun animarZoomA(objetivo: Float, centro: Offset) {
        animacionZoom?.cancel()
        lanzamiento?.cancel()
        val desde = zoomPedido
        val hasta = objetivo.coerceIn(ZOOM_MINIMO, ZOOM_MAXIMO)
        if (desde == hasta) return
        animacionZoom = ambito.launch {
            animate(desde, hasta, animationSpec = tween(DURACION_ZOOM_MS, easing = FastOutSlowInEasing)) { valor, _ ->
                ampliarEn(valor, centro)
            }
        }
    }

    /**
     * Lleva la lista a una página y se lo dice al modelo.
     *
     * Las dos cosas: el modelo apunta por dónde va la lectura, pero no la lleva
     * a ningún sitio. Con sólo el aviso, la barra decía la página nueva y el
     * documento seguía donde estaba, que es lo que pasaba al tocar una nota en
     * el panel.
     */
    /*
     * Las páginas con algún resultado, sin repetir, para las marcas de la barra
     * de posición. Con quinientos resultados en treinta páginas son treinta
     * rayas, no quinientas una encima de otra.
     */
    val paginasConResultados = remember(estado.busqueda?.resultados) {
        estado.busqueda?.resultados?.map { it.pagina }?.distinct().orEmpty()
    }

    /**
     * Lleva a un resultado de la búsqueda **dejándolo a la vista**, no sólo en
     * su página.
     *
     * Ir a la página bastaba para las notas, que señalan la página entera; un
     * resultado es una palabra, y al zoom de leer una página no cabe en la
     * pantalla: con el borde de arriba a la vista, lo encontrado podía quedar
     * dos pantallas más abajo. Se coloca a un tercio del alto, que es donde se
     * mira al leer, y con zoom también se encuadra en horizontal.
     *
     * La página casi nunca está compuesta todavía, así que su alto se saca de
     * la proporción, que ya está medida para todas.
     */
    fun mostrarResultado(resultado: Coincidencia) {
        if (estado.paginas <= 0 || anchoViewport <= 0) return
        lanzamiento?.cancel()
        val indice = (resultado.pagina - 1).coerceIn(0, estado.paginas - 1)
        val primero = resultado.rects.firstOrNull()

        val proporcionPagina = modelo.pdf?.proporcionConocida(indice) ?: 1.414f
        val altoPagina = anchoViewport * proporcionPagina
        val altoVisible = altoViewport / zoomPedido.coerceAtLeast(0.01f)
        val dentro = primero?.let { (it.y * altoPagina - altoVisible / 3f).coerceAtLeast(0f) } ?: 0f

        if (primero != null) {
            val izquierda = primero.x * anchoViewport * zoomPedido
            desplazamientoX = (anchoViewport / 3f - izquierda).coerceIn(-margenX(), 0f)
        }
        ambito.launch { lista.scrollToItem(indice, dentro.toInt()) }
    }

    fun irA(pagina: Int) {
        if (estado.paginas <= 0) return
        val destino = pagina.coerceIn(1, estado.paginas)
        lanzamiento?.cancel()
        ambito.launch { lista.scrollToItem(destino - 1) }
        modelo.posicion(destino, 0)
    }

    /**
     * A una página y a una altura dentro de ella, de 0 a 1.
     *
     * La página de destino casi nunca está compuesta, así que su alto sale de
     * la proporción ya medida, igual que al ir a un resultado de búsqueda.
     * [margen] deja un poco de lo de arriba a la vista: un destino de nota al
     * pie apunta al renglón de la nota, y pegado al borde no se ve que es ése.
     */
    fun irAAltura(pagina: Int, altura: Float, margen: Float = 0f) {
        if (estado.paginas <= 0 || anchoViewport <= 0) return
        val indice = (pagina - 1).coerceIn(0, estado.paginas - 1)
        val altoPagina = anchoViewport * (modelo.pdf?.proporcionConocida(indice) ?: 1.414f)
        val altoVisible = altoViewport / zoomPedido.coerceAtLeast(0.01f)
        val dentro = (altura.coerceIn(0f, 1f) * altoPagina - altoVisible * margen).coerceAtLeast(0f)
        lanzamiento?.cancel()
        ambito.launch { lista.scrollToItem(indice, dentro.roundToInt()) }
    }

    /*
     * Seguir un enlace.
     *
     * Antes de irse se apunta de dónde se venía, y aparece el botón de vuelta:
     * una nota al pie se lee y se vuelve, y quien llega a la página 240 desde
     * la 12 no tiene por qué acordarse de que venía de la 12. Los externos se
     * confirman con la dirección a la vista: un PDF es un fichero de fuera y
     * el texto de un enlace no tiene por qué decir a dónde lleva.
     */
    var enlaceExterno by remember { mutableStateOf<String?>(null) }
    fun seguirEnlace(enlace: Enlace) {
        when (enlace) {
            is EnlaceInterno -> {
                modelo.recordarRegreso()
                irAAltura(enlace.pagina, enlace.altura ?: 0f, margen = if (enlace.altura != null) 0.1f else 0f)
            }
            is EnlaceExterno -> enlaceExterno = enlace.url
        }
    }

    fun volver() {
        val (pagina, milesimas) = estado.volverA ?: return
        modelo.olvidarRegreso()
        irAAltura(pagina, milesimas / 1000f)
    }

    /*
     * A dónde pide ir la barra de posición, en fracción del documento.
     *
     * Es un estado y no una corrutina por evento: el dedo manda decenas de
     * posiciones por segundo y cada salto tiene que esperar a que la lista se
     * mida. `snapshotFlow` se queda sólo con la última pedida mientras el salto
     * anterior termina, así que la lista nunca va detrás de una cola de sitios
     * por los que el dedo ya pasó.
     */
    /*
     * Los mosaicos: el trozo visible de cada página, nítido, cuando la página
     * se estira.
     *
     * Pasado el techo de rasterizado la página entera ya no se repinta más
     * grande, se estira, y a ocho aumentos se leía blanda. Lo que se ve, en
     * cambio, nunca pasa del tamaño de la pantalla: eso es lo que se pinta.
     *
     * Se pide cuando el zoom, el encuadre y la lista se quedan quietos, no a
     * cada fotograma: pintar mientras se mueve es lo que daba el tirón al
     * principio. `collectLatest` deja a medias lo que el siguiente movimiento
     * ya ha dejado viejo. Por debajo del techo no hay mosaico, que la página
     * entera ya es nítida.
     */
    var mosaico by remember { mutableStateOf<Map<Int, Trozo>>(emptyMap()) }
    LaunchedEffect(estado.paginas) {
        val pdf = modelo.pdf ?: return@LaunchedEffect
        snapshotFlow {
            listOf(
                estado.zoom, desplazamientoX, anchoViewport.toFloat(), altoViewport.toFloat(),
                lista.firstVisibleItemIndex.toFloat(), lista.firstVisibleItemScrollOffset.toFloat(),
            )
        }
            .distinctUntilChanged()
            .debounce(ESPERA_MOSAICO_MS)
            .collectLatest {
                val zoom = estado.zoom
                if (!seEstira(anchoViewport, zoom, TECHO_ANCHO_RASTER)) {
                    mosaico = emptyMap()
                    return@collectLatest
                }
                val info = lista.layoutInfo
                val altoVisible = info.viewportEndOffset - info.viewportStartOffset
                val anchoTotal = (anchoViewport * zoom).roundToInt()
                val visibles = info.visibleItemsInfo
                // Lo que ya no se ve se suelta en el acto: son mapas de bits
                // del tamaño de la pantalla.
                var nuevo = mosaico.filterKeys { k -> visibles.any { it.index == k } }
                mosaico = nuevo
                for (item in visibles) {
                    val region = regionVisible(item.offset, item.size, anchoViewport, altoVisible, desplazamientoX, zoom)
                        ?: continue
                    val px = regionEnPixeles(region, zoom)
                    val pintado = runCatching {
                        pdf.pintarTrozo(item.index, anchoTotal, px.izquierda, px.arriba, px.ancho, px.alto)
                    }.getOrNull() ?: continue
                    nuevo = nuevo + (item.index to Trozo(px, zoom, pintado.asImageBitmap()))
                    mosaico = nuevo
                }
            }
    }

    /*
     * La página siguiente, pintada antes de que asome.
     *
     * Al leer se baja, así que es la que viene. Se pide cuando la lista lleva
     * un rato quieta —no mientras se desplaza, que ahí lo que cuenta es lo que
     * se ve— y sólo si la caché no la tiene ya a ese ancho. Cuando entra en la
     * lista, la página encuentra su mapa de bits en la caché y no hay blanco.
     */
    LaunchedEffect(estado.paginas) {
        val pdf = modelo.pdf ?: return@LaunchedEffect
        val documentoId = estado.documento?.id ?: return@LaunchedEffect
        snapshotFlow {
            (lista.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1) to
                anchoRasterDe(anchoViewport, zoomRaster, TECHO_ANCHO_RASTER)
        }
            .distinctUntilChanged()
            .debounce(ESPERA_PRECARGA_MS)
            .collectLatest { (ultima, ancho) ->
                val siguiente = ultima + 1
                if (ultima < 0 || siguiente >= estado.paginas || anchoViewport <= 0) return@collectLatest
                if ((cache.obtener(documentoId, siguiente)?.width ?: 0) >= ancho) return@collectLatest
                runCatching { pdf.pintar(siguiente, ancho) }.getOrNull()
                    ?.let { cache.guardar(documentoId, siguiente, it) }
            }
    }

    var fraccionPedida by remember { mutableStateOf<Float?>(null) }
    LaunchedEffect(lista, estado.paginas) {
        snapshotFlow { fraccionPedida }.collect { fraccion ->
            if (fraccion != null) lista.irAFraccion(fraccion, estado.paginas)
        }
    }

    val salir = {
        modelo.alSalir()
        alVolver()
    }
    BackHandler(onBack = salir)
    // Declarado después, así que manda mientras se busca: «atrás» cierra la
    // búsqueda, no el libro. Salir del documento por querer quitar el teclado
    // sería lo último que se espera.
    // Después de seguir un enlace, «atrás» vuelve de donde se venía. Va antes
    // que el de la búsqueda: con las dos cosas abiertas, atrás cierra primero
    // la búsqueda, que es lo que está encima.
    BackHandler(enabled = estado.volverA != null) { volver() }
    BackHandler(enabled = estado.busqueda != null) { modelo.cerrarBusqueda() }

    /*
     * Volver a donde se estaba, **cada vez que la composición nace**.
     *
     * Girar el teléfono rehace la actividad entera: la composición se tira y se
     * construye de cero, con una lista nueva y vacía. El modelo, en cambio,
     * sobrevive —cuelga de la entrada de navegación—, así que es él quien sabe
     * por dónde iba la lectura. De ahí que el guardián sea un `remember` pelado
     * y no un `rememberSaveable`: tiene que volver a false al girar, que es
     * justo cuando hay que recolocarse.
     *
     * Y el destino es la posición **viva** del modelo, nunca `progresoInicial`.
     * Ése se lee una sola vez al abrir el documento y no se mueve en toda la
     * sesión: restaurar con él era lo que devolvía a la página donde se abrió
     * el libro cada vez que se giraba el teléfono.
     */
    var restaurado by remember { mutableStateOf(false) }
    LaunchedEffect(estado.paginas) {
        if (restaurado || estado.paginas == 0) return@LaunchedEffect

        val pagina = (estado.paginaVisible - 1).coerceIn(0, estado.paginas - 1)
        val milesimas = estado.scrollVisible.coerceIn(0, 1000)

        /*
         * Hay que esperar a que la lista esté medida.
         *
         * La posición se guarda en milésimas de página y no en píxeles, que es
         * lo que la hace sobrevivir al giro: el alto de una página sale del
         * ancho del hueco, y el de horizontal no es el de vertical. Pero para
         * convertirlas hace falta ese alto, y antes de la primera medida no
         * existe.
         */
        snapshotFlow { lista.layoutInfo.totalItemsCount }.first { it > 0 }

        // Al borde de la página primero, que es un sitio que no depende de
        // ninguna escala, y la fracción después con el alto ya medido.
        lista.scrollToItem(pagina, 0)
        val alto = lista.layoutInfo.visibleItemsInfo.firstOrNull { it.index == pagina }?.size ?: 0
        if (alto > 0 && milesimas > 0) lista.scrollBy(alto * milesimas / 1000f)

        restaurado = true
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
            AnimatedVisibility(visible = mostrarBarra) {
                val busqueda = estado.busqueda
                if (busqueda != null) {
                    BarraBusqueda(
                        busqueda = busqueda,
                        alBuscar = modelo::buscar,
                        alCerrar = modelo::cerrarBusqueda,
                        alAnterior = { modelo.anteriorResultado(estado.paginaVisible)?.let(::mostrarResultado) },
                        alSiguiente = { modelo.siguienteResultado(estado.paginaVisible)?.let(::mostrarResultado) },
                        alVerLista = { verResultados = true },
                    )
                } else BarraLector(
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
                    alZoom = { pedido ->
                        animarZoomA(pedido, Offset(anchoViewport / 2f, altoViewport / 2f))
                    },
                    unaFila = LocalConfiguration.current.screenWidthDp >= ANCHO_BARRA_EN_UNA_FILA_DP,
                    papel = estado.papel,
                    alElegirPapel = modelo::elegirPapel,
                    alVerAnotaciones = { panelAnotaciones = true },
                    alIrAPagina = { irAPagina = true },
                    alBuscar = modelo::empezarBusqueda,
                )
            }

            when {
                estado.cargando -> Aviso("Abriendo el documento…", Modifier.padding(16.dp))
                estado.error != null -> Aviso(estado.error!!, Modifier.padding(16.dp), acento = true)
                estado.protegido -> Aviso("Este documento está protegido con contraseña.", Modifier.padding(16.dp))
                else -> {
                    if (estado.modoSubrayado) {
                        AvisoSubrayado(color = estado.colorActivo, alElegirColor = modelo::elegirColor)
                    }

                    val pdf = modelo.pdf
                    if (pdf != null) {
                        /*
                         * Ancho al que se **pinta** el mapa de bits, con techo.
                         *
                         * Ojo: esto ya no mide nada. La lista se dispone
                         * siempre al ancho del hueco y quien amplía es la GPU;
                         * lo único que decide este número es la resolución a la
                         * que se rasteriza cada página, o sea lo nítida que se
                         * ve al ampliarla.
                         *
                         * A 4x sin techo una página A4 son unos 4300 px de
                         * ancho y más de cien megas de mapa de bits, que es una
                         * forma seria de quedarse sin memoria. Pasado el techo
                         * se sigue ampliando, pero estirando lo ya pintado.
                         */
                        val anchoRaster = anchoRasterDe(anchoViewport, zoomRaster, TECHO_ANCHO_RASTER)

                        /*
                         * El hueco del documento y, encima, la barra de
                         * posición.
                         *
                         * La barra va **fuera** de la caja de los gestos y no
                         * dentro: ese detector trabaja en la pasada `Initial`,
                         * que baja de fuera adentro, y con zoom se queda el
                         * arrastre de un dedo antes de que llegue a ningún
                         * hijo. Como hermana, lo que cae sobre el tirador es
                         * del tirador y lo demás sigue siendo del documento.
                         */
                        Box(Modifier.fillMaxSize()) {
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
                                            // Se usa el factor **ya recortado**
                                            // por el techo y el suelo: lo hace
                                            // `ampliarEn`, igual que para los
                                            // botones y el doble toque.
                                            animacionZoom?.cancel()
                                            ampliarEn(zoomPedido * factor, centroide)
                                        },
                                        alArrastrar = { dx, dy ->
                                            desplazamientoX =
                                                (desplazamientoX + dx).coerceIn(-margenX(), 0f)
                                            // La lista se desplaza en sus propios
                                            // píxeles, que son los del hueco sin
                                            // ampliar: hay que deshacer el zoom o
                                            // el dedo y el papel no van juntos.
                                            if (dy != 0f && estado.zoom > 0f) {
                                                lista.dispatchRawDelta(-dy / estado.zoom)
                                            }
                                        },
                                        // Tocar para en seco lo que siguiera
                                        // rodando, como en cualquier lista.
                                        alTocar = {
                                            lanzamiento?.cancel()
                                            lanzamiento = null
                                            animacionZoom?.cancel()
                                        },
                                        alSoltar = { velocidad ->
                                            lanzamiento?.cancel()
                                            lanzamiento = ambito.launch {
                                                lanzar(
                                                    velocidad = velocidad,
                                                    zoom = zoomPedido,
                                                    decaimiento = decaimiento,
                                                    lista = lista,
                                                    encuadre = { desplazamientoX },
                                                    alEncuadrar = { x ->
                                                        desplazamientoX =
                                                            x.coerceIn(-margenX(), 0f)
                                                    },
                                                )
                                            }
                                        },
                                    ),
                            ) {
                                PaginasDelDocumento(
                                    anchoLista = anchoViewport,
                                    altoLista = if (estado.zoom > 0f) {
                                        (altoViewport / estado.zoom).toInt()
                                    } else {
                                        altoViewport
                                    },
                                    zoom = estado.zoom,
                                    anchoRaster = anchoRaster,
                                    // Acotado también aquí: el efecto que recoloca
                                    // el encuadre corre después de componer, y ese
                                    // fotograma se vería descolocado.
                                    desplazamientoX = acotarEncuadre(desplazamientoX, anchoViewport, estado.zoom),
                                    pdf = pdf,
                                    documentoId = estado.documento?.id ?: "",
                                    cache = cache,
                                    estadoLista = lista,
                                    anotaciones = estado.anotaciones,
                                    notasIncrustadas = estado.notasIncrustadas,
                                    resultados = estado.busqueda?.resultados.orEmpty(),
                                    resultadoActual = estado.busqueda?.let { it.resultados.getOrNull(it.actual) },
                                    papel = estado.papel,
                                    mosaico = mosaico,
                                    modoSubrayado = estado.modoSubrayado,
                                    colorActivo = estado.colorActivo,
                                    palabrasDe = modelo::palabrasDe,
                                    alSubrayar = modelo::subrayar,
                                    alSubrayarTexto = modelo::subrayarTexto,
                                    alTocarPagina = { indice, x, y ->
                                        ambito.launch {
                                            modelo.buscarEnlace(indice + 1, x, y)?.let(::seguirEnlace)
                                        }
                                    },
                                    alDobleToque = { indice, punto ->
                                        /*
                                         * El punto llega en coordenadas de la
                                         * página y sin ampliar —la escala la
                                         * aplica la GPU por encima—. Al hueco
                                         * se pasa sumando dónde empieza la
                                         * página en la lista y deshaciendo
                                         * después escala y encuadre.
                                         */
                                        val inicio = lista.layoutInfo.visibleItemsInfo
                                            .firstOrNull { it.index == indice }?.offset ?: 0
                                        val centro = Offset(
                                            desplazamientoX + punto.x * zoomPedido,
                                            (inicio + punto.y) * zoomPedido,
                                        )
                                        animarZoomA(if (zoomPedido > 1.5f) 1f else 2f, centro)
                                    },
                                )
                            }

                            // En modo subrayado no hay barra: el borde derecho
                            // es donde acaban los renglones, y un tirador ahí
                            // se quedaría con el final de cada arrastre.
                            val regreso = estado.volverA
                            if (regreso != null) {
                                /*
                                 * El botón de vuelta, abajo a la izquierda y
                                 * fuera del texto que se acaba de abrir. Se
                                 * queda hasta que se usa o se sigue otro
                                 * enlace: una nota puede tardar en leerse.
                                 */
                                Text(
                                    "Volver a la p. ${regreso.first}",
                                    style = MaterialTheme.typography.labelLarge,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    modifier = Modifier
                                        .align(Alignment.BottomStart)
                                        .padding(16.dp)
                                        .background(MaterialTheme.colorScheme.surface)
                                        .border(1.dp, MaterialTheme.colorScheme.onSurface)
                                        .heightIn(min = 44.dp)
                                        .clickable(onClick = ::volver)
                                        .padding(horizontal = 14.dp, vertical = 12.dp),
                                )
                            }

                            SnackbarHost(
                                avisos,
                                Modifier
                                    .align(Alignment.BottomStart)
                                    // Por encima del botón de vuelta, si está.
                                    .padding(bottom = if (regreso != null) 76.dp else 0.dp),
                            )

                            if (restaurado && !estado.modoSubrayado) {
                                BarraPosicion(
                                    lista = lista,
                                    paginas = estado.paginas,
                                    altoPista = altoViewport,
                                    marcadores = estado.marcadores.map { it.pagina },
                                    paginasConResultados = paginasConResultados,
                                    alEmpezar = {
                                        lanzamiento?.cancel()
                                        lanzamiento = null
                                    },
                                    alArrastrar = { fraccionPedida = it },
                                    modifier = Modifier.align(Alignment.TopEnd),
                                )
                            }
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
                irA(pagina)
            },
            alBorrar = modelo::borrarAnotacion,
            // El panel se queda abierto debajo: se corrige una nota y se sigue
            // repasando la lista desde donde se estaba.
            alEditar = { notaEditada = it },
            tituloDocumento = estado.documento?.titulo.orEmpty(),
            autorDocumento = estado.documento?.autor,
        )
    }

    if (notaEnCurso) {
        DialogoNota(
            titulo = "Nota en la página ${estado.paginaVisible}",
            alGuardar = { texto ->
                modelo.anotar(estado.paginaVisible, texto)
                notaEnCurso = false
            },
            alCancelar = { notaEnCurso = false },
        )
    }

    notaEditada?.let { nota ->
        DialogoNota(
            titulo = "Nota de la página ${nota.pagina}",
            inicial = nota.texto.orEmpty(),
            alGuardar = { texto ->
                modelo.editarNota(nota, texto)
                notaEditada = null
            },
            alCancelar = { notaEditada = null },
        )
    }

    val busquedaAbierta = estado.busqueda
    if (verResultados && busquedaAbierta != null) {
        DialogoResultados(
            busqueda = busquedaAbierta,
            alElegir = { posicion ->
                verResultados = false
                modelo.irAResultado(posicion)?.let(::mostrarResultado)
            },
            alCerrar = { verResultados = false },
        )
    }

    if (estado.protegido) {
        DialogoContrasena(
            incorrecta = estado.contrasenaIncorrecta,
            abriendo = estado.cargando,
            alAbrir = modelo::desbloquear,
            alCancelar = salir,
        )
    }

    enlaceExterno?.let { url ->
        AlertDialog(
            onDismissRequest = { enlaceExterno = null },
            title = { Text("Abrir fuera del lector", style = MaterialTheme.typography.titleMedium) },
            text = {
                Text(
                    url,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    enlaceExterno = null
                    runCatching { contexto.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
                }) { Text("Abrir") }
            },
            dismissButton = { TextButton(onClick = { enlaceExterno = null }) { Text("Cancelar") } },
        )
    }

    if (irAPagina) {
        DialogoIrAPagina(
            actual = estado.paginaVisible,
            paginas = estado.paginas,
            indice = estado.indice,
            indiceLeido = estado.indiceLeido,
            indiceIlegible = estado.indiceIlegible,
            alPedirIndice = modelo::leerIndice,
            alIr = { pagina ->
                irAPagina = false
                irA(pagina)
            },
            alCancelar = { irAPagina = false },
            alVerMiniaturas = {
                irAPagina = false
                verMiniaturas = true
            },
        )
    }

    val pdfAbierto = modelo.pdf
    if (verMiniaturas && pdfAbierto != null) {
        PantallaMiniaturas(
            pdf = pdfAbierto,
            paginas = estado.paginas,
            actual = estado.paginaVisible,
            marcadores = estado.marcadores.map { it.pagina },
            alIr = { pagina ->
                verMiniaturas = false
                irA(pagina)
            },
            alCerrar = { verMiniaturas = false },
        )
    }
}

/** Lo que tarda el zoom de los botones y del doble toque. */
private const val DURACION_ZOOM_MS = 220

/** Lo que tiene que estar quieto el lector antes de pedir el trozo nítido. */
private const val ESPERA_MOSAICO_MS = 200L

/** Lo que tiene que estar quieta la lista antes de pintar la página siguiente. */
private const val ESPERA_PRECARGA_MS = 400L
