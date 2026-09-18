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
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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
import site.triangulodelectores.lector.pdf.NotaIncrustada
import site.triangulodelectores.lector.pdf.Palabra
import site.triangulodelectores.lector.pdf.TextoPdf

/** Sin reducir por debajo del ancho de la pantalla: no hay nada que ver ahí. */
const val ZOOM_MINIMO = 1f

/**
 * Techo del zoom.
 *
 * Ocho aumentos, no cuatro. Cuatro se quedaba corto para una nota al pie o para
 * el detalle de una figura, que es justo cuando se amplía. El coste está
 * acotado aparte: el rasterizado tiene su propio techo en píxeles, así que
 * pasado cierto punto se estira lo pintado en vez de pintar más grande.
 */
const val ZOOM_MAXIMO = 8f

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
    /** Las notas que trae el PDF dentro, que no son nuestras y no se editan. */
    val notasIncrustadas: List<NotaIncrustada> = emptyList(),
    val notasIncrustadasLeidas: Boolean = false,
    val leyendoNotasIncrustadas: Boolean = false,
    /**
     * El documento no se ha dejado abrir para leer sus notas.
     *
     * Pasa con un PDF cifrado con contraseña o con uno roto, y hay que
     * distinguirlo de «no trae ninguna»: sin decirlo, un documento lleno de
     * comentarios que PDFBox no puede abrir se ve exactamente igual que uno
     * limpio, y no hay forma de saber cuál de las dos cosas es.
     */
    val notasIncrustadasIlegibles: Boolean = false,
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

    /**
     * La capa de texto, que es otro trato con el mismo fichero.
     *
     * `PdfRenderer` pinta y no lee; PDFBox lee y no pinta. Se abre **tarde**:
     * analizar un libro escaneado cuesta segundos y memoria, y quien sólo va a
     * leer no tiene por qué pagarlos. La primera palabra que se pide o la
     * primera vez que se abre el panel de notas es lo que lo abre.
     */
    private var texto: TextoPdf? = null
    private var textoIntentado = false
    private val cerrojoTexto = Mutex()

    private suspend fun capaDeTexto(): TextoPdf? = cerrojoTexto.withLock {
        if (!textoIntentado) {
            textoIntentado = true
            val documento = _estado.value.documento
            if (documento != null) {
                texto = withContext(Dispatchers.IO) { TextoPdf.abrir(contenedor.contexto, documento) }
            }
        }
        texto
    }

    /**
     * Las palabras de una página, con su sitio.
     *
     * Lista vacía significa «aquí no hay texto», que es lo normal en un
     * escaneado sin OCR y no un fallo: quien llama vuelve al recuadro a mano.
     */
    suspend fun palabrasDe(indice: Int): List<Palabra> =
        capaDeTexto()?.palabras(indice).orEmpty()

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

    /**
     * Cambia el zoom. Sin redondear: el valor es continuo.
     *
     * Estuvo redondeado a décimas mientras cada cambio obligaba a repintar todo
     * lo visible, y se notaba: el pellizco avanzaba a saltos. Ahora entre el
     * zoom que se ve y el que está pintado media una transformación de la GPU,
     * así que mover esto no cuesta nada y puede seguir al dedo.
     */
    fun cambiarZoom(zoom: Float) = _estado.update {
        it.copy(zoom = zoom.coerceIn(ZOOM_MINIMO, ZOOM_MAXIMO))
    }

    fun subrayar(pagina: Int, rect: Rect) {
        // Un recuadro de un par de píxeles es un toque mal interpretado, no un
        // subrayado: se descarta antes de guardarlo para no dejar la página
        // llena de marcas invisibles.
        if (rect.w < 0.01f || rect.h < 0.005f) return
        guardarSubrayado(pagina, listOf(rect), null)
    }

    /**
     * Subrayado sobre texto: un rectángulo por renglón y la cita escrita.
     *
     * Es lo mismo que guarda el lector web al arrastrar sobre la capa de texto
     * de pdf.js, y a propósito: un subrayado hecho en el teléfono tiene que
     * verse allí con las mismas palabras debajo.
     */
    fun subrayarTexto(pagina: Int, rects: List<Rect>, cita: String) {
        if (rects.isEmpty()) return
        guardarSubrayado(pagina, rects, cita)
    }

    private fun guardarSubrayado(pagina: Int, rects: List<Rect>, cita: String?) {
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                contenedor.biblioteca.crearSubrayado(
                    documentoId,
                    pagina,
                    rects,
                    _estado.value.colorActivo,
                    cita,
                )
            }
            recargarAnotaciones()
        }
    }

    /**
     * Lee las notas que el PDF trae dentro.
     *
     * Se pide al abrir el panel, no al abrir el libro: hay que recorrer las
     * anotaciones de todas las páginas y eso no puede colgarse de la apertura,
     * que es cuando alguien está esperando para leer.
     */
    fun leerNotasIncrustadas() {
        if (_estado.value.notasIncrustadasLeidas || _estado.value.leyendoNotasIncrustadas) return
        _estado.update { it.copy(leyendoNotasIncrustadas = true) }

        viewModelScope.launch {
            val capa = capaDeTexto()
            val notas = capa?.notas().orEmpty()
            _estado.update {
                it.copy(
                    notasIncrustadas = notas,
                    notasIncrustadasLeidas = true,
                    leyendoNotasIncrustadas = false,
                    notasIncrustadasIlegibles = capa == null,
                )
            }
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
        texto?.close()
        texto = null
        contenedor.cachePaginas.vaciar()
        super.onCleared()
    }
}
