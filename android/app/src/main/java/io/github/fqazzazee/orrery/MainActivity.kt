// SPDX-License-Identifier: GPL-2.0-or-later

package io.github.fqazzazee.orrery

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.window.OnBackInvokedDispatcher
import org.json.JSONObject

// The app: Orrery full screen, with its settings, and the way to the wallpaper and the
// screensaver. Opened as WallpaperSettings or DreamSettings (the system's settings buttons for
// them), it opens those sections of the settings.
class MainActivity : Activity(), PageHost {
    private lateinit var page: Page
    private var immersive = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        }
        if (Build.VERSION.SDK_INT >= 28)
            window.attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES

        val section = section(intent)
        page = Page(this, "app", this, if (section != null) "?settings=$section" else "")
        setContentView(page.web)
        page.web.setOnApplyWindowInsetsListener { v, insets ->
            sendInsets(insets)
            v.onApplyWindowInsets(insets)
        }
        Power.watch(this, page)
        if (Build.VERSION.SDK_INT >= 33)
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { back() }
    }

    private fun section(intent: Intent?): String? = when (intent?.component?.className) {
        "$packageName.WallpaperSettings" -> "wallpaper"
        "$packageName.DreamSettings" -> "dream"
        else -> intent?.getStringExtra("settings")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        section(intent)?.let { page.send("settings", it) }
    }

    // The status and navigation bars and the cutout, in CSS pixels: the page keeps its
    // controls clear of them.
    private fun sendInsets(insets: WindowInsets) {
        val d = resources.displayMetrics.density
        val (l, t, r, b) = if (Build.VERSION.SDK_INT >= 30) {
            val i = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            listOf(i.left, i.top, i.right, i.bottom)
        } else {
            @Suppress("DEPRECATION")
            listOf(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
        }
        page.send("insets", JSONObject().put("left", l / d).put("top", t / d).put("right", r / d).put("bottom", b / d))
    }

    private fun back() {
        page.back { handled -> if (!handled) finish() }
    }

    // Before Android 13; from 13 on, the OnBackInvokedCallback above has the back gesture.
    @Deprecated("Android 13 and later call the OnBackInvokedCallback instead")
    @SuppressLint("GestureBackNavigation")
    override fun onBackPressed() {
        back()
    }

    override fun onResume() {
        super.onResume()
        page.resume()
        applyImmersive()
    }

    override fun onPause() {
        page.pause()
        super.onPause()
    }

    override fun onDestroy() {
        Power.unwatch(this, page)
        page.destroy()
        super.onDestroy()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applyImmersive()
    }

    private fun applyImmersive() {
        if (Build.VERSION.SDK_INT >= 30) {
            val c = window.insetsController ?: return
            if (immersive) {
                c.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                c.hide(WindowInsets.Type.systemBars())
            } else {
                c.show(WindowInsets.Type.systemBars())
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                (if (immersive) View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY else 0)
        }
    }

    override fun call(action: String, arg: String): String = when (action) {
        "exit" -> {
            finish()
            "yes"
        }
        "keepScreenOn" -> {
            if (arg == "true") window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            "yes"
        }
        "immersive" -> {
            immersive = arg == "true"
            applyImmersive()
            "yes"
        }
        else -> Actions.call(this, action)
    }
}
