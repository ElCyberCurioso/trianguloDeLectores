package site.triangulodelectores.lector.pdf

import site.triangulodelectores.lector.data.local.Rect
import java.text.Normalizer

/**
 * Un sitio del documento donde aparece lo buscado.
 *
 * [rects] son los trozos de renglón que ocupa, en las mismas coordenadas 0..1
 * que los subrayados: así se pintan en la página con el mismo código y caen en
 * su sitio con cualquier zoom. [antes], [encontrado] y [despues] son el
 * contexto para la lista de resultados, con el texto tal como viene en el PDF
 * —con sus tildes y sus mayúsculas—, no normalizado.
 */
data class Coincidencia(
    /** Desde uno, como todo lo que se enseña. */
    val pagina: Int,
    val rects: List<Rect>,
    val antes: String,
    val encontrado: String,
    val despues: String,
)

private val MARCAS = Regex("\\p{Mn}+")
private val BLANCOS = Regex("\\s+")

/** Palabras de contexto a cada lado del resultado en la lista. */
private const val PALABRAS_DE_CONTEXTO = 6

/**
 * Lo que se compara al buscar: sin tildes, sin mayúsculas y con las ligaduras
 * deshechas.
 *
 * `NFKD` separa la letra de su tilde —«é» pasa a «e» más un acento suelto, que
 * luego se quita— y además deshace las ligaduras tipográficas, que en un PDF
 * compuesto con cuidado están por todas partes: «ﬁ» es un solo carácter y sin
 * esto «fin» no se encontraría en un libro que la use. Quien busca «arbol»
 * quiere encontrar «árbol», y quien busca «Árbol» también.
 */
fun normalizarBusqueda(texto: String): String =
    Normalizer.normalize(texto, Normalizer.Form.NFKD)
        .replace(MARCAS, "")
        .lowercase()
        .replace(BLANCOS, " ")
        .trim()

/**
 * Busca [consulta] en las palabras de una página.
 *
 * Las palabras se unen en una sola cadena con un espacio entre cada dos, en
 * orden de lectura, y la búsqueda se hace sobre esa cadena: así se encuentra
 * también lo que cruza de una palabra a otra —«la casa»— y lo que es sólo un
 * trozo de una —«cas» en «casa»—. Cada carácter recuerda de qué palabra vino,
 * y con eso se vuelve a la página.
 *
 * El trozo de la primera y la última palabra se recorta en proporción a las
 * letras: no se sabe dónde cae cada letra, sólo dónde cae la palabra entera,
 * y repartirla por igual es lo bastante bueno para resaltar «cas» dentro de
 * «casa». Luego los trozos de un mismo renglón se juntan en un rectángulo.
 *
 * Lo que no se encuentra: una palabra partida con guion entre dos renglones.
 * El PDF guarda dos palabras, «pala-» y «bra», y buscar «palabra» no las une.
 */
fun buscarEnPagina(palabras: List<Palabra>, consulta: String, pagina: Int): List<Coincidencia> {
    val buscado = normalizarBusqueda(consulta)
    if (buscado.isEmpty() || palabras.isEmpty()) return emptyList()

    val texto = StringBuilder()
    val inicioDe = IntArray(palabras.size) { -1 }
    val largoDe = IntArray(palabras.size)
    // Para cada carácter de `texto`, de qué palabra viene. -1 en los espacios.
    val dueno = ArrayList<Int>()

    palabras.forEachIndexed { i, palabra ->
        // Sin espacios dentro: una «palabra» de PDFBox no los lleva, pero una
        // ligadura deshecha o un carácter raro podrían colarlos y descuadrar
        // el reparto de letras.
        val normal = normalizarBusqueda(palabra.texto).replace(" ", "")
        if (normal.isEmpty()) return@forEachIndexed
        if (texto.isNotEmpty()) {
            texto.append(' ')
            dueno += -1
        }
        inicioDe[i] = texto.length
        largoDe[i] = normal.length
        texto.append(normal)
        repeat(normal.length) { dueno += i }
    }

    val resultados = mutableListOf<Coincidencia>()
    var desde = 0
    while (true) {
        val inicio = texto.indexOf(buscado, desde)
        if (inicio < 0) break
        val fin = inicio + buscado.length // exclusivo
        desde = fin

        val primera = dueno[inicio]
        val ultima = dueno[fin - 1]
        if (primera < 0 || ultima < 0) continue

        val trozos = (primera..ultima).mapNotNull { i ->
            if (inicioDe[i] < 0 || largoDe[i] == 0) return@mapNotNull null
            val palabra = palabras[i]
            val desdeLetra = if (i == primera) inicio - inicioDe[i] else 0
            val hastaLetra = if (i == ultima) fin - inicioDe[i] else largoDe[i]
            val a = desdeLetra.toFloat() / largoDe[i]
            val b = hastaLetra.toFloat() / largoDe[i]
            Rect(palabra.x + palabra.w * a, palabra.y, palabra.w * (b - a), palabra.h)
        }

        resultados += Coincidencia(
            pagina = pagina,
            rects = juntarPorRenglon(trozos),
            antes = contexto(palabras, primera - PALABRAS_DE_CONTEXTO, primera, alPrincipio = true),
            encontrado = (primera..ultima).joinToString(" ") { palabras[it].texto },
            despues = contexto(palabras, ultima + 1, ultima + 1 + PALABRAS_DE_CONTEXTO, alPrincipio = false),
        )
    }
    return resultados
}

/**
 * Las palabras de [desde] a [hasta] (exclusivo), con puntos suspensivos donde
 * el texto sigue y no se enseña.
 */
private fun contexto(palabras: List<Palabra>, desde: Int, hasta: Int, alPrincipio: Boolean): String {
    val a = desde.coerceAtLeast(0)
    val b = hasta.coerceAtMost(palabras.size)
    if (a >= b) return ""
    val trozo = palabras.subList(a, b).joinToString(" ") { it.texto }
    return when {
        alPrincipio && a > 0 -> "…$trozo"
        !alPrincipio && b < palabras.size -> "$trozo…"
        else -> trozo
    }
}

/**
 * Junta en un rectángulo los trozos seguidos de un mismo renglón.
 *
 * Mismo criterio que la selección: dos cajas son del mismo renglón si sus
 * alturas se solapan más de la mitad. Sin juntarlas, «la casa» se resaltaría
 * como dos bloques con un hueco en medio.
 */
private fun juntarPorRenglon(trozos: List<Rect>): List<Rect> {
    val juntos = mutableListOf<Rect>()
    for (r in trozos) {
        val previo = juntos.lastOrNull()
        if (previo != null && kotlin.math.abs(r.y - previo.y) < maxOf(previo.h, r.h) * 0.5f) {
            val izquierda = minOf(previo.x, r.x)
            val arriba = minOf(previo.y, r.y)
            val derecha = maxOf(previo.x + previo.w, r.x + r.w)
            val abajo = maxOf(previo.y + previo.h, r.y + r.h)
            juntos[juntos.lastIndex] = Rect(izquierda, arriba, derecha - izquierda, abajo - arriba)
        } else {
            juntos += r
        }
    }
    return juntos
}
