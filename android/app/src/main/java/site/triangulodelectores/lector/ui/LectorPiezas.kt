package site.triangulodelectores.lector.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import site.triangulodelectores.lector.data.local.Anotacion
import site.triangulodelectores.lector.data.local.ColorAnotacion
import site.triangulodelectores.lector.data.local.TipoAnotacion

/**
 * Barra del lector.
 *
 * Los controles son texto, no iconos sueltos: en una barra de siete cosas, un
 * icono sin etiqueta es una adivinanza. Todos tienen 44 dp de alto de zona
 * pulsable, que es lo que pide una pantalla táctil y el mínimo de WCAG 2.2 con
 * margen.
 */
@Composable
fun BarraLector(
    titulo: String,
    pagina: Int,
    paginas: Int,
    marcada: Boolean,
    modoSubrayado: Boolean,
    zoom: Float,
    alVolver: () -> Unit,
    alMarcar: () -> Unit,
    alSubrayar: () -> Unit,
    alAnotar: () -> Unit,
    alZoom: (Float) -> Unit,
    alVerAnotaciones: () -> Unit,
) {
    Column(Modifier.background(MaterialTheme.colorScheme.surface)) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ControlTexto("Volver", alVolver)
            Column(Modifier.weight(1f).padding(horizontal = 8.dp)) {
                Text(
                    titulo,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                )
                if (paginas > 0) {
                    Text(
                        "Página $pagina de $paginas",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            ControlTexto(if (marcada) "Marcada" else "Marcar", alMarcar, activo = marcada)
        }

        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ControlTexto("Subrayar", alSubrayar, activo = modoSubrayado)
            ControlTexto("Nota", alAnotar)
            ControlTexto("Notas", alVerAnotaciones)
            Box(Modifier.weight(1f))
            // Paso multiplicativo, no aditivo: de 1 a 8 en sumas de medio punto
            // son catorce toques, y el salto que se percibe al ampliar no es el
            // mismo al principio que al final.
            ControlTexto("−", { alZoom(zoom / PASO_ZOOM) })
            Text(
                "${(zoom * 100).toInt()} %",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            ControlTexto("+", { alZoom(zoom * PASO_ZOOM) })
        }

        ReglaGruesa()
    }
}

/** Lo que cambia el zoom cada toque de los botones. */
private const val PASO_ZOOM = 1.5f

/** Control de barra. En rojo cuando está activo: el acento significa algo. */
@Composable
private fun ControlTexto(texto: String, onClick: () -> Unit, activo: Boolean = false) {
    Text(
        texto,
        style = MaterialTheme.typography.labelLarge,
        color = if (activo) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
        modifier = Modifier
            .heightIn(min = 44.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 12.dp),
    )
}

/**
 * Todo lo escrito sobre el documento, en un sitio.
 *
 * Es el equivalente del panel lateral del lector web. Sirve para lo que de
 * verdad se hace con las notas: repasarlas seguidas y volver a la página donde
 * estaban.
 */
@Composable
fun PanelAnotaciones(
    anotaciones: List<Anotacion>,
    marcadores: List<Int>,
    alCerrar: () -> Unit,
    alIrA: (Int) -> Unit,
    alBorrar: (String) -> Unit,
) {
    AlertDialog(
        onDismissRequest = alCerrar,
        title = { Text("Notas y subrayados", style = MaterialTheme.typography.titleMedium) },
        text = {
            if (anotaciones.isEmpty() && marcadores.isEmpty()) {
                Text(
                    "Todavía no hay nada. Pulsa «Subrayar» y arrastra sobre la página, o «Nota» " +
                        "para escribir algo en la página que estás leyendo.",
                    style = MaterialTheme.typography.bodyMedium,
                )
            } else {
                LazyColumn(Modifier.heightIn(max = 420.dp)) {
                    if (marcadores.isNotEmpty()) {
                        item {
                            Text(
                                "Páginas marcadas",
                                style = MaterialTheme.typography.titleSmall,
                                modifier = Modifier.padding(vertical = 8.dp),
                            )
                        }
                        item {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                marcadores.sorted().forEach { pagina ->
                                    Text(
                                        "$pagina",
                                        style = MaterialTheme.typography.labelLarge,
                                        color = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier
                                            .clickable { alIrA(pagina) }
                                            .padding(horizontal = 10.dp, vertical = 10.dp),
                                    )
                                }
                            }
                        }
                        item { ReglaFina(Modifier.padding(vertical = 8.dp)) }
                    }

                    items(anotaciones, key = { it.id }) { anotacion ->
                        FilaAnotacion(anotacion, { alIrA(anotacion.pagina) }, { alBorrar(anotacion.id) })
                        ReglaFina()
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = alCerrar) { Text("Cerrar") } },
    )
}

@Composable
private fun FilaAnotacion(anotacion: Anotacion, alIr: () -> Unit, alBorrar: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = alIr)
            .padding(vertical = 12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            Modifier
                .size(width = 4.dp, height = 40.dp)
                .background(colorDe(anotacion.color)),
        )
        Column(
            Modifier
                .weight(1f)
                .padding(horizontal = 12.dp),
        ) {
            Text(
                if (anotacion.tipo == TipoAnotacion.HIGHLIGHT) "Subrayado · página ${anotacion.pagina}"
                else "Nota · página ${anotacion.pagina}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            val cuerpo = anotacion.texto ?: anotacion.cita
            if (!cuerpo.isNullOrBlank()) {
                Text(cuerpo, style = MaterialTheme.typography.bodyMedium, maxLines = 4)
            }
        }
        Text(
            "Borrar",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier
                .clickable(onClick = alBorrar)
                .padding(horizontal = 10.dp, vertical = 12.dp),
        )
    }
}

/** Selector de color del subrayado. Los cuatro del lector web, sin más. */
@Composable
fun SelectorColor(activo: ColorAnotacion, alElegir: (ColorAnotacion) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        ColorAnotacion.entries.forEach { color ->
            Box(
                Modifier
                    .size(36.dp)
                    .background(colorDe(color))
                    .clickable { alElegir(color) },
            ) {
                if (color == activo) {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(4.dp)
                            .background(Color.Black),
                    )
                }
            }
        }
    }
}
