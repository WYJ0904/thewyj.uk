plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
}

val thewyjBaseUrl = providers.gradleProperty("THEWYJ_BASE_URL")
    .orElse("https://thewyj.uk")
    .get()
val paymentDeviceTest = providers.gradleProperty("THEWYJ_PAYMENT_DEVICE_TEST").orElse("false").get().toBoolean()
// Targets the ordinary R8 build for external instrumentation; it does not enable payment injection.
val releaseAcceptance = providers.gradleProperty("THEWYJ_RELEASE_ACCEPTANCE").orElse("false").get().toBoolean()

val releaseSigning = mapOf(
    "storeFile" to providers.environmentVariable("THEWYJ_ANDROID_KEYSTORE_FILE").orNull.orEmpty(),
    "storePassword" to providers.environmentVariable("THEWYJ_ANDROID_KEYSTORE_PASSWORD").orNull.orEmpty(),
    "keyAlias" to providers.environmentVariable("THEWYJ_ANDROID_KEY_ALIAS").orNull.orEmpty(),
    "keyPassword" to providers.environmentVariable("THEWYJ_ANDROID_KEY_PASSWORD").orNull.orEmpty(),
)
val hasReleaseSigning = releaseSigning.values.all(String::isNotBlank)

android {
    testBuildType = if (paymentDeviceTest || releaseAcceptance) "release" else "debug"
    namespace = "uk.thewyj.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "uk.thewyj.app"
        // Task 24.2 compatibility baseline: Android 11 (API 30). Raising the
        // floor removes legacy branches that only existed for Android 8–10 and
        // matches the browsers/WebView versions the cloud TTS player needs.
        minSdk = 30
        targetSdk = 36
        // P4 workspace presentation; preserve package, data and signing identity.
        versionCode = 50
        versionName = "1.3.37"
        // Candidate overrides do not advance committed Stable metadata or pointers.
        val candidateCode = providers.gradleProperty("THEWYJ_CANDIDATE_VERSION_CODE").orNull
        val candidateName = providers.gradleProperty("THEWYJ_CANDIDATE_VERSION_NAME").orNull
        if (candidateCode != null || candidateName != null) {
            require(candidateCode != null && candidateName != null)
            require(candidateCode.toInt() > requireNotNull(versionCode))
            require(candidateName.matches(Regex("[0-9]+(\\.[0-9]+){2,3}")))
            versionCode = candidateCode.toInt()
            versionName = candidateName
        }
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "THEWYJ_BASE_URL", "\"$thewyjBaseUrl\"")
        buildConfigField("boolean", "PAYMENT_DIAGNOSTICS", providers.gradleProperty("THEWYJ_PAYMENT_DIAGNOSTICS").orElse("false").get().toBoolean().toString())
        buildConfigField("boolean", "PAYMENT_DEVICE_TEST", paymentDeviceTest.toString())
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
            isMinifyEnabled = !paymentDeviceTest
            isShrinkResources = !paymentDeviceTest
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
                "proguard-runtime-contracts.pro",
            )
            testProguardFiles("proguard-test-rules.pro")
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
    sourceSets.getByName("test").resources.directories.add("../../qa/task25")
    sourceSets.getByName("androidTest").assets.directories.add("../../qa/task25")

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
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
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
