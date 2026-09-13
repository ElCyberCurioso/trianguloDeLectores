package site.triangulodelectores.lector.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.view.CameraController
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.oned.MultiFormatOneDReader

/**
 * El escáner de códigos de barras de la biblioteca.
 *
 * Lo mismo que hace la web en el formulario de alta, y por el mismo motivo:
 * teclear trece cifras de la contraportada con el libro en la otra mano es
 * donde se equivoca cualquiera, y un dígito mal deja la ficha vacía sin decir
 * por qué.
 *
 * Se descodifica con **ZXing en Java puro**, el mismo descodificador que usa la
 * reserva del lector web. No se usa ML Kit: traería los servicios de Google —o
 * un módulo que se descarga a la primera— para leer trece cifras que ZXing lee
 * en unos cientos de kilobytes y sin hablar con nadie.
 *
 * La cámara no sale de aquí: se lee el fotograma, se busca el código y se tira.
 * No se guarda ni se envía ninguna imagen. Lo único que sale de esta pantalla es
 * el número, y quien consulta ese número es el Worker, no el teléfono, igual que
 * en la web.
 */
@Composable
fun EscanerIsbn(alLeer: (String) -> Unit, alCerrar: () -> Unit) {
    val contexto = LocalContext.current

    var permiso by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(contexto, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    var denegado by remember { mutableStateOf(false) }

    val pedirPermiso = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { concedido ->
        permiso = concedido
        denegado = !concedido
    }

    // Se pide al entrar y no detrás de otro botón: aquí se ha entrado para
    // escanear y no hay ninguna otra cosa que hacer en esta pantalla.
    LaunchedEffect(Unit) {
        if (!permiso) pedirPermiso.launch(Manifest.permission.CAMERA)
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
        contentColor = MaterialTheme.colorScheme.onBackground,
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing),
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Escanear ISBN",
                    style = MaterialTheme.typography.headlineSmall,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    "Cancelar",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier
                        .heightIn(min = 44.dp)
                        .clickable(onClick = alCerrar)
                        .padding(horizontal = 8.dp, vertical = 12.dp),
                )
            }
            ReglaGruesa()

            when {
                permiso -> {
                    VistaDeCamara(
                        alLeer = alLeer,
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                    )
                    Column(
                        Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            "Enfoca el código de barras de la contraportada.",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Text(
                            "La imagen no se guarda ni sale del teléfono: lo único que se queda " +
                                "es el número leído.",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                denegado -> Aviso(
                    "Sin permiso de cámara no se puede escanear. Se concede en los ajustes del " +
                        "sistema, o escribe el ISBN a mano.",
                    Modifier.padding(16.dp),
                    acento = true,
                )

                else -> Aviso("Pidiendo permiso para la cámara…", Modifier.padding(16.dp))
            }
        }
    }
}

/**
 * La cámara.
 *
 * `LifecycleCameraController` en vez de montar los casos de uso a mano: ata la
 * cámara al ciclo de vida de la pantalla, que es justo lo que hace falta aquí --
 * que al salir se apague sola sin depender de acordarse.
 */
@Composable
private fun VistaDeCamara(alLeer: (String) -> Unit, modifier: Modifier = Modifier) {
    val contexto = LocalContext.current
    val duenoDelCiclo = LocalLifecycleOwner.current

    // La lectura llega desde el hilo de la cámara, que no ve las
    // recomposiciones: sin esto se quedaría llamando a la primera versión.
    val alLeerActual by rememberUpdatedState(alLeer)

    val controlador = remember {
        LifecycleCameraController(contexto).apply {
            cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA
            // Sólo análisis: ni foto ni vídeo. Lo que no se habilita no reserva
            // cámara ni memoria.
            setEnabledUseCases(CameraController.IMAGE_ANALYSIS)
        }
    }

    DisposableEffect(controlador, duenoDelCiclo) {
        controlador.setImageAnalysisAnalyzer(
            ContextCompat.getMainExecutor(contexto),
            LectorDeCodigos { codigo -> alLeerActual(codigo) },
        )
        controlador.bindToLifecycle(duenoDelCiclo)

        onDispose {
            controlador.clearImageAnalysisAnalyzer()
            controlador.unbind()
        }
    }

    AndroidView(
        modifier = modifier.background(MaterialTheme.colorScheme.surfaceVariant),
        factory = { ctx ->
            PreviewView(ctx).apply {
                scaleType = PreviewView.ScaleType.FILL_CENTER
                controller = controlador
            }
        },
    )
}

/**
 * Busca un código de barras en cada fotograma.
 *
 * Sólo EAN-13 y EAN-8, que es lo que lleva un libro. Limitar los formatos
 * acelera cada fotograma y evita leer por error el código de otra cosa que haya
 * encima de la mesa -- el mismo criterio que en la web.
 */
private class LectorDeCodigos(private val alLeer: (String) -> Unit) : ImageAnalysis.Analyzer {

    private val pistas = mapOf<DecodeHintType, Any>(
        DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.EAN_13, BarcodeFormat.EAN_8),
        DecodeHintType.TRY_HARDER to true,
    )

    private val lector = MultiFormatOneDReader(pistas)

    /** Una lectura y se acabó: el fotograma siguiente leería lo mismo otra vez. */
    private var leido = false

    override fun analyze(imagen: ImageProxy) {
        if (leido) {
            imagen.close()
            return
        }

        val codigo = runCatching { decodificar(imagen) }.getOrNull()
        imagen.close()

        if (codigo != null) {
            leido = true
            alLeer(codigo)
        }
    }

    private fun decodificar(imagen: ImageProxy): String? {
        // Sólo la luminancia: el plano Y del YUV ya es la imagen en gris, que es
        // sobre lo que trabaja ZXing. Pasar a color para volver a gris sería dar
        // dos vueltas por fotograma.
        val plano = imagen.planes.firstOrNull() ?: return null
        val buffer = plano.buffer
        val paso = plano.rowStride
        val ancho = imagen.width
        val alto = imagen.height
        if (ancho <= 0 || alto <= 0 || paso < ancho) return null

        val crudo = ByteArray(paso * alto)
        buffer.get(crudo, 0, minOf(crudo.size, buffer.remaining()))

        // El sensor entrega la imagen girada respecto a como se ve en pantalla,
        // y un código de barras girado no se lee: ZXing recorre **filas**, y con
        // el giro las barras van en columnas. Se endereza antes de mirarlo.
        val giro = ((imagen.imageInfo.rotationDegrees % 360) + 360) % 360
        val (datos, anchoFinal, altoFinal) = enderezar(crudo, paso, ancho, alto, giro)

        val fuente = PlanarYUVLuminanceSource(
            datos,
            anchoFinal,
            altoFinal,
            0,
            0,
            anchoFinal,
            altoFinal,
            false,
        )

        return try {
            lector.decode(BinaryBitmap(HybridBinarizer(fuente)), pistas).text
        } catch (e: Exception) {
            // `NotFoundException` en cada fotograma sin código, que es el caso
            // corriente y no un error.
            null
        } finally {
            // Se queda con estado del intento anterior si no se reinicia.
            lector.reset()
        }
    }
}

/**
 * Endereza el plano de luminancia y le quita el relleno de final de fila.
 *
 * El `rowStride` de la cámara casi nunca coincide con el ancho: hay bytes de
 * sobra al final de cada fila y, sin quitarlos, la imagen sale inclinada y no se
 * descodifica nada.
 */
private fun enderezar(
    origen: ByteArray,
    paso: Int,
    ancho: Int,
    alto: Int,
    giro: Int,
): Triple<ByteArray, Int, Int> {
    val salida = ByteArray(ancho * alto)

    return when (giro) {
        90 -> {
            for (y in 0 until alto) {
                for (x in 0 until ancho) {
                    salida[x * alto + (alto - 1 - y)] = origen[y * paso + x]
                }
            }
            Triple(salida, alto, ancho)
        }
        180 -> {
            for (y in 0 until alto) {
                for (x in 0 until ancho) {
                    salida[(alto - 1 - y) * ancho + (ancho - 1 - x)] = origen[y * paso + x]
                }
            }
            Triple(salida, ancho, alto)
        }
        270 -> {
            for (y in 0 until alto) {
                for (x in 0 until ancho) {
                    salida[(ancho - 1 - x) * alto + y] = origen[y * paso + x]
                }
            }
            Triple(salida, alto, ancho)
        }
        else -> {
            for (y in 0 until alto) {
                System.arraycopy(origen, y * paso, salida, y * ancho, ancho)
            }
            Triple(salida, ancho, alto)
        }
    }
}
