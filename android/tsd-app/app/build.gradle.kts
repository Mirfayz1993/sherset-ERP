import java.util.Properties

plugins {
    id("com.android.application") version "8.5.0"
    id("org.jetbrains.kotlin.android") version "1.9.24"
}

// 🔴 RELEASE IMZO (T9). Kalit ham, parol ham REPODAN TASHQARIDA — repo public
// (§2 qoida 11). Bu yerda faqat fayl NOMI turadi, sirning o'zi emas:
//   ~/.sherset/sherset-tsd-release.properties  → storeFile/storePassword/keyAlias/keyPassword
// Fayl bo'lmasa `assembleDebug` ishlayveradi (kundalik ish to'xtamaydi), lekin
// `assembleRelease` ANIQ XABAR bilan yiqiladi — imzosiz APK jimgina chiqib
// ketib, keyin terminalda «paket buzilgan» bo'lib ko'rinmasin.
val signPropsFile = file(
    System.getenv("SHERSET_TSD_KEYSTORE_PROPS")
        ?: "${System.getProperty("user.home")}/.sherset/sherset-tsd-release.properties",
)
val signProps = Properties().apply {
    if (signPropsFile.isFile) signPropsFile.inputStream().use { load(it) }
}
val signKeystore = signProps.getProperty("storeFile")?.let { file(it) }
val hasReleaseSigning = signKeystore?.isFile == true

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
        versionCode = 6
        versionName = "0.6.0"
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

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = signKeystore
                storePassword = signProps.getProperty("storePassword")
                keyAlias = signProps.getProperty("keyAlias")
                keyPassword = signProps.getProperty("keyPassword")
                // v1 (JAR) ATAYLAB yoqilmaydi: `minSdk = 26` ⇒ eng eski
                // qurilma ham Android 8, v2 esa 7.0+ da o'qiladi. Tekshirildi:
                // `apksigner verify` → «v2 scheme: true».
                enableV2Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Topilmasa `null` — quyidagi tekshiruv `assembleRelease` ni
            // to'xtatadi. AGP o'zi bunday holatda IMZOSIZ APK yasab beradi.
            signingConfig = signingConfigs.findByName("release")
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

    // T5 — `QtyExpression` ATAYLAB sof modul (Android API'siz), ya'ni uni
    // oddiy JVM testi qamrab oladi. Ilovada boshqa test infratuzilmasi hamon
    // YO'Q (U-reja «Ochiq qolganlar») — bu bog'liqlik FAQAT `src/test` uchun
    // va APK'ga tushmaydi (`testImplementation`).
    testImplementation("junit:junit:4.13.2")
}

// Imzosiz release APK'ni O'RNATIB BO'LMAYDI, lekin build muvaffaqiyatli
// ko'rinadi — bu tuzoq `publish.sh` ga yetib borishidan oldin uzilsin.
if (!hasReleaseSigning) {
    tasks.configureEach {
        if (name == "assembleRelease" || name == "bundleRelease") {
            doFirst {
                throw GradleException(
                    "Release kaliti topilmadi: $signPropsFile" +
                        "\nBir marta yaratish: bash android/tsd-app/tools/imzo-yarat.sh" +
                        "\nZaxiradan tiklash: docs/ops/tsd-release-imzo.md",
                )
            }
        }
    }
}
