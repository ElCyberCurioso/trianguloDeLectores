package site.triangulodelectores.lector.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * Piezas compartidas del sistema visual.
 *
 * Las dos reglas que se rompen solas si no viven en un componente:
 *
 *   - **las reglas de 1 px y 2 px no se sustituyen por aire**: 2 px entre
 *     secciones, 1 px dentro de una;
 *   - **nada centrado**, ni las etiquetas de los botones. Un botón ancho con la
 *     etiqueta en medio es exactamente lo que hace Material por omisión, así
 *     que hay que desactivarlo a mano en cada uno.
 */

/** Regla de 1 px: separa dentro de una sección. */
@Composable
fun ReglaFina(modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)),
    )
}

/** Regla de 2 px: separa secciones y va bajo la cabecera. */
@Composable
fun ReglaGruesa(modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.onBackground) {
    Box(
        modifier
            .fillMaxWidth()
            .height(2.dp)
            .background(color),
    )
}

/**
 * Las tres reglas de la marca: 100 / 66 / 33, en ese orden. Nunca centrada,
 * nunca con puntas redondeadas, nunca invertida y nunca toda en rojo -- sólo
 * la primera lleva el acento.
 */
@Composable
fun MarcaTresReglas(modifier: Modifier = Modifier, ancho: Int = 96) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Box(
            Modifier
                .width(ancho.dp)
                .height(3.dp)
                .background(MaterialTheme.colorScheme.primary),
        )
        Box(
            Modifier
                .width((ancho * 0.66f).dp)
                .height(3.dp)
                .background(MaterialTheme.colorScheme.onBackground),
        )
        Box(
            Modifier
                .width((ancho * 0.33f).dp)
                .height(3.dp)
                .background(MaterialTheme.colorScheme.onBackground),
        )
    }
}

/** Botón sólido. La etiqueta empieza en el padding izquierdo, no en el medio. */
@Composable
fun BotonPrimario(
    texto: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    activo: Boolean = true,
) {
    Button(
        onClick = onClick,
        enabled = activo,
        modifier = modifier.heightIn(min = 48.dp),
        shape = MaterialTheme.shapes.small,
        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start, verticalAlignment = Alignment.CenterVertically) {
            Text(texto, style = MaterialTheme.typography.labelLarge, textAlign = TextAlign.Start)
        }
    }
}

/** Botón secundario, con el mismo criterio de alineación. */
@Composable
fun BotonSecundario(
    texto: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    activo: Boolean = true,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = activo,
        modifier = modifier.heightIn(min = 48.dp),
        shape = MaterialTheme.shapes.small,
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start, verticalAlignment = Alignment.CenterVertically) {
            Text(texto, style = MaterialTheme.typography.labelLarge, textAlign = TextAlign.Start)
        }
    }
}

/** Aviso breve: lo que ha fallado y qué se puede hacer, sin adornos. */
@Composable
fun Aviso(texto: String, modifier: Modifier = Modifier, acento: Boolean = false) {
    Column(modifier.fillMaxWidth()) {
        ReglaGruesa(color = if (acento) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline)
        Text(
            texto,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(vertical = 12.dp),
        )
    }
}

/** Notas sobre 10 y con coma, como en el sitio. */
fun formatearTamano(bytes: Long): String =
    if (bytes <= 0) "" else String.format("%.1f MB", bytes / 1024.0 / 1024.0).replace('.', ',')
