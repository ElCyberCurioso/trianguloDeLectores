package site.triangulodelectores.lector.pdf

import site.triangulodelectores.lector.data.local.Rect

/**
 * Un trozo de texto seleccionado: dónde pintarlo y qué pone.
 *
 * Un rectángulo **por renglón**, no uno por palabra. Es lo que hace que un
 * subrayado de tres líneas se vea como un subrayado y no como una fila de
 * pegatinas con huecos entre las palabras, y además es lo que guarda el lector
 * web para lo mismo: los dos lados escriben la misma forma.
 */
data class SeleccionTexto(val rects: List<Rect>, val cita: String)

/**
 * Cuánto se tienen que solapar dos palabras en vertical para ser del mismo
 * renglón. La mitad de la altura: con menos, un subíndice o una fórmula abren
 * un renglón por su cuenta; con más, dos líneas apretadas se funden en una.
 */
private const val MISMO_RENGLON = 0.5f

/**
 * De dos puntos a un trozo de texto.
 *
 * El recorrido no es geométrico sino **de lectura**: se busca la palabra que
 * hay bajo cada punto y se coge todo lo que va de una a otra en el orden en que
 * se lee, igual que al arrastrar sobre un texto en cualquier otro sitio. Coger
 * lo que cae dentro del rectángulo que forman los dos puntos daría otra cosa —
 * en dos columnas se llevaría media columna de al lado— y no sería seleccionar
 * texto, sería volver a marcar una zona.
 *
 * Devuelve `null` si en esa página no hay texto, que es el caso de un escaneado
 * sin OCR. Ahí no hay nada que seleccionar y quien llama vuelve al recuadro.
 */
fun seleccionarTexto(
    palabras: List<Palabra>,
    desdeX: Float,
    desdeY: Float,
    hastaX: Float,
    hastaY: Float,
): SeleccionTexto? {
    if (palabras.isEmpty()) return null

    val inicio = indiceDePalabraEn(palabras, desdeX, desdeY) ?: return null
    val fin = indiceDePalabraEn(palabras, hastaX, hastaY) ?: return null

    val primera = minOf(inicio, fin)
    val ultima = maxOf(inicio, fin)
    val trozo = palabras.subList(primera, ultima + 1)

    val renglones = agruparPorRenglon(trozo)

    return SeleccionTexto(
        rects = renglones.map { renglon ->
            val x = renglon.minOf { it.x }
            val y = renglon.minOf { it.y }
            Rect(
                x = x,
                y = y,
                w = (renglon.maxOf { it.derecha } - x).coerceAtLeast(0f),
                h = (renglon.maxOf { it.abajo } - y).coerceAtLeast(0f),
            )
        },
        // Las palabras van separadas por un espacio y los renglones también: un
        // salto de línea dentro de una cita la parte al pegarla en cualquier
        // otro sitio, y lo que se cita es una frase, no una maqueta.
        cita = renglones.joinToString(" ") { renglon -> renglon.joinToString(" ") { it.texto } },
    )
}

/**
 * Qué palabra hay en un punto.
 *
 * Primero se mira el renglón: entre dos líneas, la de arriba y la de abajo
 * están a la misma distancia y elegir por distancia daría tumbos según el
 * píxel. Dentro del renglón sí manda la horizontal, y el dedo que se pasa del
 * final de la línea coge la última palabra en vez de no coger ninguna.
 */
private fun indiceDePalabraEn(palabras: List<Palabra>, x: Float, y: Float): Int? {
    val enElRenglon = palabras.indices.filter { y >= palabras[it].y && y <= palabras[it].abajo }
    if (enElRenglon.isNotEmpty()) {
        return enElRenglon.firstOrNull { palabras[it].contiene(x, y) }
            ?: enElRenglon.minByOrNull { distanciaHorizontal(palabras[it], x) }
    }
    // Fuera de todo renglón —el margen, el hueco entre párrafos, más abajo de
    // la última línea— se coge la palabra más cercana. Arrastrar hasta el borde
    // de la página tiene que seleccionar hasta el final, no perder la selección.
    return palabras.indices.minByOrNull { palabras[it].distanciaA(x, y) }
}

private fun distanciaHorizontal(palabra: Palabra, x: Float): Float = when {
    x < palabra.x -> palabra.x - x
    x > palabra.derecha -> x - palabra.derecha
    else -> 0f
}

/** Parte la lista en renglones, aprovechando que ya viene en orden de lectura. */
private fun agruparPorRenglon(palabras: List<Palabra>): List<List<Palabra>> {
    val renglones = mutableListOf<MutableList<Palabra>>()

    palabras.forEach { palabra ->
        val actual = renglones.lastOrNull()
        if (actual != null && mismoRenglon(actual.last(), palabra)) {
            actual += palabra
        } else {
            renglones += mutableListOf(palabra)
        }
    }

    return renglones
}

private fun mismoRenglon(anterior: Palabra, actual: Palabra): Boolean {
    val solape = minOf(anterior.abajo, actual.abajo) - maxOf(anterior.y, actual.y)
    val referencia = minOf(anterior.h, actual.h)
    if (referencia <= 0f) return false
    return solape >= referencia * MISMO_RENGLON
}
