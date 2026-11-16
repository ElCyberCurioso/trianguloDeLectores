package site.triangulodelectores.lector.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.systemGestureExclusion
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/**
 * Por dónde va la lectura dentro del documento entero.
 *
 * [fraccion] va de 0 —el principio arriba— a 1 —el final abajo—. [visibles] es
 * cuántas páginas caben en el hueco, con decimales: hace falta para que el uno
 * sea de verdad el final. Lo que se puede recorrer no son todas las páginas,
 * son todas menos las que ya se ven al llegar abajo.
 */
internal data class PosicionDocumento(val fraccion: Float, val visibles: Float)

/**
 * La posición global, **medida en páginas y no en píxeles**.
 *
 * Una lista perezosa no sabe cuánto mide entera: sólo ha medido lo que tiene a
 * la vista, y las páginas de un PDF no tienen por qué ser todas igual de altas.
 * Sumar píxeles obligaría a inventarse el alto de las que no se han compuesto.
 * El par (página, fracción dentro de ella) sí se conoce siempre, y es además la
 * misma moneda en la que se guarda el progreso.
 *
 * Devuelve nulo cuando no hay nada que recorrer: lista sin medir todavía, o un
 * documento que cabe entero en la pantalla.
 */
internal fun posicionDe(lista: LazyListState, paginas: Int): PosicionDocumento? {
    val info = lista.layoutInfo
    val items = info.visibleItemsInfo
    if (paginas <= 0 || items.isEmpty()) return null

    val inicio = info.viewportStartOffset
    val fin = info.viewportEndOffset

    var visibles = 0f
    for (item in items) {
        if (item.size <= 0) continue
        val arriba = maxOf(item.offset, inicio)
        val abajo = minOf(item.offset + item.size, fin)
        if (abajo > arriba) visibles += (abajo - arriba).toFloat() / item.size
    }

    val primero = items.first()
    val avanzado = primero.index +
        if (primero.size > 0) (inicio - primero.offset).toFloat() / primero.size else 0f

    val recorrible = paginas - visibles
    if (recorrible <= 0.001f) return null
    return PosicionDocumento((avanzado / recorrible).coerceIn(0f, 1f), visibles)
}

/**
 * Lleva la lista a una fracción del documento.
 *
 * El alto de la página de destino casi nunca se conoce —no está compuesta—, así
 * que la parte fraccionaria se convierte con el alto medio de las que hay a la
 * vista. Es una estimación y no importa: al arrastrar se corrige en el evento
 * siguiente, y al soltar la barra se coloca donde de verdad ha quedado la
 * lista, no donde se pidió.
 */
internal suspend fun LazyListState.irAFraccion(fraccion: Float, paginas: Int) {
    val posicion = posicionDe(this, paginas) ?: return
    val destino = fraccion.coerceIn(0f, 1f) * (paginas - posicion.visibles)
    val indice = destino.toInt().coerceIn(0, paginas - 1)

    val items = layoutInfo.visibleItemsInfo
    val alto = items.firstOrNull { it.index == indice }?.size
        ?: items.map { it.size }.average().toInt()

    scrollToItem(indice, ((destino - indice) * alto).roundToInt().coerceAtLeast(0))
}

/**
 * La barra de posición del lector: dónde se está y un tirador para ir a otro
 * sitio.
 *
 * **Sólo el tirador se deja tocar**, no la franja entera. Una franja pulsable de
 * arriba abajo se quedaría con todo lo que pase por el borde derecho, y ahí hay
 * documento: el doble toque, el arrastre con zoom y el final de cada renglón.
 * Tampoco hay salto al tocar la pista por lo mismo. El tirador mide 48 dp de
 * alto y 28 de ancho de zona pulsable aunque se pinte de 5.
 *
 * Tiene tamaño fijo y no proporcional al documento: en un libro de trescientas
 * páginas el proporcional mediría dos píxeles, y a partir de quince páginas ya
 * quedaría por debajo de lo que un dedo acierta.
 *
 * Las rayas de la pista son los marcadores. Van en el color de acento porque
 * significan algo —«aquí dejaste una señal»— y la pista sin ellas no pinta
 * nada: una franja gris de arriba abajo sobre la página sería decoración.
 */
@Composable
fun BarraPosicion(
    lista: LazyListState,
    paginas: Int,
    /** Alto del hueco del documento, en píxeles. Es el largo de la pista. */
    altoPista: Int,
    marcadores: List<Int>,
    /** Páginas con resultados de la búsqueda, sin repetir. */
    paginasConResultados: List<Int> = emptyList(),
    /** Se agarra el tirador: lo que siguiera rodando tiene que parar. */
    alEmpezar: () -> Unit,
    /** Fracción del documento pedida, de 0 a 1. */
    alArrastrar: (Float) -> Unit,
    modifier: Modifier = Modifier,
) {
    val posicion by remember(lista, paginas) { derivedStateOf { posicionDe(lista, paginas) } }
    // Sin nada que recorrer no hay barra: un tirador que no se mueve estorba.
    val hayRecorrido by remember(lista, paginas) { derivedStateOf { posicion != null } }
    if (!hayRecorrido || altoPista <= 0) return

    val densidad = LocalDensity.current
    val altoTirador = with(densidad) { ALTO_TIRADOR.toPx() }
    val recorrido = (altoPista - altoTirador).coerceAtLeast(1f)

    var arrastrando by remember { mutableStateOf(false) }
    var fraccionArrastre by remember { mutableStateOf(0f) }
    val paginaViva by remember(lista) { derivedStateOf { lista.firstVisibleItemIndex + 1 } }

    val empezar by rememberUpdatedState(alEmpezar)
    val arrastrar by rememberUpdatedState(alArrastrar)

    /*
     * Dónde se colocó el tirador **la última vez que se dispuso**, en píxeles.
     *
     * Hace falta porque el tirador se mueve debajo del dedo: las posiciones que
     * llegan al detector son relativas al propio tirador, así que si sigue al
     * dedo el movimiento que se ve es casi cero y la barra se frena sola. Con
     * esto se pasa a coordenadas de la pista, que no se mueve. Y tiene que ser
     * lo colocado de verdad y no lo que diga el estado, que puede ir un
     * fotograma por delante de la disposición.
     */
    val colocado = remember { IntArray(1) }

    Box(modifier.fillMaxHeight()) {
        val acento = MaterialTheme.colorScheme.primary
        val tenue = MaterialTheme.colorScheme.onSurfaceVariant
        Canvas(
            Modifier
                .align(Alignment.TopEnd)
                .width(ANCHO_MARCA)
                .fillMaxHeight(),
        ) {
            val ultima = (paginas - 1).coerceAtLeast(1)
            /*
             * Primero los resultados y encima los marcadores. Los resultados
             * en tenue y más cortos: son muchos y dicen «aquí hay algo»; el
             * marcador es uno que se puso a mano y dice «aquí me quedé», que es
             * lo que no se puede perder entre los otros.
             */
            paginasConResultados.forEach { pagina ->
                val centro = altoTirador / 2f +
                    ((pagina - 1).toFloat() / ultima).coerceIn(0f, 1f) * recorrido
                drawRect(
                    color = tenue,
                    topLeft = Offset(size.width / 2f, centro - 1.dp.toPx()),
                    size = Size(size.width / 2f, 2.dp.toPx()),
                )
            }
            marcadores.forEach { pagina ->
                val centro = altoTirador / 2f +
                    ((pagina - 1).toFloat() / ultima).coerceIn(0f, 1f) * recorrido
                drawRect(
                    color = acento,
                    topLeft = Offset(0f, centro - 1.dp.toPx()),
                    size = Size(size.width, 2.dp.toPx()),
                )
            }
        }

        Row(
            Modifier
                .align(Alignment.TopEnd)
                // En lambda: la posición se lee al disponer y no al componer,
                // así que desplazarse no recompone nada de esto.
                .offset {
                    val fraccion = if (arrastrando) fraccionArrastre else posicion?.fraccion ?: 0f
                    val y = (fraccion * recorrido).roundToInt()
                    colocado[0] = y
                    IntOffset(0, y)
                },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (arrastrando) {
                // Mientras se arrastra, la barra de arriba suele estar
                // escondida: el número de página tiene que ir con el dedo.
                Text(
                    "Página $paginaViva de $paginas",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier
                        .background(MaterialTheme.colorScheme.surface)
                        .border(1.dp, MaterialTheme.colorScheme.onSurface)
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                )
            }

            Box(
                Modifier
                    .width(ANCHO_ZONA)
                    .height(ALTO_TIRADOR)
                    // El borde derecho es del gesto de «atrás» del sistema. Un
                    // dedo que baja por ahí no es un «atrás», pero basta una
                    // pizca de deriva lateral para que el sistema se lo quede.
                    .systemGestureExclusion()
                    .semantics {
                        contentDescription = "Posición en el documento"
                        stateDescription = "Página $paginaViva de $paginas"
                        progressBarRangeInfo =
                            ProgressBarRangeInfo(posicion?.fraccion ?: 0f, 0f..1f)
                        setProgress { pedido ->
                            arrastrar(pedido.coerceIn(0f, 1f))
                            true
                        }
                    }
                    .pointerInput(recorrido) {
                        awaitEachGesture {
                            val bajada = awaitFirstDown()
                            bajada.consume()
                            empezar()

                            // El punto del tirador por donde se agarró se queda
                            // bajo el dedo: sin esto, al tocarlo pegaría un
                            // salto hasta centrarse.
                            val agarre = bajada.position.y
                            fraccionArrastre = (colocado[0] / recorrido).coerceIn(0f, 1f)
                            arrastrando = true

                            try {
                                while (true) {
                                    val evento = awaitPointerEvent()
                                    val dedo = evento.changes.firstOrNull { it.id == bajada.id }
                                    if (dedo == null || !dedo.pressed) break
                                    dedo.consume()

                                    val enPista = colocado[0] + dedo.position.y - agarre
                                    val pedida = (enPista / recorrido).coerceIn(0f, 1f)
                                    if (pedida != fraccionArrastre) {
                                        fraccionArrastre = pedida
                                        arrastrar(pedida)
                                    }
                                }
                            } finally {
                                // También si el gesto se cancela a medias: un
                                // tirador que se queda en «arrastrando» dejaría
                                // de seguir a la lista para siempre.
                                arrastrando = false
                            }
                        }
                    },
                contentAlignment = Alignment.CenterEnd,
            ) {
                Box(
                    Modifier
                        .width(if (arrastrando) ANCHO_TIRADOR_ACTIVO else ANCHO_TIRADOR)
                        .fillMaxHeight()
                        // Relleno y filete de colores opuestos: el tirador pasa
                        // por encima de páginas blancas y de fondo oscuro, y con
                        // un solo color se perdería en uno de los dos.
                        .background(
                            if (arrastrando) acento else MaterialTheme.colorScheme.surface,
                        )
                        .border(1.dp, MaterialTheme.colorScheme.onSurface),
                )
            }
        }
    }
}

private val ALTO_TIRADOR = 48.dp
private val ANCHO_ZONA = 28.dp
private val ANCHO_TIRADOR = 5.dp
private val ANCHO_TIRADOR_ACTIVO = 8.dp
private val ANCHO_MARCA = 8.dp
