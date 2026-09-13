package site.triangulodelectores.lector.pdf

import android.content.Context
import android.net.Uri
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotation
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotationMarkup
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.tom_roush.pdfbox.text.TextPosition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import site.triangulodelectores.lector.data.local.Documento
import site.triangulodelectores.lector.data.local.Origen
import site.triangulodelectores.lector.data.local.Rect
import java.io.Closeable
import java.io.File

/**
 * Una palabra de la página, con su sitio.
 *
 * Las coordenadas son las mismas 0..1 que guarda todo lo demás: relativas al
 * ancho y al alto de la página **ya girada**, con el origen arriba a la
 * izquierda, que es como la pinta `PdfRenderer` y como la entiende el lector
 * web. Sin normalizar, un subrayado hecho a un zoom no caería donde debe a
 * otro.
 */
data class Palabra(
    val texto: String,
    val x: Float,
    val y: Float,
    val w: Float,
    val h: Float,
) {
    val derecha: Float get() = x + w
    val abajo: Float get() = y + h

    /** Distancia al cuadrado de un punto al centro. Para «qué palabra es ésta». */
    fun distanciaA(px: Float, py: Float): Float {
        val cx = x + w / 2f
        val cy = y + h / 2f
        return (px - cx) * (px - cx) + (py - cy) * (py - cy)
    }

    fun contiene(px: Float, py: Float): Boolean = px in x..derecha && py in y..abajo
}

/**
 * Una nota que trae el propio PDF, escrita por quien lo hizo o por quien lo
 * anotó antes de que llegara aquí.
 *
 * No son las nuestras y no se mezclan con ellas: no se editan, no se borran y
 * no se sincronizan. Se leen, que es justo lo que no se podía hacer antes.
 */
data class NotaIncrustada(
    val pagina: Int,
    /** «Nota», «Subrayado», «Comentario»… en castellano, no el nombre PDF. */
    val tipo: String,
    val autor: String?,
    val texto: String,
    /** Dónde está en la página, si la lleva. Normalizado 0..1. */
    val rect: Rect?,
)

/**
 * La capa de texto del documento.
 *
 * `PdfRenderer` pinta la página y no dice qué pone en ella: eso es lo que
 * decidía media interfaz del lector y lo que hacía que un subrayado marcara una
 * zona en vez de unas palabras. Aquí se abre el mismo fichero **una segunda
 * vez** con PDFBox, que no pinta nada pero sí sabe dónde cae cada letra y qué
 * anotaciones lleva dentro.
 *
 * Dos cosas que no se negocian:
 *
 * - **Se abre tarde y sólo si hace falta.** Analizar un PDF escaneado de
 *   cincuenta megas cuesta segundos y memoria; abrirlo al entrar en el libro
 *   pagaría ese precio siempre, incluso para quien sólo va a leer. Se abre la
 *   primera vez que alguien subraya o pide ver las notas del documento.
 * - **El fichero se vuelca a disco, no al montón** (`setupTempFileOnly`). Un
 *   libro grande entero en memoria es la forma segura de que el sistema mate el
 *   proceso a media lectura.
 *
 * Que no haya texto es un caso corriente, no un fallo: un escaneado sin OCR es
 * una imagen y no lleva ni una letra. Entonces `palabras()` devuelve la lista
 * vacía y el lector vuelve al recuadro a mano, que para eso sigue estando.
 */
class TextoPdf private constructor(private val documento: PDDocument) : Closeable {

    /** PDFBox no es seguro entre hilos: una página cada vez, como el pintado. */
    private val cerrojo = Mutex()

    private val palabrasPorPagina = mutableMapOf<Int, List<Palabra>>()
    private var notasLeidas: List<NotaIncrustada>? = null
    private var cerrado = false

    /**
     * Las palabras de una página, de la primera a la última en orden de
     * lectura. El orden importa: es lo que convierte «de aquí a aquí» en un
     * trozo de texto y no en un conjunto de palabras sueltas.
     */
    suspend fun palabras(indice: Int): List<Palabra> = withContext(Dispatchers.IO) {
        cerrojo.withLock {
            if (cerrado) return@withLock emptyList()
            palabrasPorPagina.getOrPut(indice) {
                runCatching {
                    val extractor = ExtractorDePalabras()
                    // Por el nombre del método, no por la propiedad sintética:
                    // esta clase también sobrescribe `startPage(PDPage)` y
                    // dejarlo a la resolución de Kotlin sería pedir problemas.
                    extractor.setSortByPosition(true)
                    extractor.setStartPage(indice + 1)
                    extractor.setEndPage(indice + 1)
                    // Devuelve el texto en una cadena que no se usa: lo que
                    // interesa se ha ido apuntando por el camino, con su sitio.
                    extractor.getText(documento)
                    extractor.palabras.toList()
                }.getOrDefault(emptyList())
            }
        }
    }

    /** Las notas incrustadas de todo el documento. Se leen una vez. */
    suspend fun notas(): List<NotaIncrustada> = withContext(Dispatchers.IO) {
        cerrojo.withLock {
            if (cerrado) return@withLock emptyList()
            notasLeidas ?: runCatching { leerNotas(documento) }
                .getOrDefault(emptyList())
                .also { notasLeidas = it }
        }
    }

    override fun close() {
        cerrado = true
        runCatching { documento.close() }
    }

    companion object {
        /**
         * Abre el documento para leerlo, no para pintarlo.
         *
         * Devuelve `null` si no se puede: cifrado con contraseña, roto, o sin
         * fichero al que llegar. No es un error que deba parar nada -- el lector
         * sigue funcionando sin capa de texto, sólo con menos.
         */
        fun abrir(contexto: Context, documento: Documento): TextoPdf? = runCatching {
            // Las tablas de fuentes y los CMap de PDFBox viven en los `assets`.
            // Sin esto lanza al primer glifo que no sea de una fuente estándar.
            PDFBoxResourceLoader.init(contexto.applicationContext)

            val ajuste = MemoryUsageSetting.setupTempFileOnly().setTempDir(contexto.cacheDir)

            // Mismo criterio que al pintar: si hay fichero nuestro, se abre ése.
            val propio = documento.rutaFichero?.let(::File)
            val abierto = if (propio != null && propio.exists()) {
                PDDocument.load(propio, ajuste)
            } else if (documento.origen == Origen.REMOTO) {
                return@runCatching null
            } else {
                val uri = Uri.parse(documento.uri ?: return@runCatching null)
                contexto.contentResolver.openInputStream(uri).use { entrada ->
                    entrada ?: return@runCatching null
                    PDDocument.load(entrada, ajuste)
                }
            }
            TextoPdf(abierto)
        }.getOrNull()
    }
}

/**
 * Cuánto se pueden separar dos letras y seguir siendo la misma palabra.
 *
 * Es una fracción del ancho de la letra, no una medida fija: en un titular de
 * cuarenta puntos las letras están mucho más separadas que en una nota al pie y
 * un umbral en puntos partiría el titular en sílabas.
 */
private const val HUECO_ENTRE_PALABRAS = 0.28f

/**
 * Extrae las palabras con su sitio.
 *
 * PDFBox da una llamada por línea con la lista de letras que la componen, cada
 * una con su caja. Aquí se agrupan en palabras: se corta en los espacios y allí
 * donde dos letras estén más separadas de lo que caben en una palabra, que es
 * como se separan las palabras en un PDF que no escribe espacios.
 */
private class ExtractorDePalabras : PDFTextStripper() {

    val palabras = mutableListOf<Palabra>()

    /** Tamaño de la página **ya girada**, que es como se ve y como se pinta. */
    private var anchoPagina = 1f
    private var altoPagina = 1f

    private val enCurso = mutableListOf<TextPosition>()

    override fun startPage(pagina: PDPage) {
        val caja = pagina.cropBox
        val giro = ((pagina.rotation % 360) + 360) % 360
        val decostado = giro == 90 || giro == 270
        anchoPagina = (if (decostado) caja.height else caja.width).coerceAtLeast(1f)
        altoPagina = (if (decostado) caja.width else caja.height).coerceAtLeast(1f)
        super.startPage(pagina)
    }

    override fun writeString(texto: String, posiciones: List<TextPosition>) {
        posiciones.forEach { letra ->
            if (letra.unicode.isNullOrBlank()) {
                cerrarPalabra()
                return@forEach
            }
            if (enCurso.isNotEmpty() && separadas(enCurso.last(), letra)) cerrarPalabra()
            enCurso += letra
        }
        // Cada llamada es una línea. Una palabra no cruza de una línea a la
        // siguiente: la partida por guión se queda en dos, que es como se ve.
        cerrarPalabra()
    }

    private fun separadas(anterior: TextPosition, actual: TextPosition): Boolean {
        // Cambio de renglón dentro de la misma llamada: pasa en las tablas.
        val saltoVertical = kotlin.math.abs(actual.yDirAdj - anterior.yDirAdj) > anterior.heightDir * 0.5f
        if (saltoVertical) return true

        val hueco = actual.xDirAdj - (anterior.xDirAdj + anterior.widthDirAdj)
        val referencia = maxOf(anterior.widthDirAdj, actual.widthDirAdj, 1f)
        // El hueco negativo es texto justificado o una ligadura, no una palabra
        // nueva: sólo separa el hueco que sobra.
        return hueco > referencia * HUECO_ENTRE_PALABRAS
    }

    private fun cerrarPalabra() {
        if (enCurso.isEmpty()) return

        val texto = enCurso.joinToString("") { it.unicode }
        if (texto.isBlank()) {
            enCurso.clear()
            return
        }

        val izquierda = enCurso.minOf { it.xDirAdj }
        val derecha = enCurso.maxOf { it.xDirAdj + it.widthDirAdj }
        // `getYDirAdj()` mide desde arriba y cae en la base de la letra: el alto
        // se resta para llegar al borde superior de la caja.
        val abajo = enCurso.maxOf { it.yDirAdj }
        val alto = enCurso.maxOf { it.heightDir }

        palabras += Palabra(
            texto = texto,
            x = (izquierda / anchoPagina).coerceIn(0f, 1f),
            y = ((abajo - alto) / altoPagina).coerceIn(0f, 1f),
            w = ((derecha - izquierda) / anchoPagina).coerceIn(0f, 1f),
            h = (alto / altoPagina).coerceIn(0f, 1f),
        )
        enCurso.clear()
    }
}

/** Los subtipos que sí son algo que leer, con su nombre en castellano. */
private val TIPOS_LEGIBLES = mapOf(
    "Text" to "Nota",
    "FreeText" to "Texto",
    "Highlight" to "Subrayado",
    "Underline" to "Subrayado",
    "Squiggly" to "Subrayado",
    "StrikeOut" to "Tachado",
    "Square" to "Recuadro",
    "Circle" to "Círculo",
    "Ink" to "Trazo",
    "Caret" to "Inserción",
    "Stamp" to "Sello",
    "FileAttachment" to "Adjunto",
)

/**
 * Lee las anotaciones que el PDF trae dentro.
 *
 * Se descarta lo que no es una nota: los enlaces, los campos de formulario y
 * los `Popup`, que no son una anotación sino la ventanita de otra y repetirían
 * su texto. Y se descarta lo que no tiene nada escrito: un subrayado sin
 * comentario no es algo que leer, y llenar la lista con ellos taparía las notas
 * que sí dicen algo.
 */
private fun leerNotas(documento: PDDocument): List<NotaIncrustada> {
    val notas = mutableListOf<NotaIncrustada>()

    for (indice in 0 until documento.numberOfPages) {
        val pagina = documento.getPage(indice)
        val anotaciones: List<PDAnnotation> = runCatching { pagina.annotations }.getOrDefault(emptyList())

        anotaciones.forEach { anotacion ->
            val tipo = TIPOS_LEGIBLES[anotacion.subtype] ?: return@forEach
            val texto = anotacion.contents?.trim().orEmpty()
            if (texto.isEmpty()) return@forEach

            notas += NotaIncrustada(
                pagina = indice + 1,
                tipo = tipo,
                autor = (anotacion as? PDAnnotationMarkup)?.titlePopup?.trim()?.takeIf { it.isNotEmpty() },
                texto = texto,
                rect = rectDe(anotacion, pagina),
            )
        }
    }

    return notas
}

/**
 * Pasa el rectángulo de una anotación al mismo 0..1 con origen arriba a la
 * izquierda que usa todo lo demás.
 *
 * Son dos cambios de sistema seguidos y hay que hacer los dos. El PDF mide
 * desde abajo y desde el origen del `CropBox`, que no siempre es el cero; y la
 * página puede llevar un giro que `PdfRenderer` aplica al pintarla, así que sin
 * aplicarlo aquí la nota de un documento apaisado saldría en el margen
 * equivocado.
 */
private fun rectDe(anotacion: PDAnnotation, pagina: PDPage): Rect? {
    val r = anotacion.rectangle ?: return null
    val caja = pagina.cropBox
    val ancho = caja.width.coerceAtLeast(1f)
    val alto = caja.height.coerceAtLeast(1f)

    // Sin girar, con el origen arriba a la izquierda.
    val u = r.lowerLeftX - caja.lowerLeftX
    val v = alto - (r.lowerLeftY - caja.lowerLeftY + r.height)
    val w = r.width
    val h = r.height

    val giro = ((pagina.rotation % 360) + 360) % 360
    val (x, y, ax, ay) = when (giro) {
        90 -> Cuatro(alto - (v + h), u, h, w)
        180 -> Cuatro(ancho - (u + w), alto - (v + h), w, h)
        270 -> Cuatro(v, ancho - (u + w), h, w)
        else -> Cuatro(u, v, w, h)
    }

    val anchoFinal = if (giro == 90 || giro == 270) alto else ancho
    val altoFinal = if (giro == 90 || giro == 270) ancho else alto

    return Rect(
        (x / anchoFinal).coerceIn(0f, 1f),
        (y / altoFinal).coerceIn(0f, 1f),
        (ax / anchoFinal).coerceIn(0f, 1f),
        (ay / altoFinal).coerceIn(0f, 1f),
    )
}

/** Cuatro números que van juntos y no merecen una clase con nombre. */
private data class Cuatro(val a: Float, val b: Float, val c: Float, val d: Float)
