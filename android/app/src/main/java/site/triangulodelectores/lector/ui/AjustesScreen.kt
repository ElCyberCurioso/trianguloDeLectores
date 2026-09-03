package site.triangulodelectores.lector.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import site.triangulodelectores.lector.BuildConfig
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Ajustes: emparejamiento con la biblioteca privada y poco más.
 *
 * Lo que se cuenta aquí es lo que hace falta saber para confiar en la
 * aplicación: qué se envía, a dónde y cómo se corta. Sin eso, «iniciar sesión»
 * en una aplicación que además abre ficheros del teléfono es un acto de fe.
 */
@Composable
fun AjustesScreen(modelo: AjustesViewModel, alVolver: () -> Unit) {
    val estado by modelo.estado.collectAsState()
    val contexto = LocalContext.current

    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var dispositivo by remember { mutableStateOf(modelo.nombrePorOmision()) }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Ajustes", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
            Text(
                "Volver",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier
                    .padding(horizontal = 8.dp, vertical = 12.dp)
                    .clickableSinRipple(alVolver),
            )
        }
        ReglaGruesa()

        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            estado.aviso?.let { Aviso(it, acento = true) }

            if (estado.emparejado) {
                Text("Biblioteca privada", style = MaterialTheme.typography.titleMedium)
                Dato("Dispositivo", estado.dispositivo ?: "Este teléfono")
                Dato("Credencial válida hasta", fecha(estado.caducidad))
                Dato(
                    "Última sincronización",
                    if (estado.ultimaSincronizacion > 0) fecha(estado.ultimaSincronizacion) else "Todavía ninguna",
                )

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Sincronizar sólo con wifi", style = MaterialTheme.typography.titleSmall)
                        Text(
                            "Afecta a la sincronización automática. Las descargas que pidas a mano se hacen igual.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(checked = estado.soloWifi, onCheckedChange = modelo::cambiarSoloWifi)
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    BotonPrimario(
                        if (estado.trabajando) "Sincronizando…" else "Sincronizar ahora",
                        modelo::sincronizar,
                        Modifier.weight(1f),
                        activo = !estado.trabajando,
                    )
                    BotonSecundario("Desemparejar", modelo::desemparejar)
                }

                ReglaFina()
                Text(
                    "Al desemparejar se retira la credencial de este teléfono en el servidor. Lo que hayas " +
                        "leído y anotado en documentos del propio dispositivo se queda aquí, intacto.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Text("Conectar con la biblioteca privada", style = MaterialTheme.typography.titleMedium)
                Text(
                    "Escribe el mismo email y contraseña que usas en ${hostDe(BuildConfig.BOOKS_URL)}. " +
                        "El teléfono guardará una credencial propia, no tu contraseña, y podrás retirarla " +
                        "desde aquí o desde el servidor sin cambiarla.",
                    style = MaterialTheme.typography.bodyMedium,
                )

                Campo("Email", email, { email = it }, KeyboardType.Email)
                Campo("Contraseña", password, { password = it }, KeyboardType.Password, oculto = true)
                Campo("Nombre de este dispositivo", dispositivo, { dispositivo = it }, KeyboardType.Text)

                BotonPrimario(
                    if (estado.trabajando) "Emparejando…" else "Emparejar",
                    { modelo.emparejar(email, password, dispositivo) },
                    Modifier.fillMaxWidth(),
                    activo = !estado.trabajando,
                )
            }

            ReglaGruesa()
            Text("Sobre la aplicación", style = MaterialTheme.typography.titleMedium)
            Dato("Versión", "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
            Dato("Biblioteca", hostDe(BuildConfig.BOOKS_URL))

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BotonSecundario("Buscar actualización", modelo::comprobarActualizacion)
                if (estado.versionDisponible != null) {
                    BotonPrimario("Descargar ${estado.versionDisponible}", {
                        contexto.startActivity(
                            Intent(Intent.ACTION_VIEW, Uri.parse("${BuildConfig.SITE_URL}/aplicacion")),
                        )
                    })
                }
            }

            ReglaFina()
            Text(
                "Los PDF que abras desde el teléfono no se suben a ninguna parte. Sólo viajan a la " +
                    "biblioteca privada el progreso, los subrayados, las notas y las páginas marcadas de " +
                    "los documentos que vienen de ella.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun Dato(etiqueta: String, valor: String) {
    Column {
        Text(etiqueta, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(valor, style = MaterialTheme.typography.bodyLarge)
    }
}

/**
 * Campo de texto.
 *
 * 16 sp de mínimo, como en el sitio: por debajo de eso el sistema amplía la
 * vista al enfocar en algunos teclados, y en todos se lee peor. Alto mínimo de
 * 48 dp, por encima de los 24 que exige WCAG 2.2.
 */
@Composable
private fun Campo(
    etiqueta: String,
    valor: String,
    alCambiar: (String) -> Unit,
    tipo: KeyboardType,
    oculto: Boolean = false,
) {
    Column {
        Text(etiqueta, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(4.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .height(48.dp)
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .padding(horizontal = 12.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            BasicTextField(
                value = valor,
                onValueChange = alCambiar,
                singleLine = true,
                textStyle = TextStyle(
                    fontSize = MaterialTheme.typography.bodyLarge.fontSize,
                    color = MaterialTheme.colorScheme.onSurface,
                ),
                visualTransformation = if (oculto) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
                keyboardOptions = KeyboardOptions(keyboardType = tipo, imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

private fun fecha(instante: Long): String =
    if (instante <= 0) "—" else SimpleDateFormat("d MMM yyyy, HH:mm", Locale("es", "ES")).format(Date(instante))

private fun hostDe(url: String): String = runCatching { Uri.parse(url).host ?: url }.getOrDefault(url)

/** Zona pulsable sin la onda de Material, que aquí no pinta nada. */
private fun Modifier.clickableSinRipple(onClick: () -> Unit): Modifier =
    this.clickable(indication = null, interactionSource = null, onClick = onClick)
