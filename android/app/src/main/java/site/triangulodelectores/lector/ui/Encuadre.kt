package site.triangulodelectores.lector.ui

/*
 * Las cuentas del lector, sin Compose.
 *
 * Todo lo que aquí hay estaba escrito dentro de la pantalla, mezclado con el
 * estado de Compose, y por eso no tenía ni un test: el encuadre, el zoom
 * anclado a un punto y la posición en páginas fueron justo lo que más se
 * rompió en el lector. Son cuentas con números y se prueban en la JVM.
 *
 * Los puntos van en dos `Float` sueltos y no en un `Offset` a propósito: así
 * este fichero no toca ninguna clase de Compose y los tests no dependen de que
 * la de Compose esté en el classpath de la JVM.
 */

/**
 * Cuánto puede correrse el documento hacia la izquierda, en píxeles: lo que
 * sobresale por la derecha y nada más. Con el zoom al mínimo vale cero, y
 * entonces el único encuadre legal es el de la izquierda pegada al borde.
 */
internal fun margenEncuadre(anchoHueco: Int, zoom: Float): Float =
    (anchoHueco * (zoom - 1f)).coerceAtLeast(0f)

/** El encuadre dentro de lo legal: el tope derecho es cero y el izquierdo sale del zoom. */
internal fun acotarEncuadre(x: Float, anchoHueco: Int, zoom: Float): Float =
    x.coerceIn(-margenEncuadre(anchoHueco, zoom), 0f)

/**
 * Qué parte del documento ampliado queda oculta por la izquierda, de 0 a
 * `(zoom - 1) / zoom`.
 *
 * Es lo que sobrevive al giro: no depende del ancho de la pantalla, así que al
 * reponerla con el ancho nuevo cae siempre dentro del margen. Nula cuando no
 * hay documento que medir —el hueco todavía no se ha medido—.
 */
internal fun fraccionDeEncuadre(x: Float, anchoHueco: Int, zoom: Float): Float? {
    val documento = anchoHueco * zoom
    return if (documento > 0f) (-x / documento).coerceIn(0f, 1f) else null
}

/** Lo contrario de [fraccionDeEncuadre]: de la fracción, a píxeles del hueco. */
internal fun encuadreDeFraccion(fraccion: Float, anchoHueco: Int, zoom: Float): Float =
    -fraccion * anchoHueco * zoom

/**
 * Un cambio de zoom ya resuelto: el zoom que queda, el encuadre nuevo y cuánto
 * hay que desplazar la lista, en sus píxeles, para que el punto no se mueva.
 */
internal data class ZoomAnclado(val zoom: Float, val desplazamientoX: Float, val deltaLista: Float)

/**
 * Cambia el zoom dejando quieto el punto ([centroX], [centroY]) del hueco.
 *
 * Se usa el factor **ya recortado** por el techo y el suelo del zoom: con el
 * pedido, seguir pellizcando en el tope movería el documento sin ampliarlo. Si
 * el recorte deja el zoom donde estaba, no hay nada que hacer y devuelve nulo.
 *
 * En horizontal, el punto bajo el centro se queda donde estaba. En vertical lo
 * mismo, pero el eje lo lleva la lista, que mide **sin ampliar**: de ahí la
 * división por el zoom de antes, que es el que traduce sus píxeles a los de la
 * pantalla.
 */
internal fun anclarZoom(
    anterior: Float,
    pedido: Float,
    centroX: Float,
    centroY: Float,
    desplazamientoX: Float,
    anchoHueco: Int,
): ZoomAnclado? {
    val nuevo = pedido.coerceIn(ZOOM_MINIMO, ZOOM_MAXIMO)
    val real = if (anterior > 0f) nuevo / anterior else 1f
    if (real == 1f) return null
    val x = acotarEncuadre(centroX - (centroX - desplazamientoX) * real, anchoHueco, nuevo)
    val delta = if (anterior > 0f) centroY * (1f - 1f / real) / anterior else 0f
    return ZoomAnclado(nuevo, x, delta)
}

/** Una página tal como la ha dispuesto la lista: dónde empieza y cuánto mide. */
internal data class PaginaMedida(val indice: Int, val offset: Int, val alto: Int)

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
 * [visiblesEnLista] van en orden, como las da la lista. Devuelve nulo cuando no
 * hay nada que recorrer: lista sin medir todavía, o un documento que cabe
 * entero en la pantalla.
 */
internal fun posicionEnPaginas(
    visiblesEnLista: List<PaginaMedida>,
    inicioHueco: Int,
    finHueco: Int,
    paginas: Int,
): PosicionDocumento? {
    if (paginas <= 0 || visiblesEnLista.isEmpty()) return null

    var visibles = 0f
    for (pagina in visiblesEnLista) {
        if (pagina.alto <= 0) continue
        val arriba = maxOf(pagina.offset, inicioHueco)
        val abajo = minOf(pagina.offset + pagina.alto, finHueco)
        if (abajo > arriba) visibles += (abajo - arriba).toFloat() / pagina.alto
    }

    val primera = visiblesEnLista.first()
    val avanzado = primera.indice +
        if (primera.alto > 0) (inicioHueco - primera.offset).toFloat() / primera.alto else 0f

    val recorrible = paginas - visibles
    if (recorrible <= 0.001f) return null
    return PosicionDocumento((avanzado / recorrible).coerceIn(0f, 1f), visibles)
}

/**
 * A qué página y a qué fracción de ella lleva una fracción del documento.
 *
 * Lo contrario de [posicionEnPaginas]: el uno es «la última página abajo del
 * todo», no «el principio de la última página».
 */
internal fun destinoDeFraccion(fraccion: Float, paginas: Int, visibles: Float): Pair<Int, Float> {
    val destino = fraccion.coerceIn(0f, 1f) * (paginas - visibles).coerceAtLeast(0f)
    val indice = destino.toInt().coerceIn(0, (paginas - 1).coerceAtLeast(0))
    return indice to (destino - indice).coerceIn(0f, 1f)
}

/** Ancho al que conviene pintar para un zoom dado, con el [techo] aplicado. */
internal fun anchoRasterDe(anchoViewport: Int, zoom: Float, techo: Int): Int =
    minOf((anchoViewport * zoom).toInt(), techo).coerceAtLeast(1)
