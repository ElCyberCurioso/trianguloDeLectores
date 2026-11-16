package site.triangulodelectores.lector.pdf

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.util.LruCache
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
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
 * APK. **Sólo pinta**: no dice qué pone en la página. La capa de texto —las
 * palabras con su sitio, para subrayar texto y no zonas— la da PdfBox en
 * `TextoPdf`, que es otro trato con el mismo fichero y se abre tarde. Las
 * coordenadas son las mismas 0..1 que guarda el lector web, así que un
 * subrayado hecho aquí se ve allí y al revés.
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

    /*
     * Cerrado ya, o a punto. Se mira **dentro** del cerrojo: `close()` lo toma
     * también, así que quien entra después sabe que el renderer ya no existe y
     * no lo toca. Sin esto, salir del lector con una página pintándose cerraba
     * el renderer nativo por debajo de un `render()` en curso.
     */
    @Volatile
    private var cerrado = false

    val paginas: Int = renderer.pageCount

    /*
     * Proporción alto/ancho de cada página, en cuanto se conoce. `NaN` es «no
     * medida todavía».
     *
     * Medir abre la página, y abrirla pide el cerrojo: con la proporción
     * pedida cada vez que una página entra en la lista, cada vuelta a una
     * página ya vista esperaba en la misma cola que el pintado. Se apunta una
     * vez y ya.
     *
     * Sin `@Volatile` en los elementos, y a propósito: lo peor que puede pasar
     * leyendo uno a medio escribir desde otro hilo es ver `NaN` y tomar el
     * camino lento, que es el que había antes.
     */
    private val proporciones = FloatArray(paginas) { Float.NaN }

    /** La proporción si ya se midió, sin esperar a nada. Nulo si no. */
    fun proporcionConocida(indice: Int): Float? =
        proporciones.getOrNull(indice)?.takeUnless { it.isNaN() }

    /**
     * Proporción alto/ancho de una página, para reservarle su hueco **antes**
     * de pintarla. Sin esto, la lista salta al llegar cada página: se dibuja
     * con una altura provisional y se recoloca al terminar.
     */
    suspend fun proporcion(indice: Int): Float {
        proporcionConocida(indice)?.let { return it }
        return withContext(Dispatchers.IO) { cerrojo.withLock { medir(indice) } }
    }

    /**
     * Mide todas las páginas que falten, una a una y soltando el cerrojo entre
     * cada una.
     *
     * Así una página que hay que pintar nunca espera más de una medida —el
     * `Mutex` es justo y atiende por orden de llegada—, y cuando se llega a una
     * página lejana con la barra de posición su hueco ya tiene la altura buena
     * y no salta al pintarse.
     */
    suspend fun medirTodas() = withContext(Dispatchers.IO) {
        for (indice in 0 until paginas) {
            if (!proporciones[indice].isNaN()) continue
            cerrojo.withLock { medir(indice) }
            yield()
        }
    }

    /** Con el cerrojo ya tomado. */
    private fun medir(indice: Int): Float {
        if (cerrado) throw CancellationException("Documento cerrado")
        proporcionConocida(indice)?.let { return it }
        val proporcion = renderer.openPage(indice).use { pagina ->
            if (pagina.width <= 0) 1.414f else pagina.height.toFloat() / pagina.width.toFloat()
        }
        proporciones[indice] = proporcion
        return proporcion
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
            if (cerrado) throw CancellationException("Documento cerrado")
            renderer.openPage(indice).use { pagina ->
                if (pagina.width > 0) proporciones[indice] = pagina.height.toFloat() / pagina.width.toFloat()
                val ancho = anchoPx.coerceAtLeast(1)
                val alto = (ancho.toFloat() * pagina.height / pagina.width).toInt().coerceAtLeast(1)
                val bitmap = Bitmap.createBitmap(ancho, alto, Bitmap.Config.ARGB_8888)
                bitmap.eraseColor(Color.WHITE)
                pagina.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                bitmap
            }
        }
    }

    /**
     * Cierra **esperando a que termine la página en curso**.
     *
     * Bloquea el hilo que llama, que es el principal al salir del lector, como
     * mucho lo que tarde en pintarse una página. Es el precio de no cerrar el
     * renderer nativo por debajo de un `render()`: eso no lanza una excepción,
     * tumba el proceso.
     */
    override fun close() {
        if (cerrado) return
        runBlocking {
            cerrojo.withLock {
                cerrado = true
                runCatching { renderer.close() }
                runCatching { descriptor.close() }
            }
        }
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
            /*
             * Si hay un fichero nuestro, se abre ése y no se mira la URI.
             *
             * Vale para los dos casos: la descarga de la biblioteca y la copia
             * de lo que llegó de otra aplicación. Un fichero propio siempre es
             * mejor apuesta que una URI prestada, que puede haber caducado.
             */
            val propio = documento.rutaFichero?.let(::File)
            if (propio != null && propio.exists()) {
                val descriptor = ParcelFileDescriptor.open(propio, ParcelFileDescriptor.MODE_READ_ONLY)
                return DocumentoPdf(descriptor, PdfRenderer(descriptor), null)
            }

            if (documento.origen == Origen.REMOTO) {
                if (documento.rutaFichero == null) {
                    throw IllegalStateException("Este libro todavía no se ha descargado")
                }
                throw IllegalStateException("La copia descargada ya no está")
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
 * Páginas ya pintadas, **una por página**: la más ancha que se haya pintado.
 *
 * El ancho estuvo en la clave, y cada nivel de zoom dejaba otra copia de la
 * misma página hasta que la LRU la echaba: tres zooms eran tres páginas de
 * memoria para enseñar una. Ahora quien pide mira el ancho de lo que hay; si
 * llega, lo usa —la GPU lo reduce al pintar—, y si no, lo enseña estirado
 * mientras pinta uno mejor que lo sustituye.
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

    fun obtener(documentoId: String, pagina: Int): Bitmap? = cache[clave(documentoId, pagina)]

    /** Sólo sustituye si lo nuevo es más ancho: nunca se cambia nítido por blando. */
    fun guardar(documentoId: String, pagina: Int, bitmap: Bitmap) {
        val clave = clave(documentoId, pagina)
        val actual = cache[clave]
        if (actual == null || actual.width < bitmap.width) cache.put(clave, bitmap)
    }

    fun vaciar() = cache.evictAll()

    private fun clave(documentoId: String, pagina: Int) = "$documentoId:$pagina"
}
