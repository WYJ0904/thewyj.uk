plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "uk.thewyj.task26preview"
    compileSdk = 36
    defaultConfig {
        applicationId = "uk.thewyj.app.preview"
        minSdk = 30
        targetSdk = 36
        versionCode = 1
        versionName = "0.0.1-task26-preview"
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    lint { abortOnError = true }
}

// This isolated acceptance application has no production/release variant.
androidComponents {
    beforeVariants(selector().withBuildType("release")) { it.enable = false }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    testImplementation(libs.junit)
}
