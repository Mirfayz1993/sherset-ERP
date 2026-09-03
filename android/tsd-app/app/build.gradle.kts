plugins {
    id("com.android.application") version "8.5.0"
    id("org.jetbrains.kotlin.android") version "1.9.24"
}

android {
    namespace = "uz.sherset.tsd"
    compileSdk = 34

    defaultConfig {
        applicationId = "uz.sherset.tsd"
        // 26 — `driver-app` bilan bir xil chegara. Ombor terminallari (Urovo,
        // Newland, Zebra TC2x, iData) odatda Android 9–14 da keladi.
        minSdk = 26
        targetSdk = 34
        // 🔴 `versionCode` — YANGILANISH taqqoslanadigan YAGONA son
        // (`Updater.isNewer`). Har chiqarishda BIRGA oshiriladi va hech qachon
        // kamaymaydi; `versionName` esa odam o'qiydigan yorliq va u
        // `latest.json` dagi nom hamda APK fayl nomi bilan MOS bo'lishi kerak.
        versionCode = 4
        versionName = "0.4.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    // 0.2.0 — UI Jetpack Compose'da (egasining «zamonaviy dizayn» qarori,
    // 2026-09-01). Eski «Compose APK'ni og'irlashtiradi» dalili bekor bo'ldi:
    // haqiqiy qurilma iData 95W Pro (Android 14) — zaxira katta.
    buildFeatures { compose = true }
    // Kotlin 1.9.24 bilan MOS versiya — ko'tarishda ikkalasini birga ko'taring.
    composeOptions { kotlinCompilerExtensionVersion = "1.5.14" }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.0")

    val composeBom = platform("androidx.compose:compose-bom:2024.05.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    // material3 material-icons-core'ni o'zi olib keladi; EXTENDED ikonlar
    // ATAYLAB YO'Q (APK ~+10 MB bo'lardi) — faqat core to'plamdan foydalanamiz.
    implementation("androidx.compose.material3:material3")

    // Views mavzusi (`Theme.Material3.DayNight`) manifest uchun kerak bo'lib qoladi.
    implementation("com.google.android.material:material:1.12.0")
    // Tarmoq — `driver-app` bilan bir xil klient.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // 🔴 Qurilma kaliti + refresh-token DISKDA shifrlangan holda yotadi.
    // `driver-app` da bu YO'Q edi (u faqat parol bilan kirardi va tokenni
    // xotirada saqlardi); TSD esa kalitni doimiy saqlaydi — oddiy
    // SharedPreferences root'langan terminalda ochiq matn bo'lardi.
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
}
