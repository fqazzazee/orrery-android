// SPDX-License-Identifier: GPL-2.0-or-later

plugins {
    alias(libs.plugins.android.application)
}

// A release's version: -PorreryVersion=1.2.3 (make apk passes it). Its versionCode is
// major·10000 + minor·100 + patch, so each release installs over the one before.
val orreryVersion = providers.gradleProperty("orreryVersion").orNull
val orreryVersionCode = orreryVersion?.let { v ->
    val parts = Regex("""(\d+)\.(\d+)\.(\d+)""").matchEntire(v)?.groupValues?.drop(1)?.map(String::toInt)
    require(parts != null && parts[1] < 100 && parts[2] < 100) { "orreryVersion $v: want X.Y.Z, minor and patch under 100" }
    (parts[0] * 10000 + parts[1] * 100 + parts[2]).also { require(it > 0) { "orreryVersion $v: 0.0.0 has no versionCode" } }
}

// The release key, from the environment (ORRERY_SIGNING_KEYSTORE, a PKCS12 file;
// ORRERY_SIGNING_PASSWORD; ORRERY_SIGNING_ALIAS). It is never in the repository. Without it, a
// release build is left unsigned.
val signingKeystore = providers.environmentVariable("ORRERY_SIGNING_KEYSTORE").orNull

android {
    namespace = "io.github.fqazzazee.orrery"
    compileSdk = 37
    defaultConfig {
        applicationId = "io.github.fqazzazee.orrery"
        // Android 8: adaptive icons, and a WebView that runs ES modules and import maps once
        // updated (Chrome 89 and later).
        minSdk = 26
        targetSdk = 37
        versionCode = orreryVersionCode ?: 1
        versionName = orreryVersion ?: "0.0.0-dev"
    }
    signingConfigs {
        if (signingKeystore != null) {
            create("release") {
                storeFile = file(signingKeystore)
                storeType = "pkcs12"
                storePassword = providers.environmentVariable("ORRERY_SIGNING_PASSWORD").get()
                keyAlias = providers.environmentVariable("ORRERY_SIGNING_ALIAS").get()
                // A PKCS12 file has one password, for the file and the key.
                keyPassword = storePassword
            }
        }
    }
    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    buildFeatures {
        buildConfig = true
    }
    // The page: web/ and the modules of lib/ it shares with the GNOME extension.
    sourceSets.getByName("main").assets.directories.add("build/web-assets")
    lint {
        warningsAsErrors = true
        // A newer AndroidX or SDK is a change of its own, not a lint failure.
        disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion", "OldTargetApi")
    }
}

dependencies {
    implementation(libs.webkit)
}

// The page's files, into the assets: all of web/, and of lib/ only the modules that run in a
// browser (the rest are the extension's, on GNOME Shell's Clutter and St).
val webAssets = tasks.register<Sync>("webAssets") {
    into(layout.buildDirectory.dir("web-assets"))
    from(rootProject.file("../web")) { into("web") }
    from(rootProject.file("../lib")) {
        into("lib")
        include("astro.js", "bodies.js", "facts.js", "lunar.js", "missions.js", "moon-missions.js",
            "render.js", "satellites.js", "tour.js", "waypoints.js")
    }
}
tasks.named("preBuild") { dependsOn(webAssets) }
