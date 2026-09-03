package site.triangulodelectores.lector.ui

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import site.triangulodelectores.lector.Contenedor
import site.triangulodelectores.lector.data.Sincronizador
import site.triangulodelectores.lector.data.local.Documento
import site.triangulodelectores.lector.data.local.Origen
import site.triangulodelectores.lector.data.local.Progreso
import site.triangulodelectores.lector.data.remote.FalloApi

data class EstadoEstanteria(
    val documentos: List<Documento> = emptyList(),
    val progresos: Map<String, Progreso> = emptyMap(),
    val cargando: Boolean = false,
    val sincronizando: Boolean = false,
    /** Documentos descargándose ahora mismo, con su porcentaje. */
    val descargas: Map<String, Int> = emptyMap(),
    val emparejado: Boolean = false,
    val aviso: String? = null,
    val pedirEmparejar: Boolean = false,
)

/**
 * La estantería: lo del teléfono y lo de la biblioteca, en una lista.
 *
 * Todo lo que se pinta sale de la base de datos local, nunca de la red. La
 * sincronización actualiza la base y la lista se recarga: así la aplicación
 * abre igual de rápido con red y sin ella, que es el caso para el que existe.
 */
class EstanteriaViewModel(private val contenedor: Contenedor) : ViewModel() {

    private val _estado = MutableStateFlow(EstadoEstanteria())
    val estado: StateFlow<EstadoEstanteria> = _estado.asStateFlow()

    init {
        recargar()
        if (contenedor.credenciales.emparejado) sincronizar(silencioso = true)
    }

    fun recargar() {
        viewModelScope.launch {
            _estado.update { it.copy(cargando = true) }
            val documentos = withContext(Dispatchers.IO) { contenedor.biblioteca.documentos() }
            val progresos = withContext(Dispatchers.IO) { contenedor.biblioteca.progresos() }
            _estado.update {
                it.copy(
                    documentos = documentos,
                    progresos = progresos,
                    cargando = false,
                    emparejado = contenedor.credenciales.emparejado,
                )
            }
        }
    }

    fun importar(uri: Uri) {
        viewModelScope.launch {
            runCatching { withContext(Dispatchers.IO) { contenedor.biblioteca.importarLocal(uri) } }
                .onFailure { e -> _estado.update { it.copy(aviso = "No se ha podido abrir ese archivo: ${e.message}") } }
            recargar()
        }
    }

    fun quitar(documento: Documento) {
        viewModelScope.launch {
            withContext(Dispatchers.IO) { contenedor.biblioteca.quitar(documento) }
            recargar()
        }
    }

    fun descargar(documento: Documento) {
        if (documento.origen != Origen.REMOTO) return
        viewModelScope.launch {
            _estado.update { it.copy(descargas = it.descargas + (documento.id to 0)) }
            val resultado = withContext(Dispatchers.IO) {
                runCatching {
                    contenedor.biblioteca.descargar(documento) { hechos, total ->
                        val porcentaje = if (total > 0) ((hechos * 100) / total).toInt() else 0
                        _estado.update { it.copy(descargas = it.descargas + (documento.id to porcentaje)) }
                    }
                }
            }
            _estado.update { it.copy(descargas = it.descargas - documento.id) }

            resultado.onFailure { fallo ->
                val mensaje = when (fallo) {
                    is FalloApi.SinRed -> "Sin conexión. La descarga continúa donde iba cuando vuelvas a intentarlo."
                    is FalloApi.Credencial -> "Hay que volver a emparejar este teléfono."
                    else -> fallo.message ?: "No se ha podido descargar"
                }
                _estado.update { it.copy(aviso = mensaje, pedirEmparejar = fallo is FalloApi.Credencial) }
            }
            recargar()
        }
    }

    fun sincronizar(silencioso: Boolean = false) {
        if (!contenedor.credenciales.emparejado) {
            if (!silencioso) _estado.update { it.copy(pedirEmparejar = true) }
            return
        }

        viewModelScope.launch {
            _estado.update { it.copy(sincronizando = true) }
            val resultado = withContext(Dispatchers.IO) { runCatching { contenedor.sincronizador.sincronizar() } }
            _estado.update { it.copy(sincronizando = false) }

            resultado
                .onSuccess { r ->
                    if (!silencioso) {
                        _estado.update {
                            it.copy(aviso = "Sincronizado: ${r.subidos} enviados, ${r.bajados} recibidos.")
                        }
                    }
                }
                .onFailure { fallo ->
                    val mensaje = when (fallo) {
                        is FalloApi.SinRed -> if (silencioso) null else "Sin conexión: se sincronizará cuando la haya."
                        is Sincronizador.CredencialCaducada -> "La credencial ha caducado. Vuelve a emparejar el teléfono."
                        else -> if (silencioso) null else fallo.message
                    }
                    _estado.update {
                        it.copy(aviso = mensaje, pedirEmparejar = fallo is Sincronizador.CredencialCaducada)
                    }
                }
            recargar()
        }
    }

    fun avisoVisto() = _estado.update { it.copy(aviso = null, pedirEmparejar = false) }
}
