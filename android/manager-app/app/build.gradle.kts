import java.util.Properties

plugins {
    id("com.android.application") version "8.5.0"
    id("org.jetbrains.kotlin.android") version "1.9.24"
}

// 🔴 RELEASE IMZO (X-reja X7). Kalit ham, parol ham REPODAN TASHQARIDA —
// repo public. Bu yerda faqat fayl NOMI turadi, sirning o'zi emas:
//   ~/.sherset/sherset-manager-release.properties → storeFile/storePassword/keyAlias/keyPassword
// tsd-app (T9) bilan AYNI naqsh, lekin kalit ALOHIDA: ikki ilova ikki xil
// `applicationId` ga ega va bitta kalitning yo'qolishi ikkalasini birdaniga
// o'ldirmasligi kerak.
// Fayl bo'lmasa `assembleDebug` ishlayveradi (kundalik ish to'xtamaydi), lekin
// `assembleRelease` ANIQ XABAR bilan yiqiladi — imzosiz APK jimgina chiqib
// ketib, keyin planshetda «paket buzilgan» bo'lib ko'rinmasin.
val signPropsFile = file(
    System.getenv("SHERSET_MANAGER_KEYSTORE_PROPS")
        ?: "${System.getProperty("user.home")}/.sherset/sherset-manager-release.properties",
)
val signProps = Properties().apply {
    if (signPropsFile.isFile) signPropsFile.inputStream().use { load(it) }
}
val signKeystore = signProps.getProperty("storeFile")?.let { file(it) }
val hasReleaseSigning = signKeystore?.isFile == true

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
        versionCode = 2
        versionName = "0.2.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

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
                // planshet ham Android 8, v2 esa 7.0+ da o'qiladi.
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

// Imzosiz release APK'ni O'RNATIB BO'LMAYDI, lekin build muvaffaqiyatli
// ko'rinadi — bu tuzoq `publish.sh` ga yetib borishidan oldin uzilsin.
if (!hasReleaseSigning) {
    tasks.configureEach {
        if (name == "assembleRelease" || name == "bundleRelease") {
            doFirst {
                throw GradleException(
                    "Release kaliti topilmadi: $signPropsFile" +
                        "\nBir marta yaratish: bash android/manager-app/tools/imzo-yarat.sh" +
                        "\nYo'riqnoma va zaxira tartibi: android/manager-app/README.md «Release imzo»",
                )
            }
        }
    }
}
