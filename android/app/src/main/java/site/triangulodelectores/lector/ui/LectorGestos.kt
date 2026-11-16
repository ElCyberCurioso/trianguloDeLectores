package site.triangulodelectores.lector.ui

import androidx.compose.animation.core.AnimationState
import androidx.compose.animation.core.DecayAnimationSpec
import androidx.compose.animation.core.animateDecay
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.unit.Velocity
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/*
 * Los gestos del lector y la inercia con zoom.
 */

/**
 * Por debajo de esto no se lanza nada: es un dedo que se ha quedado quieto
 * antes de levantarse, no alguien que quiere recorrer el documento.
 */
private const val VELOCIDAD_MINIMA = 80f

/**
 * Deja rodando el documento después del arrastre.
 *
 * Los dos ejes van a la vez y con el mismo decaimiento porque salen del mismo
 * gesto: lanzar en diagonal y que se pare sólo la mitad se nota enseguida.
 *
 * Cada eje mide en lo suyo y por eso se tratan por separado. El vertical lo
 * lleva la lista, que mide **sin ampliar**, así que la velocidad de pantalla se
 * divide por el zoom; el horizontal es encuadre en píxeles de pantalla y va tal
 * cual. Los dos paran en cuanto dejan de avanzar: al llegar al final del
 * documento o al borde del encuadre, seguir animando sería gastar fotogramas
 * para no mover nada.
 */
internal suspend fun lanzar(
    velocidad: Velocity,
    zoom: Float,
    decaimiento: DecayAnimationSpec<Float>,
    lista: androidx.compose.foundation.lazy.LazyListState,
    encuadre: () -> Float,
    alEncuadrar: (Float) -> Unit,
) = coroutineScope {
    val escala = zoom.coerceAtLeast(0.01f)

    // Vertical: el signo se invierte porque el dedo que sube baja el documento.
    val vy = -velocidad.y / escala
    if (kotlin.math.abs(vy) > VELOCIDAD_MINIMA / escala) {
        launch {
            lista.scroll {
                var anterior = 0f
                AnimationState(initialValue = 0f, initialVelocity = vy)
                    .animateDecay(decaimiento) {
                        val paso = value - anterior
                        anterior = value
                        val consumido = scrollBy(paso)
                        if (kotlin.math.abs(paso - consumido) > 0.5f) cancelAnimation()
                    }
            }
        }
    }

    val vx = velocidad.x
    if (kotlin.math.abs(vx) > VELOCIDAD_MINIMA) {
        launch {
            var anterior = 0f
            AnimationState(initialValue = 0f, initialVelocity = vx)
                .animateDecay(decaimiento) {
                    val paso = value - anterior
                    anterior = value
                    val antes = encuadre()
                    alEncuadrar(antes + paso)
                    if (kotlin.math.abs(encuadre() - antes) < kotlin.math.abs(paso) - 0.5f) {
                        cancelAnimation()
                    }
                }
        }
    }
}

/**
 * Los gestos del lector: pellizco para el zoom y arrastre para el encuadre.
 *
 * Todo lo lleva **un solo detector**, y ese es justo el arreglo. Antes había un
 * contenedor con scroll horizontal por fuera y una lista vertical por dentro, y
 * cada uno atiende a un eje: Compose ata cada gesto a una orientación, así que
 * se podía ir en horizontal o en vertical pero nunca en diagonal. Repartiendo
 * aquí las dos componentes del mismo arrastre, la diagonal sale sola.
 *
 * Con **un dedo sólo actúa si hay zoom**. Sin zoom no hay nada que encuadrar y
 * conviene no tocar el gesto: así la lista se desplaza ella misma, con su
 * inercia y su rebote, que es como se lee un documento la mayor parte del
 * tiempo. Con **dos dedos** siempre, y consumiendo sólo cuando el pellizco ya
 * ha movido algo: un segundo dedo apoyado sin mover no congela la lectura.
 *
 * **Y con zoom la inercia hay que ponerla aquí.** Al consumir el gesto, la
 * lista deja de verlo y con él se pierde su lanzamiento: el documento se
 * paraba en seco al levantar el dedo y recorrer un libro ampliado era repetir
 * el arrastre. Se apunta la velocidad del dedo y se avisa al soltar; quien
 * recibe el aviso decide cuánto sigue rodando.
 *
 * Va por la pasada `Initial`, que baja de fuera adentro. En la principal la
 * lista ya se habría quedado el gesto.
 */
internal fun Modifier.gestosDeLectura(
    activo: Boolean,
    zoom: () -> Float,
    /** Factor del pellizco y punto medio entre los dedos, en píxeles del hueco. */
    alPellizcar: (Float, Offset) -> Unit,
    alArrastrar: (Float, Float) -> Unit,
    /** Empieza un gesto: lo que siguiera rodando por su cuenta se para. */
    alTocar: () -> Unit,
    /** Se levanta el dedo tras arrastrar, con su velocidad en px/s de pantalla. */
    alSoltar: (Velocity) -> Unit,
): Modifier = if (!activo) this else pointerInput(Unit) {
    awaitEachGesture {
        val bajada = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        alTocar()

        /*
         * La velocidad se mide sobre **un solo dedo**, que es el que puede
         * lanzar. Se sigue por identificador: si el que quedaba se levanta y
         * queda otro, sus posiciones no son continuación de las del primero y
         * mezclarlas daría una velocidad inventada.
         */
        val rastreador = VelocityTracker()
        var seguido = bajada.id
        rastreador.addPosition(bajada.uptimeMillis, bajada.position)

        var pellizcando = false
        var arrastrado = false
        do {
            val evento = awaitPointerEvent(PointerEventPass.Initial)
            val dedos = evento.changes.count { it.pressed }
            val pan = evento.calculatePan()

            if (dedos >= 2) {
                val factor = evento.calculateZoom()
                if (factor != 1f) {
                    pellizcando = true
                    alPellizcar(factor, evento.calculateCentroid())
                }
                if (pellizcando) {
                    if (pan != Offset.Zero) alArrastrar(pan.x, pan.y)
                    evento.changes.forEach { if (it.pressed) it.consume() }
                }
            } else if (dedos == 1 && zoom() > 1.001f && pan != Offset.Zero) {
                arrastrado = true
                alArrastrar(pan.x, pan.y)
                evento.changes.forEach { if (it.pressed) it.consume() }
            }

            if (dedos == 1) {
                evento.changes.firstOrNull { it.pressed }?.let { dedo ->
                    if (dedo.id != seguido) {
                        rastreador.resetTracking()
                        seguido = dedo.id
                    }
                    rastreador.addPosition(dedo.uptimeMillis, dedo.position)
                }
            } else {
                // Después de un pellizco no se lanza nada: los dos dedos mueven
                // el centroide y eso no es la velocidad de ningún dedo.
                rastreador.resetTracking()
            }
        } while (evento.changes.any { it.pressed })

        if (arrastrado && !pellizcando) alSoltar(rastreador.calculateVelocity())
    }
}
