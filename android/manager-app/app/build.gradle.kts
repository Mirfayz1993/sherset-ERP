plugins {
    id("com.android.application") version "8.5.0"
    id("org.jetbrains.kotlin.android") version "1.9.24"
}

android {
    namespace = "uz.sherset.manager"
    compileSdk = 34

    defaultConfig {
        applicationId = "uz.sherset.manager"
        // 26 — tsd-app/driver-app bilan bir xil chegara.
        minSdk = 26
        targetSdk = 34
        // 🔴 `versionCode` — YANGILANISH taqqoslanadigan YAGONA son
        // (`Updater.isNewer`). Har chiqarishda BIRGA oshiriladi va hech qachon
        // kamaymaydi; `versionName` esa odam o'qiydigan yorliq va u
        // `latest.json` dagi nom hamda APK fayl nomi bilan MOS bo'lishi kerak.
        versionCode = 1
        versionName = "0.1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

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
    // Tarmoq — tsd-app/driver-app bilan bir xil klient (Retrofit/Hilt ATAYLAB yo'q).
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // 🔴 Refresh-token DISKDA shifrlangan holda yotadi (SessionStore.kt).
    // Parol HECH QACHON saqlanmaydi.
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // JVM birlik testlari (X-reja X1): rol/ruxsat mantig'i `HrAccess` da
    // ATAYLAB Android'siz sof funksiya, shuning uchun emulyator/Robolectric
    // KERAK EMAS — oddiy JUnit yetadi. APK'ga tushmaydi.
    testImplementation("junit:junit:4.13.2")
}
