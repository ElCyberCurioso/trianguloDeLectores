package site.triangulodelectores.lector.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import site.triangulodelectores.lector.Contenedor
import site.triangulodelectores.lector.data.remote.BorradorIsbnDto
import site.triangulodelectores.lector.data.remote.ContadoresDto
import site.triangulodelectores.lector.data.remote.FalloApi
import site.triangulodelectores.lector.data.remote.LibroDto
import site.triangulodelectores.lector.data.remote.LibroEnvioDto

/** Los estados de un libro, con su etiqueta. El orden es el del sitio. */
val ESTADOS_LIBRO = listOf(
    "OWNED" to "En casa",
    "READING" to "Leyendo",
    "READ" to "Leído",
    "LENT" to "Prestado",
    "WISHLIST" to "Lo quiero",
)

fun etiquetaEstado(estado: String): String =
    ESTADOS_LIBRO.firstOrNull { it.first == estado }?.second ?: estado

/**
 * Criterios de orden.
 *
 * Son los mismos identificadores que acepta el Worker, y ahí es donde se
 * ordena: la lista cerrada existe justamente para que el criterio elija un
 * comparador ya escrito y nunca una columna que venga de fuera.
 */
val ORDENES_BIBLIOTECA = listOf(
    "surname" to "Apellido",
    "title" to "Título",
    "recent" to "Añadido",
    "year" to "Año",
)

data class EstadoBiblioteca(
    val libros: List<LibroDto> = emptyList(),
    val contadores: ContadoresDto = ContadoresDto(),
    val busqueda: String = "",
    val estado: String = "ALL",
    val orden: String = "surname",
    val cargando: Boolean = false,
    val aviso: String? = null,
    val pedirEmparejar: Boolean = false,
)

/**
 * El catálogo en papel, desde el teléfono.
 *
 * A diferencia de la estantería, esto **no se guarda en local**: se lee de la
 * biblioteca cada vez. Es una decisión, no un olvido -- el catálogo se consulta
 * estando en casa y delante de las baldas, se edita poco y son doscientas
 * fichas de texto; una copia local añadiría otra sincronización que mantener a
 * cambio de muy poco.
 */
class BibliotecaViewModel(private val contenedor: Contenedor) : ViewModel() {

    private val _estado = MutableStateFlow(EstadoBiblioteca())
    val estado: StateFlow<EstadoBiblioteca> = _estado.asStateFlow()

    /** Portadas ya descargadas. Se piden con el token, como todo lo demás. */
    private val portadas = object : LruCache<String, Bitmap>(12 * 1024) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount / 1024
    }

    private val pedidas = mutableSetOf<String>()
    private val _revision = MutableStateFlow(0)

    /** Sube cada vez que llega una portada, para que la lista se repinte. */
    val revision: StateFlow<Int> = _revision.asStateFlow()

    private var busquedaDiferida: Job? = null

    init {
        if (contenedor.credenciales.emparejado) recargar()
    }

    fun recargar() {
        if (!contenedor.credenciales.emparejado) {
            _estado.update { it.copy(pedirEmparejar = true) }
            return
        }
        viewModelScope.launch {
            _estado.update { it.copy(cargando = true) }
            val actual = _estado.value
            val resultado = withContext(Dispatchers.IO) {
                runCatching { contenedor.api.biblioteca(actual.busqueda, actual.estado, actual.orden) }
            }
            resultado
                .onSuccess { lista ->
                    _estado.update {
                        it.copy(libros = lista.books, contadores = lista.counters, cargando = false)
                    }
                }
                .onFailure { fallo ->
                    _estado.update {
                        it.copy(
                            cargando = false,
                            aviso = mensaje(fallo),
                            pedirEmparejar = fallo is FalloApi.Credencial,
                        )
                    }
                }
        }
    }

    /**
     * Buscar mientras se escribe, pero sin una petición por tecla: se espera a
     * que la mano pare. Trescientos milisegundos es lo que se tarda en dudar.
     */
    fun buscar(texto: String) {
        _estado.update { it.copy(busqueda = texto) }
        busquedaDiferida?.cancel()
        busquedaDiferida = viewModelScope.launch {
            delay(300)
            recargar()
        }
    }

    fun filtrarPor(estado: String) {
        _estado.update { it.copy(estado = estado) }
        recargar()
    }

    fun ordenarPor(orden: String) {
        _estado.update { it.copy(orden = orden) }
        recargar()
    }

    /** Consulta un ISBN. El título devuelto no es un fallo: avisa de duplicado. */
    suspend fun consultarIsbn(isbn: String): Result<Pair<BorradorIsbnDto?, String?>> =
        withContext(Dispatchers.IO) {
            runCatching {
                val respuesta = contenedor.api.consultarIsbn(isbn)
                respuesta.draft to respuesta.existing?.title
            }
        }

    fun guardar(id: String?, libro: LibroEnvioDto, alTerminar: (Boolean) -> Unit) {
        viewModelScope.launch {
            val resultado = withContext(Dispatchers.IO) {
                runCatching {
                    if (id == null) {
                        contenedor.api.crearLibro(libro)
                    } else {
                        contenedor.api.actualizarLibro(id, libro)
                    }
                }
            }
            resultado
                .onSuccess {
                    _estado.update { e ->
                        e.copy(aviso = if (id == null) "Añadido «${libro.title}»." else "Guardado.")
                    }
                    recargar()
                    alTerminar(true)
                }
                .onFailure { fallo ->
                    _estado.update { it.copy(aviso = mensaje(fallo)) }
                    alTerminar(false)
                }
        }
    }

    fun borrar(libro: LibroDto) {
        viewModelScope.launch {
            val resultado = withContext(Dispatchers.IO) { runCatching { contenedor.api.borrarLibro(libro.id) } }
            resultado
                .onSuccess {
                    _estado.update { it.copy(aviso = "Borrado «${libro.title}».") }
                    recargar()
                }
                .onFailure { fallo -> _estado.update { it.copy(aviso = mensaje(fallo)) } }
        }
    }

    /**
     * Portada de un libro, si ya está descargada.
     *
     * Devuelve lo que hay y, si no hay nada, la pide de fondo. Pedirla desde el
     * propio dibujo evita traerse las doscientas de golpe: sólo se descarga lo
     * que llega a verse.
     */
    fun portada(libro: LibroDto): Bitmap? {
        val ruta = libro.coverUrl ?: return null
        portadas[ruta]?.let { return it }

        if (pedidas.add(ruta)) {
            viewModelScope.launch {
                val mapa = withContext(Dispatchers.IO) {
                    contenedor.api.portada(ruta)?.let { bytes ->
                        runCatching { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }.getOrNull()
                    }
                }
                if (mapa != null) {
                    portadas.put(ruta, mapa)
                    _revision.update { it + 1 }
                }
            }
        }
        return null
    }

    fun avisoVisto() = _estado.update { it.copy(aviso = null, pedirEmparejar = false) }

    private fun mensaje(fallo: Throwable): String = when (fallo) {
        is FalloApi.SinRed -> "No hay conexión con la biblioteca."
        is FalloApi.Credencial -> "Hay que volver a emparejar este teléfono."
        else -> fallo.message ?: "No se ha podido completar la operación."
    }
}
