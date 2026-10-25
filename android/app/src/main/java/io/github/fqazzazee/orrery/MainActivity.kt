// SPDX-License-Identifier: GPL-2.0-or-later

package io.github.fqazzazee.orrery

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
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
        // Edge to edge, the bars transparent (the theme's): Android 15 and later always are.
        if (Build.VERSION.SDK_INT >= 35) {
            // Nothing to do.
        } else if (Build.VERSION.SDK_INT >= 30) {
            @Suppress("DEPRECATION")
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
        "refreshRate" -> Refresh.apply(window, if (Build.VERSION.SDK_INT >= 30) display else Refresh.display(this),
            arg.toFloatOrNull() ?: 60f)
        "immersive" -> {
            immersive = arg == "true"
            applyImmersive()
            "yes"
        }
        "pickMusicFolder" -> {
            pickFolder()
            "yes"
        }
        else -> Actions.call(this, action, arg)
    }

    // Android's folder picker: the folder chosen is kept readable across restarts, and the
    // settings tell every page.
    @Suppress("DEPRECATION")
    private fun pickFolder() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        try {
            startActivityForResult(intent, PICK_FOLDER)
        } catch (e: Exception) {
            Log.w(Page.TAG, "folder picker: $e")
        }
    }

    @Deprecated("The AndroidX result API needs AndroidX Activity, which this app does without")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        val tree = data?.data
        if (requestCode != PICK_FOLDER || resultCode != RESULT_OK || tree == null) return
        try {
            contentResolver.takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (e: Exception) {
            Log.w(Page.TAG, "music folder: $e")
        }
        // Only the folder in use stays granted.
        for (p in contentResolver.persistedUriPermissions)
            if (p.uri != tree) contentResolver.releasePersistableUriPermission(p.uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        val name = try {
            FolderMusic.name(this, tree)
        } catch (_: Exception) {
            "Music"
        }
        Hub.save(this, null, "music-folder-name", JSONObject.quote(name))
        Hub.save(this, null, "music-folder", JSONObject.quote(tree.toString()))
        Hub.save(this, null, "music-source", JSONObject.quote("folder"))
    }

    private companion object {
        const val PICK_FOLDER = 1
    }
}
