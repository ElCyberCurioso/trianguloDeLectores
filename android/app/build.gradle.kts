plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "site.triangulodelectores.lector"
    compileSdk = 35

    defaultConfig {
        applicationId = "site.triangulodelectores.lector"
        // API 26: es donde `PdfRenderer` ya es estable y donde existen las
        // claves del Keystore con AES/GCM que guardan el token. Bajar de aquí
        // obligaría a llevar dos caminos para lo mismo.
        minSdk = 26
        targetSdk = 35
        versionCode = 6
        versionName = "1.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        /**
         * Origen de la biblioteca privada. Es un `buildConfigField` y no una
         * constante en el código para poder apuntar a staging sin tocar
         * fuentes: `-PtdlBooksUrl=https://books-staging.triangulodelectores.site`
         */
        val booksUrl = (project.findProperty("tdlBooksUrl") as String?)
            ?: "https://books.triangulodelectores.site"
        val siteUrl = (project.findProperty("tdlSiteUrl") as String?)
            ?: "https://triangulodelectores.site"

        buildConfigField("String", "BOOKS_URL", "\"$booksUrl\"")
        buildConfigField("String", "SITE_URL", "\"$siteUrl\"")

        /*
         * La compilación contra staging es **otra aplicación**, con su propio
         * identificador y su propio icono en el lanzador.
         *
         * Con el mismo `applicationId`, instalar el APK de staging encima del de
         * producción no da error —misma firma— sino algo peor: lo sustituye y
         * hereda su base de datos, así que la estantería se queda con documentos
         * de un entorno apuntando al otro y con una credencial que allí no vale.
         * Al separarlos conviven, y se ve cuál es cuál por el nombre.
         */
        manifestPlaceholders["etiqueta"] = "Triángulo"
        if (booksUrl.contains("staging")) {
            applicationIdSuffix = ".staging"
            versionNameSuffix = "-staging"
            // El nombre va por marcador del manifiesto y no por `resValue`:
            // `app_name` ya existe en `strings.xml` y declararlo dos veces es un
            // recurso duplicado, que no compila.
            manifestPlaceholders["etiqueta"] = "Triángulo (staging)"
        }
    }

    /**
     * Firma de release.
     *
     * El almacén de claves **no vive en el repositorio**: se pasa por
     * propiedades (`~/.gradle/gradle.properties` o `-P`). Sin ellas se compila
     * igual y el APK sale sin firmar de release -- es preferible a tener una
     * clave de firma versionada, que es lo mismo que no tener firma.
     */
    val keystorePath = project.findProperty("tdlKeystore") as String?
    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = project.findProperty("tdlKeystorePassword") as String?
                keyAlias = project.findProperty("tdlKeyAlias") as String?
                keyPassword = project.findProperty("tdlKeyPassword") as String?
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (keystorePath != null) signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)

    debugImplementation(libs.androidx.ui.tooling)

    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
}
