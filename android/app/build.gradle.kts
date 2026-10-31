plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.sekullar.pyramid"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.sekullar.pyramid"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildTypes {
        // The APK people download is signed with the local debug key (same as Phoneix): an installed development build
        // updates in place, and no signing key ever has to be committed. It cannot be debugged from outside.
        release { signingConfig = signingConfigs.getByName("debug"); isMinifyEnabled = false }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("io.noties.markwon:core:4.6.2") // Markdown preview
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0") // QR scan, no camera permission needed
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
