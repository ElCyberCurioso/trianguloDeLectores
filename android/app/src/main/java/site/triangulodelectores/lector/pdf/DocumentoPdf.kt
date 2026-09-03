package site.triangulodelectores.lector.pdf

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.util.LruCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import site.triangulodelectores.lector.data.local.Documento
import site.triangulodelectores.lector.data.local.Origen
import java.io.Closeable
import java.io.File

/**
 * Un PDF abierto.
 *
 * Se usa `PdfRenderer`, que viene en Android desde la API 21 y no añade nada al
 * APK. La contrapartida está asumida y es la que decide media interfaz: **no
 * hay capa de texto**. `PdfRenderer` pinta la página como imagen y no dice qué
 * pone en ella, así que aquí no se puede seleccionar una palabra, ni buscar
 * dentro del documento, ni copiar una cita. Por eso los subrayados se hacen
 * arrastrando un recuadro sobre la zona: es lo que sí se puede hacer bien, y
 * las coordenadas que produce son las mismas 0..1 que guarda el lector web, así
 * que un subrayado hecho aquí se ve allí y al revés.
 *
 * La clase **no es reentrante**: `PdfRenderer` prohíbe tener dos páginas
 * abiertas a la vez y no es seguro entre hilos. De ahí el mutex -- sin él, dos
 * páginas pintándose a la vez al desplazarse rápido revientan el proceso
 * entero, no lanzan una excepción.
 */
class DocumentoPdf private constructor(
    private val descriptor: ParcelFileDescriptor,
    private val renderer: PdfRenderer,
    /** Copia temporal, cuando la URI no se podía abrir directamente. */
    private val temporal: File?,
) : Closeable {

    private val cerrojo = Mutex()

    val paginas: Int get() = renderer.pageCount

    /**
     * Proporción alto/ancho de una página, para reservarle su hueco **antes**
     * de pintarla. Sin esto, la lista salta al llegar cada página: se dibuja
     * con una altura provisional y se recoloca al terminar.
     */
    suspend fun proporcion(indice: Int): Float = withContext(Dispatchers.IO) {
        cerrojo.withLock {
            renderer.openPage(indice).use { pagina ->
                if (pagina.width <= 0) 1.414f else pagina.height.toFloat() / pagina.width.toFloat()
            }
        }
    }

    /**
     * Pinta una página al ancho pedido.
     *
     * El fondo se rellena de blanco antes de pintar: `PdfRenderer` dibuja sobre
     * lo que haya, y un bitmap recién creado es transparente. Sin el relleno,
     * un PDF con zonas sin fondo sale con la basura de la página anterior.
     */
    suspend fun pintar(indice: Int, anchoPx: Int): Bitmap = withContext(Dispatchers.IO) {
        cerrojo.withLock {
            renderer.openPage(indice).use { pagina ->
                val ancho = anchoPx.coerceAtLeast(1)
                val alto = (ancho.toFloat() * pagina.height / pagina.width).toInt().coerceAtLeast(1)
                val bitmap = Bitmap.createBitmap(ancho, alto, Bitmap.Config.ARGB_8888)
                bitmap.eraseColor(Color.WHITE)
                pagina.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                bitmap
            }
        }
    }

    override fun close() {
        runCatching { renderer.close() }
        runCatching { descriptor.close() }
        temporal?.delete()
    }

    companion object {
        /**
         * Abre el documento venga de donde venga.
         *
         * Un PDF remoto ya está en un fichero nuestro. Uno local es una URI del
         * sistema, y ahí hay un caso que no se puede ignorar: `PdfRenderer`
         * exige un descriptor **posicionable**, y los proveedores de nube
         * (Drive, algunos gestores de archivos) devuelven uno que no lo es. En
         * ese caso se copia a la caché y se abre la copia. Es lo único que
         * permite abrir esos ficheros, y sólo se paga cuando hace falta.
         */
        fun abrir(contexto: Context, documento: Documento): DocumentoPdf {
            if (documento.origen == Origen.REMOTO) {
                val fichero = documento.rutaFichero?.let(::File)
                    ?: throw IllegalStateException("Este libro todavía no se ha descargado")
                if (!fichero.exists()) throw IllegalStateException("La copia descargada ya no está")
                val descriptor = ParcelFileDescriptor.open(fichero, ParcelFileDescriptor.MODE_READ_ONLY)
                return DocumentoPdf(descriptor, PdfRenderer(descriptor), null)
            }

            val uri = Uri.parse(documento.uri ?: throw IllegalStateException("El documento no tiene fichero"))

            // Si `PdfRenderer` rechaza el descriptor hay que cerrarlo antes de
            // probar con la copia: dejarlo abierto filtra un descriptor por
            // cada intento, y el sistema los cuenta.
            val directo = runCatching {
                val descriptor = contexto.contentResolver.openFileDescriptor(uri, "r")
                    ?: throw IllegalStateException("No se ha podido abrir el documento")
                try {
                    DocumentoPdf(descriptor, PdfRenderer(descriptor), null)
                } catch (e: Throwable) {
                    descriptor.close()
                    throw e
                }
            }.getOrNull()
            if (directo != null) return directo

            val copia = File(contexto.cacheDir, "abierto-${documento.id}.pdf")
            contexto.contentResolver.openInputStream(uri).use { entrada ->
                requireNotNull(entrada) { "No se ha podido leer el documento" }
                copia.outputStream().use { salida -> entrada.copyTo(salida) }
            }
            val descriptor = ParcelFileDescriptor.open(copia, ParcelFileDescriptor.MODE_READ_ONLY)
            return DocumentoPdf(descriptor, PdfRenderer(descriptor), copia)
        }
    }
}

/**
 * Páginas ya pintadas.
 *
 * El techo es un cuarto de la memoria de la aplicación y se cuenta en bytes de
 * bitmap, no en número de páginas: una página A4 a 1080 px de ancho ocupa unos
 * 6 MB, y «diez páginas» significa cosas muy distintas según la pantalla.
 */
class CachePaginas {
    private val cache = object : LruCache<String, Bitmap>(
        ((Runtime.getRuntime().maxMemory() / 1024).toInt() / 4).coerceAtLeast(16 * 1024),
    ) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount / 1024
    }

    fun obtener(documentoId: String, pagina: Int, ancho: Int): Bitmap? = cache[clave(documentoId, pagina, ancho)]

    fun guardar(documentoId: String, pagina: Int, ancho: Int, bitmap: Bitmap) {
        cache.put(clave(documentoId, pagina, ancho), bitmap)
    }

    fun vaciar() = cache.evictAll()

    private fun clave(documentoId: String, pagina: Int, ancho: Int) = "$documentoId:$pagina:$ancho"
}
