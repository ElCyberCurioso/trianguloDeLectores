package site.triangulodelectores.lector.pdf

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import site.triangulodelectores.lector.data.local.Rect

class EnlacesTest {

    private val nota3 = EnlaceInterno(Rect(0.50f, 0.30f, 0.01f, 0.01f), pagina = 240, altura = 0.8f)
    private val nota4 = EnlaceInterno(Rect(0.52f, 0.30f, 0.01f, 0.01f), pagina = 240, altura = 0.85f)
    private val web = EnlaceExterno(Rect(0.10f, 0.90f, 0.40f, 0.02f), "https://example.org")

    @Test
    fun `el toque dentro de un enlace lo encuentra`() {
        assertEquals(web, enlaceEn(listOf(web), 0.20f, 0.91f))
    }

    @Test
    fun `una llamada de nota se acierta aunque el dedo caiga al lado`() {
        // A medio punto de porcentaje de la llamada: fuera de su caja, dentro
        // del margen.
        assertEquals(nota3, enlaceEn(listOf(nota3), 0.515f, 0.305f))
    }

    @Test
    fun `lejos de todo no hay enlace`() {
        assertNull(enlaceEn(listOf(nota3, web), 0.9f, 0.1f))
    }

    @Test
    fun `entre dos llamadas vecinas gana la que contiene el punto`() {
        assertEquals(nota4, enlaceEn(listOf(nota3, nota4), 0.525f, 0.305f))
        assertEquals(nota3, enlaceEn(listOf(nota3, nota4), 0.505f, 0.305f))
    }

    @Test
    fun `dentro de un enlace grande gana el grande aunque haya otro cerca`() {
        val grande = EnlaceInterno(Rect(0.40f, 0.29f, 0.20f, 0.03f), pagina = 1, altura = null)
        assertEquals(grande, enlaceEn(listOf(grande, nota3), 0.45f, 0.30f))
    }

    @Test
    fun `solo web y correo`() {
        assertEquals("https://example.org/a?b=1", urlSegura(" https://example.org/a?b=1 "))
        assertEquals("mailto:alguien@example.org", urlSegura("mailto:alguien@example.org"))
        assertEquals("HTTP://EXAMPLE.ORG", urlSegura("HTTP://EXAMPLE.ORG"))
        assertNull(urlSegura("intent://scan/#Intent;scheme=zxing;end"))
        assertNull(urlSegura("javascript:alert(1)"))
        assertNull(urlSegura("file:///sdcard/secreto.txt"))
        assertNull(urlSegura("content://contacts/people"))
        assertNull(urlSegura("example.org"))
    }

    @Test
    fun `una direccion vacia o con espacios no vale`() {
        assertNull(urlSegura("https:"))
        assertNull(urlSegura("https://example.org/ falso.com"))
        assertNull(urlSegura("https://example.org\nhttps://otro.org"))
    }
}
