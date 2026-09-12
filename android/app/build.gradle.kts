plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
}

val thewyjBaseUrl = providers.gradleProperty("THEWYJ_BASE_URL")
    .orElse("https://thewyj.uk")
    .get()

val releaseSigning = mapOf(
    "storeFile" to providers.environmentVariable("THEWYJ_ANDROID_KEYSTORE_FILE").orNull.orEmpty(),
    "storePassword" to providers.environmentVariable("THEWYJ_ANDROID_KEYSTORE_PASSWORD").orNull.orEmpty(),
    "keyAlias" to providers.environmentVariable("THEWYJ_ANDROID_KEY_ALIAS").orNull.orEmpty(),
    "keyPassword" to providers.environmentVariable("THEWYJ_ANDROID_KEY_PASSWORD").orNull.orEmpty(),
)
val hasReleaseSigning = releaseSigning.values.all(String::isNotBlank)

android {
    namespace = "uk.thewyj.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "uk.thewyj.app"
        // Task 24.2 compatibility baseline: Android 11 (API 30). Raising the
        // floor removes legacy branches that only existed for Android 8–10 and
        // matches the browsers/WebView versions the cloud TTS player needs.
        minSdk = 30
        targetSdk = 36
        versionCode = 13
        versionName = "1.3.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "THEWYJ_BASE_URL", "\"$thewyjBaseUrl\"")
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(releaseSigning.getValue("storeFile"))
                storePassword = releaseSigning.getValue("storePassword")
                keyAlias = releaseSigning.getValue("keyAlias")
                keyPassword = releaseSigning.getValue("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }

    packaging {
        resources.excludes += setOf(
            "/META-INF/{AL2.0,LGPL2.1}",
            "/META-INF/DEPENDENCIES",
        )
    }
}

ksp {
    // Exported schemas are committed so Task 23 can verify safe upgrades.
    arg("room.schemaLocation", "$projectDir/schemas")
    arg("room.incremental", "true")
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.documentfile)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.core)
    implementation(libs.kotlinx.coroutines.android)
    // Task 24.1: on-device OCR for the WeChat visual verification fallback.
    // Unbundled variant: the Chinese/Latin model is downloaded by Play services
    // on demand, so the APK stays small. Text never leaves the device.
    // Bundled ML Kit: the OCR model ships inside the APK (no Google Play
    // Services model download, works offline on the first run, and works on
    // devices without GMS). Do not switch back to play-services-mlkit-*.
    implementation("com.google.mlkit:text-recognition-chinese:16.0.1")

    testImplementation(libs.junit)
    testImplementation("org.json:json:20240303")
    testImplementation(libs.robolectric)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
    androidTestImplementation(libs.androidx.room.testing)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
