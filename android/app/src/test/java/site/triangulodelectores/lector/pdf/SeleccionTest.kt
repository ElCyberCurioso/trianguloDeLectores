package site.triangulodelectores.lector.pdf

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * La selección de texto se prueba aquí y no en el teléfono porque no toca
 * Android: son palabras con coordenadas y un recorrido por ellas. Lo que sí
 * depende del aparato —que PDFBox encuentre las palabras— no se puede probar
 * sin un PDF de verdad, así que se separó a propósito de esta parte.
 */
class SeleccionTest {

    /** Dos renglones de tres palabras, como saldrían de una página cualquiera. */
    private val pagina = listOf(
        Palabra("El", 0.10f, 0.20f, 0.05f, 0.02f),
        Palabra("gato", 0.16f, 0.20f, 0.08f, 0.02f),
        Palabra("duerme", 0.25f, 0.20f, 0.12f, 0.02f),
        Palabra("sobre", 0.10f, 0.24f, 0.09f, 0.02f),
        Palabra("la", 0.20f, 0.24f, 0.04f, 0.02f),
        Palabra("mesa", 0.25f, 0.24f, 0.08f, 0.02f),
    )

    @Test
    fun `una sola palabra`() {
        val seleccion = seleccionarTexto(pagina, 0.18f, 0.21f, 0.18f, 0.21f)!!
        assertEquals("gato", seleccion.cita)
        assertEquals(1, seleccion.rects.size)
    }

    @Test
    fun `de una palabra a otra del mismo renglon`() {
        val seleccion = seleccionarTexto(pagina, 0.11f, 0.21f, 0.30f, 0.21f)!!
        assertEquals("El gato duerme", seleccion.cita)
        assertEquals(1, seleccion.rects.size)
    }

    @Test
    fun `un rectangulo por renglon, no uno por palabra`() {
        val seleccion = seleccionarTexto(pagina, 0.11f, 0.21f, 0.30f, 0.25f)!!
        assertEquals("El gato duerme sobre la mesa", seleccion.cita)
        assertEquals(2, seleccion.rects.size)
        // El del primer renglón cubre de la primera palabra a la última, huecos
        // entre palabras incluidos: es un subrayado, no tres pegatinas.
        val primero = seleccion.rects.first()
        assertEquals(0.10f, primero.x, 0.001f)
        assertEquals(0.27f, primero.w, 0.001f)
    }

    @Test
    fun `arrastrar hacia atras selecciona lo mismo`() {
        val alDerecho = seleccionarTexto(pagina, 0.11f, 0.21f, 0.30f, 0.25f)!!
        val alReves = seleccionarTexto(pagina, 0.30f, 0.25f, 0.11f, 0.21f)!!
        assertEquals(alDerecho.cita, alReves.cita)
    }

    @Test
    fun `pasarse del final del renglon coge la ultima palabra`() {
        val seleccion = seleccionarTexto(pagina, 0.11f, 0.21f, 0.95f, 0.21f)!!
        assertEquals("El gato duerme", seleccion.cita)
    }

    @Test
    fun `una pagina sin texto no da seleccion`() {
        assertNull(seleccionarTexto(emptyList(), 0.1f, 0.1f, 0.5f, 0.5f))
    }

    @Test
    fun `el rectangulo del renglon no se sale de la pagina`() {
        val seleccion = seleccionarTexto(pagina, 0.11f, 0.21f, 0.30f, 0.25f)!!
        assertTrue(seleccion.rects.all { it.x >= 0f && it.y >= 0f && it.x + it.w <= 1f && it.y + it.h <= 1f })
    }
}
