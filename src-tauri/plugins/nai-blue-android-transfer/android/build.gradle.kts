plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.bluhair.naisblue.transfer"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation(project(":tauri-android"))

    // WorkManager owns durable, constraint-aware scheduling and connects the
    // transfer scheduler to Android's JobScheduler/foreground-service bridge.
    // Apache-2.0 WorkManager 2.11.2 supports this module's minSdk 24 and adds
    // no transport provider SDK.
    implementation("androidx.work:work-runtime-ktx:2.11.2")
}
