package site.triangulodelectores.lector.ui

import androidx.lifecycle.SavedStateHandle
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
import site.triangulodelectores.lector.pdf.Coincidencia
import site.triangulodelectores.lector.pdf.DocumentoPdf
import site.triangulodelectores.lector.pdf.EntradaIndice
import site.triangulodelectores.lector.pdf.buscarEnPagina
import site.triangulodelectores.lector.pdf.normalizarBusqueda
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

private const val CLAVE_ZOOM = "zoom"

/**
 * Techo de resultados de una búsqueda.
 *
 * Buscar «de» en un libro da miles, y ninguna lista de miles sirve para nada:
 * pasado el techo se para y se pide afinar. También acota la memoria y el
 * trabajo de pintar los resaltados.
 */
const val MAX_RESULTADOS = 500

/**
 * El color del papel. El documento se pinta igual; lo cambia un filtro de
 * color al dibujarlo, así que cambiar de papel no repinta nada.
 */
enum class Papel { BLANCO, SEPIA, NOCHE }

/** Por debajo de esto se encuentra media página de cada página. */
const val MINIMO_BUSQUEDA = 2

/**
 * Una búsqueda en el documento, en curso o terminada.
 *
 * Los resultados llegan **mientras se busca**, página a página: en un libro
 * largo el recorrido entero tarda, y lo que ya ha aparecido se puede mirar sin
 * esperar al final.
 */
data class EstadoBusqueda(
    val consulta: String = "",
    val resultados: List<Coincidencia> = emptyList(),
    /** El resultado que se está mirando, o -1 si todavía ninguno. */
    val actual: Int = -1,
    val buscando: Boolean = false,
    val revisadas: Int = 0,
    val total: Int = 0,
    /** Se llegó a [MAX_RESULTADOS] y se dejó de buscar. */
    val truncada: Boolean = false,
    /** Terminó sin encontrar ni una letra: es un escaneado sin texto. */
    val sinTexto: Boolean = false,
    /** PDFBox no ha podido abrir el documento: cifrado o roto. */
    val ilegible: Boolean = false,
)

data class EstadoLector(
    val documento: Documento? = null,
    val paginas: Int = 0,
    val progresoInicial: Progreso? = null,
    val anotaciones: List<Anotacion> = emptyList(),
    val marcadores: List<Marcador> = emptyList(),
    val paginaVisible: Int = 1,
    /**
     * Fracción de la página visible arriba, en milésimas.
     *
     * Va en el estado y no en un campo privado porque la pantalla la necesita
     * para recolocarse: al girar el teléfono, Android rehace la actividad y la
     * composición empieza de cero, pero este modelo sobrevive. Es la única
     * memoria de por dónde iba la lectura en ese momento.
     */
    val scrollVisible: Int = 0,
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
    val papel: Papel = Papel.BLANCO,
    /**
     * El último subrayado hecho, para poder deshacerlo. Se vacía al deshacer o
     * cuando el aviso desaparece: deshacer es de lo que se acaba de hacer, no
     * de cualquier cosa de antes.
     */
    val ultimoSubrayado: String? = null,
    /** Nula cuando no se está buscando. Con ella, la barra es la de búsqueda. */
    val busqueda: EstadoBusqueda? = null,
    val indice: List<EntradaIndice> = emptyList(),
    val indiceLeido: Boolean = false,
    val leyendoIndice: Boolean = false,
    /** Mismo caso que con las notas: no es lo mismo que «no trae índice». */
    val indiceIlegible: Boolean = false,
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
    /** Lo que tiene que sobrevivir a que Android mate el proceso: el zoom. */
    private val guardado: SavedStateHandle,
) : ViewModel() {

    private val _estado = MutableStateFlow(
        EstadoLector(
            zoom = (guardado.get<Float>(CLAVE_ZOOM) ?: 1f).coerceIn(ZOOM_MINIMO, ZOOM_MAXIMO),
            papel = Papel.entries.firstOrNull { it.name == contenedor.ajustes.papel } ?: Papel.BLANCO,
        ),
    )
    val estado: StateFlow<EstadoLector> = _estado.asStateFlow()

    /** El PDF abierto. Lo consume la pantalla para pintar cada página. */
    var pdf: DocumentoPdf? = null
        private set

    private var guardadoDiferido: Job? = null
    private var busquedaEnCurso: Job? = null

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
                    /*
                     * Las proporciones de todas las páginas, de fondo. Va por
                     * delante de la lectura sin estorbarla —suelta el cerrojo
                     * entre página y página—, y cuando se salta lejos con la
                     * barra de posición el hueco ya tiene su altura.
                     */
                    viewModelScope.launch { runCatching { doc.medirTodas() } }
                    contenedor.biblioteca.anotarPaginas(documento, doc.paginas)
                    val progreso = contenedor.biblioteca.progreso(documentoId)
                    _estado.update {
                        it.copy(
                            documento = documento,
                            paginas = doc.paginas,
                            progresoInicial = progreso,
                            // La posición viva **arranca** donde se dejó la
                            // lectura. Sin sembrarla, la pantalla tendría que
                            // mirar `progresoInicial` para colocarse, y ése no
                            // se mueve en toda la sesión: cada vez que la
                            // composición se rehace —girar el teléfono la
                            // rehace entera— devolvería al punto de apertura.
                            paginaVisible = progreso?.pagina ?: it.paginaVisible,
                            scrollVisible = progreso?.scrollMilesimas ?: it.scrollVisible,
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
        _estado.update { it.copy(paginaVisible = pagina, scrollVisible = scrollMilesimas) }

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

    fun elegirPapel(papel: Papel) {
        _estado.update { it.copy(papel = papel) }
        contenedor.ajustes.papel = papel.name
    }

    /** Borra el subrayado que se acaba de hacer. Es un borrado lógico, como cualquier otro. */
    fun deshacerSubrayado() {
        val id = _estado.value.ultimoSubrayado ?: return
        _estado.update { it.copy(ultimoSubrayado = null) }
        borrarAnotacion(id)
    }

    fun olvidarDeshacer() = _estado.update { it.copy(ultimoSubrayado = null) }

    /**
     * Cambia el zoom. Sin redondear: el valor es continuo.
     *
     * Estuvo redondeado a décimas mientras cada cambio obligaba a repintar todo
     * lo visible, y se notaba: el pellizco avanzaba a saltos. Ahora entre el
     * zoom que se ve y el que está pintado media una transformación de la GPU,
     * así que mover esto no cuesta nada y puede seguir al dedo.
     */
    fun cambiarZoom(zoom: Float) {
        val acotado = zoom.coerceIn(ZOOM_MINIMO, ZOOM_MAXIMO)
        _estado.update { it.copy(zoom = acotado) }
        guardado[CLAVE_ZOOM] = acotado
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
            val creado = withContext(Dispatchers.IO) {
                contenedor.biblioteca.crearSubrayado(
                    documentoId,
                    pagina,
                    rects,
                    _estado.value.colorActivo,
                    cita,
                )
            }
            recargarAnotaciones()
            _estado.update { it.copy(ultimoSubrayado = creado.id) }
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

    /** Abre la barra de búsqueda sin buscar nada todavía. */
    fun empezarBusqueda() {
        if (_estado.value.busqueda != null) return
        // Las dos cosas a la vez no: en modo subrayado el arrastre marca, y
        // la búsqueda lleva a sitios donde lo normal es querer leer.
        _estado.update { it.copy(busqueda = EstadoBusqueda(), modoSubrayado = false) }
    }

    /**
     * Busca en todo el documento, de la primera página a la última.
     *
     * Va página a página por la capa de texto, que suelta el cerrojo entre una
     * y otra: si a media búsqueda se subraya algo, el subrayado no espera a que
     * termine. Una búsqueda nueva cancela la anterior.
     */
    fun buscar(consulta: String) {
        busquedaEnCurso?.cancel()
        val texto = consulta.trim()
        val total = _estado.value.paginas
        if (normalizarBusqueda(texto).length < MINIMO_BUSQUEDA || total == 0) {
            _estado.update { it.copy(busqueda = EstadoBusqueda(consulta = texto, total = total)) }
            return
        }
        _estado.update {
            it.copy(
                modoSubrayado = false,
                busqueda = EstadoBusqueda(consulta = texto, buscando = true, total = total),
            )
        }
        busquedaEnCurso = viewModelScope.launch {
            val capa = capaDeTexto()
            if (capa == null) {
                actualizarBusqueda { it.copy(buscando = false, ilegible = true) }
                return@launch
            }
            val encontrados = mutableListOf<Coincidencia>()
            var conTexto = false
            var truncada = false
            for (indice in 0 until total) {
                val palabras = capa.palabras(indice)
                if (palabras.isNotEmpty()) conTexto = true
                val aqui = buscarEnPagina(palabras, texto, indice + 1)
                encontrados += aqui
                if (encontrados.size >= MAX_RESULTADOS) {
                    truncada = true
                    while (encontrados.size > MAX_RESULTADOS) encontrados.removeAt(encontrados.lastIndex)
                }
                // Se publica cuando hay algo nuevo y, si no, cada pocas
                // páginas: lo bastante para que el contador avance a la vista
                // sin recomponer la barra por cada página vacía.
                if (aqui.isNotEmpty() || indice % 8 == 7 || truncada) {
                    val copia = encontrados.toList()
                    actualizarBusqueda { it.copy(resultados = copia, revisadas = indice + 1) }
                }
                if (truncada) break
            }
            val copia = encontrados.toList()
            actualizarBusqueda {
                it.copy(
                    resultados = copia,
                    revisadas = if (truncada) it.revisadas else total,
                    buscando = false,
                    truncada = truncada,
                    sinTexto = !conTexto,
                )
            }
        }
    }

    /** Sólo si la búsqueda sigue abierta: cerrarla a medias no la reabre. */
    private fun actualizarBusqueda(cambio: (EstadoBusqueda) -> EstadoBusqueda) =
        _estado.update { estado -> estado.busqueda?.let { estado.copy(busqueda = cambio(it)) } ?: estado }

    /**
     * El resultado siguiente al que se está mirando.
     *
     * La primera vez no es el primero del documento, sino **el primero desde la
     * página donde se está**: quien busca a mitad de libro quiere lo que viene,
     * no volver al principio. Al final da la vuelta.
     */
    fun siguienteResultado(paginaActual: Int): Coincidencia? = elegirResultado { busqueda ->
        val resultados = busqueda.resultados
        if (busqueda.actual < 0) {
            resultados.indexOfFirst { it.pagina >= paginaActual }.takeIf { it >= 0 } ?: 0
        } else {
            (busqueda.actual + 1) % resultados.size
        }
    }

    fun anteriorResultado(paginaActual: Int): Coincidencia? = elegirResultado { busqueda ->
        val resultados = busqueda.resultados
        if (busqueda.actual < 0) {
            resultados.indexOfLast { it.pagina <= paginaActual }.takeIf { it >= 0 } ?: resultados.lastIndex
        } else {
            (busqueda.actual - 1 + resultados.size) % resultados.size
        }
    }

    fun irAResultado(posicion: Int): Coincidencia? = elegirResultado { posicion }

    private fun elegirResultado(cual: (EstadoBusqueda) -> Int): Coincidencia? {
        val busqueda = _estado.value.busqueda ?: return null
        if (busqueda.resultados.isEmpty()) return null
        val elegido = cual(busqueda).coerceIn(0, busqueda.resultados.lastIndex)
        actualizarBusqueda { it.copy(actual = elegido) }
        return busqueda.resultados[elegido]
    }

    fun cerrarBusqueda() {
        busquedaEnCurso?.cancel()
        busquedaEnCurso = null
        _estado.update { it.copy(busqueda = null) }
    }

    /**
     * Lee el índice del PDF.
     *
     * Al abrir el salto de página, no al abrir el libro: el índice sale de la
     * capa de texto, y abrirla cuesta lo que cuesta en un escaneado grande.
     */
    fun leerIndice() {
        if (_estado.value.indiceLeido || _estado.value.leyendoIndice) return
        _estado.update { it.copy(leyendoIndice = true) }
        viewModelScope.launch {
            val capa = capaDeTexto()
            val indice = capa?.indice().orEmpty()
            _estado.update {
                it.copy(
                    indice = indice,
                    indiceLeido = true,
                    leyendoIndice = false,
                    indiceIlegible = capa == null,
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

    /**
     * Cambia el texto de una nota **sin tocarle el color**.
     *
     * Estaba escrito con el color activo, y nadie lo llamaba: el día que se le
     * puso botón, corregir una errata en una nota amarilla la habría vuelto del
     * color con el que se estuviera subrayando en ese momento.
     */
    fun editarNota(anotacion: Anotacion, texto: String) {
        if (texto.isBlank()) return
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                contenedor.biblioteca.editarAnotacion(anotacion.id, texto.trim(), anotacion.color)
            }
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
                contenedor.biblioteca.guardarProgreso(
                    documentoId,
                    posicion.paginaVisible,
                    posicion.scrollVisible,
                )
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
