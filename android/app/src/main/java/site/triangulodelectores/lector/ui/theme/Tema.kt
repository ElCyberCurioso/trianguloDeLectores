package site.triangulodelectores.lector.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import site.triangulodelectores.lector.R

/**
 * El sistema visual del sitio, llevado al teléfono.
 *
 * Las tres reglas que no se rompen y que aquí también aplican:
 *
 *   1. **Ningún radio.** Todas las formas de Material valen 0 dp. Material 3
 *      redondea por omisión hasta los diálogos, así que hay que decírselo
 *      explícitamente en los cinco tamaños o vuelve por la puerta de atrás.
 *   2. **Nada centrado**, empezando por las etiquetas de los botones.
 *   3. **Un solo rojo, y siempre significa algo.** `#ec3013` no decora: marca
 *      lo que está activo o lo que hay que mirar.
 *
 * El tema oscuro es el de partida, igual que en el sitio: `:root` allí ya son
 * los valores oscuros. Aquí se sigue la preferencia del sistema, que en un
 * teléfono es una decisión de quien lo lleva encima y no del sitio.
 */

private val Tinta = Color(0xFF201E1D)
private val Hueso = Color(0xFFF3F2F2)
private val Rojo = Color(0xFFEC3013)
/** El único que llega a contraste AA como texto pequeño o relleno de botón. */
private val RojoTexto = Color(0xFFAE1800)
private val RojoOscuro = Color(0xFFFF563C)

private val Oscuro = darkColorScheme(
    primary = RojoOscuro,
    onPrimary = Color.White,
    secondary = Color(0xFF8B8785),
    background = Color(0xFF1A1918),
    onBackground = Hueso,
    surface = Color(0xFF232120),
    onSurface = Hueso,
    surfaceVariant = Color(0xFF2D2B2B),
    onSurfaceVariant = Color(0xFFBFBAB8),
    outline = Color(0xFF4D4A4A),
    error = RojoOscuro,
)

private val Claro = lightColorScheme(
    primary = RojoTexto,
    onPrimary = Color.White,
    secondary = Color(0xFF605D5D),
    background = Hueso,
    onBackground = Tinta,
    surface = Color(0xFFEAE9E9),
    onSurface = Tinta,
    surfaceVariant = Color(0xFFE1E0E0),
    onSurfaceVariant = Color(0xFF444141),
    outline = Color(0xFF8B8785),
    error = RojoTexto,
)

/** El acento de la marca, para lo que tiene que significar algo. */
val ColorAcento: Color get() = Rojo

private val Archivo = FontFamily(
    Font(R.font.archivo_regular, FontWeight.Normal),
    Font(R.font.archivo_semibold, FontWeight.SemiBold),
    Font(R.font.archivo_extrabold, FontWeight.ExtraBold),
)

/**
 * 800 en titulares y cifras, 600 en metadatos, 400 en cuerpo. Los tamaños de
 * cuerpo no bajan de 16 sp: por debajo, el texto de una aplicación de leer deja
 * de poderse leer, que sería un chiste.
 */
private val Tipografia = Typography(
    displaySmall = TextStyle(fontFamily = Archivo, fontWeight = FontWeight.ExtraBold, fontSize = 32.sp, lineHeight = 36.sp),
    headlineMedium = TextStyle(fontFamily = Archivo, fontWeight = FontWeight.ExtraBold, fontSize = 26.sp, lineHeight = 30.sp),
    headlineSmall = TextStyle(fontFamily = Archivo, fontWeight = FontWeight.ExtraBold, fontSize = 21.sp, lineHeight = 25.sp),
    titleMedium = TextStyle(fontFamily = Archivo, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, lineHeight = 22.sp),
    titleSmall = TextStyle(fontFamily = Archivo, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, lineHeight = 20.sp),
    bodyLarge = TextStyle(fontFamily = Archivo, fontWeight = FontWeight.Normal, fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontFamily = Archivo, fontWeight = FontWeight.Normal, fontSize = 16.sp, lineHeight = 22.sp),
    labelLarge = TextStyle(fontFamily = Archivo, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, lineHeight = 20.sp),
    labelMedium = TextStyle(fontFamily = Archivo, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, lineHeight = 17.sp),
)

/** Cero en los cinco tamaños. Ninguna esquina redondeada, en ningún sitio. */
private val SinRadios = Shapes(
    extraSmall = RoundedCornerShape(0.dp),
    small = RoundedCornerShape(0.dp),
    medium = RoundedCornerShape(0.dp),
    large = RoundedCornerShape(0.dp),
    extraLarge = RoundedCornerShape(0.dp),
)

@Composable
fun TemaTdl(oscuro: Boolean = isSystemInDarkTheme(), contenido: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (oscuro) Oscuro else Claro,
        typography = Tipografia,
        shapes = SinRadios,
        content = contenido,
    )
}
