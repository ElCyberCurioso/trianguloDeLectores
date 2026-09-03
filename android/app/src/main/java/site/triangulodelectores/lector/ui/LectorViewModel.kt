package site.triangulodelectores.lector.ui

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
import site.triangulodelectores.lector.data.local.Anotacion
import site.triangulodelectores.lector.data.local.ColorAnotacion
import site.triangulodelectores.lector.data.local.Documento
import site.triangulodelectores.lector.data.local.Marcador
import site.triangulodelectores.lector.data.local.Origen
import site.triangulodelectores.lector.data.local.Progreso
import site.triangulodelectores.lector.data.local.Rect
import site.triangulodelectores.lector.pdf.DocumentoPdf

data class EstadoLector(
    val documento: Documento? = null,
    val paginas: Int = 0,
    val progresoInicial: Progreso? = null,
    val anotaciones: List<Anotacion> = emptyList(),
    val marcadores: List<Marcador> = emptyList(),
    val paginaVisible: Int = 1,
    val modoSubrayado: Boolean = false,
    val colorActivo: ColorAnotacion = ColorAnotacion.YELLOW,
    val zoom: Float = 1f,
    val cargando: Boolean = true,
    val error: String? = null,
)

/**
 * El lector.
 *
 * Guarda la posición **de forma diferida**, no en cada píxel de scroll: una
 * escritura en SQLite por cada fotograma dejaría el desplazamiento a tirones y
 * no serviría para nada, porque lo que importa es dónde se dejó de leer, no el
 * recorrido. Un segundo de quietud basta para considerar que ahí se está.
 */
class LectorViewModel(
    private val contenedor: Contenedor,
    private val documentoId: String,
) : ViewModel() {

    private val _estado = MutableStateFlow(EstadoLector())
    val estado: StateFlow<EstadoLector> = _estado.asStateFlow()

    /** El PDF abierto. Lo consume la pantalla para pintar cada página. */
    var pdf: DocumentoPdf? = null
        private set

    private var guardadoDiferido: Job? = null

    /** Última fracción de página vista. Se conserva para no perderla al salir. */
    private var ultimoScroll = 0

    init {
        abrir()
    }

    private fun abrir() {
        viewModelScope.launch {
            val documento = withContext(Dispatchers.IO) { contenedor.biblioteca.documento(documentoId) }
            if (documento == null) {
                _estado.update { it.copy(cargando = false, error = "Este documento ya no está en la estantería") }
                return@launch
            }

            val abierto = withContext(Dispatchers.IO) {
                runCatching { DocumentoPdf.abrir(contenedor.contexto, documento) }
            }

            abierto
                .onSuccess { doc ->
                    pdf = doc
                    contenedor.biblioteca.anotarPaginas(documento, doc.paginas)
                    _estado.update {
                        it.copy(
                            documento = documento,
                            paginas = doc.paginas,
                            progresoInicial = contenedor.biblioteca.progreso(documentoId),
                            anotaciones = contenedor.biblioteca.anotaciones(documentoId),
                            marcadores = contenedor.biblioteca.marcadores(documentoId),
                            cargando = false,
                        )
                    }
                }
                .onFailure { fallo ->
                    _estado.update {
                        it.copy(
                            documento = documento,
                            cargando = false,
                            error = fallo.message ?: "No se ha podido abrir el documento",
                        )
                    }
                }
        }
    }

    /** Llamado al desplazarse. Actualiza la página visible y difiere el guardado. */
    fun posicion(pagina: Int, scrollMilesimas: Int) {
        if (pagina < 1) return
        _estado.update { it.copy(paginaVisible = pagina) }
        ultimoScroll = scrollMilesimas

        guardadoDiferido?.cancel()
        guardadoDiferido = viewModelScope.launch {
            delay(1000)
            withContext(Dispatchers.IO) {
                contenedor.biblioteca.guardarProgreso(documentoId, pagina, scrollMilesimas)
            }
        }
    }

    fun alternarModoSubrayado() = _estado.update { it.copy(modoSubrayado = !it.modoSubrayado) }

    fun elegirColor(color: ColorAnotacion) = _estado.update { it.copy(colorActivo = color) }

    fun cambiarZoom(zoom: Float) = _estado.update { it.copy(zoom = zoom.coerceIn(1f, 4f)) }

    fun subrayar(pagina: Int, rect: Rect) {
        // Un recuadro de un par de píxeles es un toque mal interpretado, no un
        // subrayado: se descarta antes de guardarlo para no dejar la página
        // llena de marcas invisibles.
        if (rect.w < 0.01f || rect.h < 0.005f) return

        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                contenedor.biblioteca.crearSubrayado(documentoId, pagina, listOf(rect), _estado.value.colorActivo)
            }
            recargarAnotaciones()
        }
    }

    fun anotar(pagina: Int, texto: String) {
        if (texto.isBlank()) return
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                contenedor.biblioteca.crearNota(documentoId, pagina, texto.trim(), _estado.value.colorActivo)
            }
            recargarAnotaciones()
        }
    }

    fun editarNota(id: String, texto: String) {
        viewModelScope.launch {
            withContext(Dispatchers.IO) { contenedor.biblioteca.editarAnotacion(id, texto.trim(), _estado.value.colorActivo) }
            recargarAnotaciones()
        }
    }

    fun borrarAnotacion(id: String) {
        viewModelScope.launch {
            withContext(Dispatchers.IO) { contenedor.biblioteca.borrarAnotacion(id) }
            recargarAnotaciones()
        }
    }

    fun alternarMarcador(pagina: Int) {
        viewModelScope.launch {
            withContext(Dispatchers.IO) { contenedor.biblioteca.alternarMarcador(documentoId, pagina) }
            _estado.update {
                it.copy(marcadores = contenedor.biblioteca.marcadores(documentoId))
            }
        }
    }

    private suspend fun recargarAnotaciones() {
        val anotaciones = withContext(Dispatchers.IO) { contenedor.biblioteca.anotaciones(documentoId) }
        _estado.update { it.copy(anotaciones = anotaciones) }
    }

    /**
     * Al salir del libro se intenta sincronizar, sin esperar ni avisar.
     *
     * Es el momento en el que hay algo nuevo que contar y en el que a nadie le
     * molesta que se gaste un segundo de red. Si no hay cobertura no pasa nada:
     * lo pendiente sigue marcado y sube en la siguiente vuelta.
     */
    fun alSalir() {
        guardadoDiferido?.cancel()
        val posicion = _estado.value
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                contenedor.biblioteca.guardarProgreso(documentoId, posicion.paginaVisible, ultimoScroll)
                if (posicion.documento?.origen == Origen.REMOTO && contenedor.credenciales.emparejado) {
                    runCatching { contenedor.sincronizador.sincronizar() }
                }
            }
        }
    }

    override fun onCleared() {
        pdf?.close()
        pdf = null
        contenedor.cachePaginas.vaciar()
        super.onCleared()
    }
}
