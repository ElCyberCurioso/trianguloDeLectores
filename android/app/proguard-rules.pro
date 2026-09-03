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
