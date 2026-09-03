package site.triangulodelectores.lector.data.local

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Dónde vive el token del dispositivo.
 *
 * En `SharedPreferences` a secas estaría en claro dentro de la carpeta de la
 * aplicación: en un teléfono sin rootear no lo lee nadie, pero en uno rooteado
 * o en una copia de seguridad sí. Como el token vale 90 días y abre la
 * biblioteca entera, se cifra con una clave del **Keystore de Android**, que no
 * sale del hardware seguro del teléfono y no se puede copiar a otro.
 *
 * No se usa `androidx.security:security-crypto`: son sesenta líneas de
 * `AES/GCM` y una dependencia menos que arrastrar, en una biblioteca que
 * además lleva tiempo sin dirección clara.
 */
class Credenciales(context: Context) {

    private val prefs = context.getSharedPreferences("credenciales", Context.MODE_PRIVATE)

    fun token(): String? {
        val guardado = prefs.getString(CLAVE_TOKEN, null) ?: return null
        return runCatching { descifrar(guardado) }.getOrNull()
    }

    fun guardarToken(token: String, nombreDispositivo: String, caducaEn: Long) {
        prefs.edit()
            .putString(CLAVE_TOKEN, cifrar(token))
            .putString(CLAVE_DISPOSITIVO, nombreDispositivo)
            .putLong(CLAVE_CADUCIDAD, caducaEn)
            .apply()
    }

    fun olvidar() {
        prefs.edit().clear().apply()
    }

    fun nombreDispositivo(): String? = prefs.getString(CLAVE_DISPOSITIVO, null)

    fun caducidad(): Long = prefs.getLong(CLAVE_CADUCIDAD, 0L)

    val emparejado: Boolean get() = token() != null

    // ------------------------------------------------------------ cifrado --
    private fun clave(): SecretKey {
        val keystore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keystore.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

        val generador = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generador.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                // Sin exigir autenticación del usuario: la sincronización corre
                // en segundo plano y con la pantalla apagada, donde no hay quién
                // ponga la huella.
                .setUserAuthenticationRequired(false)
                .build(),
        )
        return generador.generateKey()
    }

    private fun cifrar(valor: String): String {
        val cipher = Cipher.getInstance(TRANSFORMACION)
        cipher.init(Cipher.ENCRYPT_MODE, clave())
        val cifrado = cipher.doFinal(valor.toByteArray())
        // El IV se guarda delante del criptograma: GCM lo necesita para
        // descifrar y no es secreto, sólo tiene que ser distinto cada vez.
        val iv = cipher.iv
        val junto = ByteArray(1 + iv.size + cifrado.size)
        junto[0] = iv.size.toByte()
        System.arraycopy(iv, 0, junto, 1, iv.size)
        System.arraycopy(cifrado, 0, junto, 1 + iv.size, cifrado.size)
        return Base64.encodeToString(junto, Base64.NO_WRAP)
    }

    private fun descifrar(guardado: String): String {
        val junto = Base64.decode(guardado, Base64.NO_WRAP)
        val tamanoIv = junto[0].toInt()
        val iv = junto.copyOfRange(1, 1 + tamanoIv)
        val cifrado = junto.copyOfRange(1 + tamanoIv, junto.size)

        val cipher = Cipher.getInstance(TRANSFORMACION)
        cipher.init(Cipher.DECRYPT_MODE, clave(), GCMParameterSpec(128, iv))
        return String(cipher.doFinal(cifrado))
    }

    private companion object {
        const val ALIAS = "tdl_token_dispositivo"
        const val TRANSFORMACION = "AES/GCM/NoPadding"
        const val CLAVE_TOKEN = "token"
        const val CLAVE_DISPOSITIVO = "dispositivo"
        const val CLAVE_CADUCIDAD = "caducidad"
    }
}

/**
 * Ajustes que no son secretos: la marca de agua de la última sincronización y
 * las preferencias de lectura.
 */
class Ajustes(context: Context) {
    private val prefs = context.getSharedPreferences("ajustes", Context.MODE_PRIVATE)

    /**
     * Último `serverTime` que devolvió el servidor.
     *
     * Es del servidor y no del teléfono a propósito: comparar contra el reloj
     * local haría que un desfase de minutos se tragara cambios enteros sin que
     * nadie se entere.
     */
    var marcaSincronizacion: Long
        get() = prefs.getLong("marca", 0L)
        set(valor) = prefs.edit().putLong("marca", valor).apply()

    var ultimaSincronizacion: Long
        get() = prefs.getLong("ultima", 0L)
        set(valor) = prefs.edit().putLong("ultima", valor).apply()

    /** Descargar los PDF de la biblioteca sólo con wifi. Por omisión, sí. */
    var soloWifi: Boolean
        get() = prefs.getBoolean("solo_wifi", true)
        set(valor) = prefs.edit().putBoolean("solo_wifi", valor).apply()

    fun olvidar() = prefs.edit().clear().apply()
}
