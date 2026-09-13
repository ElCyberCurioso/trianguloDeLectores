# kotlinx.serialization genera serializadores por plugin del compilador, pero
# los busca por reflexión sobre la clase: sin esto, R8 en modo completo renombra
# el `Companion` y la deserialización revienta en release y no en debug, que es
# la peor forma de descubrirlo.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**

-keepclassmembers class site.triangulodelectores.lector.data.remote.** {
    *** Companion;
}
-keepclasseswithmembers class site.triangulodelectores.lector.data.remote.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# OkHttp trae referencias a clases opcionales de Conscrypt y BouncyCastle que
# no están en el APK. Son avisos, no fallos.
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# PdfBox-Android carga fuentes y CMap desde los `assets` y resuelve por nombre
# clases del modelo del PDF: R8 no ve esas referencias y las quitaría. Se
# conserva el modelo entero y se callan los avisos de las partes de PDFBox de
# escritorio (AWT, Java2D) que en Android no existen y que este camino —sólo
# lectura de texto y anotaciones— no llega a tocar.
-keep class com.tom_roush.pdfbox.pdmodel.** { *; }
-keep class com.tom_roush.pdfbox.cos.** { *; }
-keep class com.tom_roush.fontbox.** { *; }
-dontwarn com.tom_roush.pdfbox.**
-dontwarn com.tom_roush.fontbox.**
-dontwarn java.awt.**
-dontwarn javax.imageio.**

# ZXing sólo se usa para EAN, pero el lector multiformato instancia sus
# descodificadores por nombre.
-keep class com.google.zxing.** { *; }
-dontwarn com.google.zxing.**
