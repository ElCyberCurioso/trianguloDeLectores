package site.triangulodelectores.lector.pdf

import site.triangulodelectores.lector.data.local.Rect

/**
 * Un enlace de una página: una zona que, al tocarla, lleva a otro sitio.
 *
 * [rect] va en las mismas coordenadas 0..1 de todo lo demás, sobre la página
 * ya girada.
 */
sealed interface Enlace {
    val rect: Rect
}

/**
 * A otro sitio del mismo documento: una nota al pie, una referencia cruzada,
 * una entrada del índice impreso.
 *
 * [altura] es dónde cae el destino dentro de su página, de 0 arriba a 1 abajo,
 * cuando el PDF lo dice. Muchos sólo dicen la página; entonces se va a su
 * principio.
 */
data class EnlaceInterno(override val rect: Rect, val pagina: Int, val altura: Float?) : Enlace

/** Fuera del documento: una página web o una dirección de correo. */
data class EnlaceExterno(override val rect: Rect, val url: String) : Enlace

/**
 * Cuánto se agranda la zona de un enlace para tocarla, en fracción de la página.
 *
 * Una llamada de nota es un superíndice de un par de milímetros, y la yema de
 * un dedo tapa varios: sin margen, acertar en el «3» de una nota al pie era
 * cuestión de suerte. Un 1,5 % del ancho de una página son unos tres
 * milímetros en un teléfono.
 */
private const val MARGEN_TOQUE = 0.015f

/**
 * El enlace que hay bajo un toque, en coordenadas 0..1 de la página.
 *
 * Con el margen, dos enlaces vecinos pueden solaparse —dos llamadas de nota
 * seguidas—; gana el que de verdad contiene el punto y, si ninguno o ambos,
 * el más pequeño, que es el que se apuntaba con más intención.
 */
fun enlaceEn(enlaces: List<Enlace>, x: Float, y: Float): Enlace? {
    fun contiene(r: Rect, margen: Float) =
        x >= r.x - margen && x <= r.x + r.w + margen && y >= r.y - margen && y <= r.y + r.h + margen

    val dentro = enlaces.filter { contiene(it.rect, 0f) }
    val candidatos = dentro.ifEmpty { enlaces.filter { contiene(it.rect, MARGEN_TOQUE) } }
    return candidatos.minByOrNull { it.rect.w * it.rect.h }
}

private val ESQUEMAS_SEGUROS = setOf("http", "https", "mailto")

/**
 * La dirección, si es de las que se pueden abrir: web o correo, y nada más.
 *
 * Un PDF es un fichero de fuera y un enlace puede llevar cualquier cosa: un
 * `intent:` que abre otra aplicación con parámetros elegidos por quien hizo el
 * documento, un `file:` o un `content:` que apunta a algo del teléfono, un
 * `javascript:`. Lista blanca, no negra, por la misma razón que en el sitio:
 * un esquema nuevo no se cuela por no estar en la lista de los malos.
 */
fun urlSegura(url: String): String? {
    val limpia = url.trim()
    val esquema = limpia.substringBefore(':', "").lowercase()
    if (esquema !in ESQUEMAS_SEGUROS) return null
    // `http:` a secas o `mailto:` sin nadie detrás no lleva a ningún sitio.
    if (limpia.length <= esquema.length + 1) return null
    // Sin espacios ni saltos de línea: una dirección que los lleva, o está rota
    // o intenta parecer otra cosa en el diálogo de confirmación.
    if (limpia.any { it.isWhitespace() || it.isISOControl() }) return null
    return limpia
}
