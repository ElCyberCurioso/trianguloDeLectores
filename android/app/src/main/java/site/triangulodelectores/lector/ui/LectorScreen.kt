package site.triangulodelectores.lector.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import site.triangulodelectores.lector.data.local.Anotacion
import site.triangulodelectores.lector.data.local.ColorAnotacion
import site.triangulodelectores.lector.data.local.Rect
import site.triangulodelectores.lector.data.local.TipoAnotacion
import site.triangulodelectores.lector.pdf.CachePaginas
import site.triangulodelectores.lector.pdf.DocumentoPdf
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
    val scrollHorizontal = rememberScrollState()
    var panelAnotaciones by remember { mutableStateOf(false) }
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

    Column(Modifier.fillMaxSize()) {
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
                        "Modo subrayado: arrastra sobre la zona que quieras marcar.",
                        Modifier.padding(horizontal = 16.dp),
                        acento = true,
                    )
                }

                val pdf = modelo.pdf
                if (pdf != null) {
                    Box(
                        Modifier
                            .fillMaxSize()
                            .background(MaterialTheme.colorScheme.background)
                            .horizontalScroll(scrollHorizontal),
                    ) {
                        PaginasDelDocumento(
                            pdf = pdf,
                            documentoId = estado.documento?.id ?: "",
                            cache = cache,
                            estadoLista = lista,
                            zoom = estado.zoom,
                            anotaciones = estado.anotaciones,
                            modoSubrayado = estado.modoSubrayado,
                            colorActivo = estado.colorActivo,
                            alSubrayar = modelo::subrayar,
                            alDobleToque = {
                                modelo.cambiarZoom(if (estado.zoom > 1.5f) 1f else 2f)
                            },
                        )
                    }
                }
            }
        }
    }

    if (panelAnotaciones) {
        PanelAnotaciones(
            anotaciones = estado.anotaciones,
            marcadores = estado.marcadores.map { it.pagina },
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
@Composable
private fun PaginasDelDocumento(
    pdf: DocumentoPdf,
    documentoId: String,
    cache: CachePaginas,
    estadoLista: androidx.compose.foundation.lazy.LazyListState,
    zoom: Float,
    anotaciones: List<Anotacion>,
    modoSubrayado: Boolean,
    colorActivo: ColorAnotacion,
    alSubrayar: (Int, Rect) -> Unit,
    alDobleToque: () -> Unit,
) {
    val densidad = LocalDensity.current
    var anchoBase by remember { mutableStateOf(0) }

    Box(
        Modifier
            .fillMaxWidth()
            .onSizeChanged { anchoBase = it.width },
    ) {
        if (anchoBase > 0) {
            val anchoPx = (anchoBase * zoom).toInt()
            val anchoDp = with(densidad) { anchoPx.toDp() }

            LazyColumn(
                state = estadoLista,
                modifier = Modifier.width(anchoDp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                items(pdf.paginas) { indice ->
                    PaginaPdf(
                        pdf = pdf,
                        documentoId = documentoId,
                        cache = cache,
                        indice = indice,
                        anchoPx = anchoPx,
                        anotaciones = anotaciones.filter { it.pagina == indice + 1 },
                        modoSubrayado = modoSubrayado,
                        colorActivo = colorActivo,
                        alSubrayar = { rect -> alSubrayar(indice + 1, rect) },
                        alDobleToque = alDobleToque,
                    )
                }
            }
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
    modoSubrayado: Boolean,
    colorActivo: ColorAnotacion,
    alSubrayar: (Rect) -> Unit,
    alDobleToque: () -> Unit,
) {
    var proporcion by remember(indice) { mutableStateOf(1.414f) }
    var bitmap by remember(indice, anchoPx) { mutableStateOf<ImageBitmap?>(null) }
    var arrastre by remember { mutableStateOf<Pair<Offset, Offset>?>(null) }

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
            .pointerInput(modoSubrayado, indice) {
                if (modoSubrayado) {
                    detectDragGestures(
                        onDragStart = { inicio -> arrastre = inicio to inicio },
                        onDrag = { cambio, _ ->
                            cambio.consume()
                            arrastre = arrastre?.copy(second = cambio.position)
                        },
                        onDragEnd = {
                            val (inicio, fin) = arrastre ?: return@detectDragGestures
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
                            arrastre = null
                        },
                        onDragCancel = { arrastre = null },
                    )
                }
            }
            .pointerInput(indice) {
                detectTapGestures(onDoubleTap = { alDobleToque() })
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
