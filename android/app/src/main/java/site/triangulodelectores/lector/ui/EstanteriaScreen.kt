package site.triangulodelectores.lector.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import site.triangulodelectores.lector.data.local.Documento
import site.triangulodelectores.lector.data.local.Origen

/**
 * Pantalla principal.
 *
 * Un documento se pinta igual venga de donde venga: lo que cambia es una
 * etiqueta y, en los de la biblioteca, si hay copia descargada. Ordenados por
 * lo leído hace menos, como la estantería del sitio.
 */
@Composable
fun EstanteriaScreen(
    modelo: EstanteriaViewModel,
    alAbrir: (Documento) -> Unit,
    alIrAAjustes: () -> Unit,
) {
    val estado by modelo.estado.collectAsState()
    val avisos = remember { SnackbarHostState() }

    val selector = rememberLauncherForActivityResult(
        // `OpenDocument` y no `GetContent`: es el único que da una URI sobre la
        // que se puede pedir permiso persistente. Con la otra, la estantería se
        // queda llena de documentos que no se pueden abrir tras reiniciar.
        contract = ActivityResultContracts.OpenDocument(),
    ) { uri -> uri?.let(modelo::importar) }

    LaunchedEffect(estado.aviso) {
        estado.aviso?.let {
            avisos.showSnackbar(it)
            modelo.avisoVisto()
        }
    }

    Scaffold(snackbarHost = { SnackbarHost(avisos) }) { relleno ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(relleno),
        ) {
            CabeceraEstanteria(
                sincronizando = estado.sincronizando,
                emparejado = estado.emparejado,
                alAbrirPdf = { selector.launch(arrayOf("application/pdf")) },
                alSincronizar = { modelo.sincronizar() },
                alIrAAjustes = alIrAAjustes,
            )

            if (estado.documentos.isEmpty() && !estado.cargando) {
                EstanteriaVacia(
                    emparejado = estado.emparejado,
                    alAbrirPdf = { selector.launch(arrayOf("application/pdf")) },
                    alIrAAjustes = alIrAAjustes,
                )
            } else {
                LazyColumn(Modifier.fillMaxSize()) {
                    items(estado.documentos, key = { it.id }) { documento ->
                        FilaDocumento(
                            documento = documento,
                            paginaActual = estado.progresos[documento.id]?.pagina,
                            descarga = estado.descargas[documento.id],
                            alAbrir = {
                                if (documento.disponible) alAbrir(documento) else modelo.descargar(documento)
                            },
                            alDescargar = { modelo.descargar(documento) },
                            alQuitar = { modelo.quitar(documento) },
                        )
                        ReglaFina()
                    }
                }
            }
        }
    }
}

@Composable
private fun CabeceraEstanteria(
    sincronizando: Boolean,
    emparejado: Boolean,
    alAbrirPdf: () -> Unit,
    alSincronizar: () -> Unit,
    alIrAAjustes: () -> Unit,
) {
    Column {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("Triángulo de Lectores", style = MaterialTheme.typography.headlineSmall)
                Spacer(Modifier.height(6.dp))
                MarcaTresReglas(ancho = 72)
            }
            Text(
                "Ajustes",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier
                    .clickable(onClick = alIrAAjustes)
                    // 44 dp de alto en lo que se pulsa, como en el sitio.
                    .padding(horizontal = 12.dp, vertical = 12.dp),
            )
        }

        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            BotonPrimario("Abrir un PDF del teléfono", alAbrirPdf, Modifier.weight(1f))
            if (emparejado) {
                BotonSecundario(
                    if (sincronizando) "Sincronizando…" else "Sincronizar",
                    alSincronizar,
                    activo = !sincronizando,
                )
            }
        }
        Spacer(Modifier.height(12.dp))
        ReglaGruesa()
    }
}

@Composable
private fun EstanteriaVacia(emparejado: Boolean, alAbrirPdf: () -> Unit, alIrAAjustes: () -> Unit) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("La estantería está vacía", style = MaterialTheme.typography.headlineSmall)
        Text(
            "Abre un PDF del teléfono para leerlo aquí. Lo que subrayes y las páginas que marques " +
                "se guardan en el propio dispositivo y no salen de él.",
            style = MaterialTheme.typography.bodyMedium,
        )
        BotonPrimario("Abrir un PDF del teléfono", alAbrirPdf)

        if (!emparejado) {
            ReglaFina()
            Text("¿Tienes libros en la biblioteca privada?", style = MaterialTheme.typography.titleMedium)
            Text(
                "Empareja el teléfono con tu cuenta y los tendrás aquí, con la lectura sincronizada " +
                    "en los dos sitios.",
                style = MaterialTheme.typography.bodyMedium,
            )
            BotonSecundario("Emparejar con la biblioteca", alIrAAjustes)
        }
    }
}

@Composable
private fun FilaDocumento(
    documento: Documento,
    paginaActual: Int?,
    descarga: Int?,
    alAbrir: () -> Unit,
    alDescargar: () -> Unit,
    alQuitar: () -> Unit,
) {
    var menuAbierto by remember { mutableStateOf(false) }

    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = alAbrir)
            .padding(16.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Column(Modifier.weight(1f)) {
            Text(documento.titulo, style = MaterialTheme.typography.titleMedium)
            documento.autor?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(6.dp))
            Text(
                metadatos(documento, paginaActual),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (descarga != null) {
                Spacer(Modifier.height(8.dp))
                LinearProgressIndicator(
                    progress = { descarga / 100f },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(2.dp),
                )
            } else if (documento.origen == Origen.REMOTO && !documento.disponible) {
                Spacer(Modifier.height(8.dp))
                Text(
                    "Sin descargar · toca para traerlo",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }

        Box {
            Text(
                "···",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.ExtraBold,
                modifier = Modifier
                    .clickable { menuAbierto = true }
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            )
            DropdownMenu(expanded = menuAbierto, onDismissRequest = { menuAbierto = false }) {
                if (documento.origen == Origen.REMOTO) {
                    DropdownMenuItem(
                        text = { Text(if (documento.disponible) "Volver a descargar" else "Descargar") },
                        onClick = { menuAbierto = false; alDescargar() },
                    )
                }
                DropdownMenuItem(
                    text = {
                        Text(
                            if (documento.origen == Origen.LOCAL) "Quitar de la estantería" else "Borrar la copia del teléfono",
                        )
                    },
                    onClick = { menuAbierto = false; alQuitar() },
                )
            }
        }
    }
}

private fun metadatos(documento: Documento, paginaActual: Int?): String {
    val trozos = buildList {
        add(if (documento.origen == Origen.LOCAL) "En el teléfono" else "Biblioteca")
        documento.paginas?.let { paginas ->
            add(if (paginaActual != null) "página $paginaActual de $paginas" else "$paginas páginas")
        }
        formatearTamano(documento.tamanoBytes).takeIf { it.isNotBlank() }?.let(::add)
    }
    return trozos.joinToString(" · ")
}
