// SPDX-License-Identifier: GPL-2.0-or-later

package io.github.fqazzazee.orrery

import android.app.KeyguardManager
import android.app.Presentation
import android.app.WallpaperManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.os.Build
import android.os.Bundle
import android.service.wallpaper.WallpaperService
import android.util.Log
import android.view.SurfaceHolder
import org.json.JSONObject

// The live wallpaper, on the home screen and the lock screen. A wallpaper draws on a surface,
// not in a window, so the page's WebView is shown on a private virtual display that renders
// into that surface.
class OrreryWallpaper : WallpaperService() {
    override fun onCreateEngine(): Engine = OrreryEngine()

    inner class OrreryEngine : Engine(), PageHost {
        private var display: VirtualDisplay? = null
        private var presentation: Presentation? = null
        private var page: Page? = null
        private var visible = false

        // Unlocked, the wallpaper is the home screen's again; switched off, it will wake on
        // the lock screen.
        private val keyguard = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                syncSurface(locked = intent.action == Intent.ACTION_SCREEN_OFF)
            }
        }

        override fun onCreate(holder: SurfaceHolder) {
            super.onCreate(holder)
            setTouchEventsEnabled(false)
            setOffsetNotificationsEnabled(true)
            Power.register(this@OrreryWallpaper, keyguard, IntentFilter().apply {
                addAction(Intent.ACTION_USER_PRESENT)
                addAction(Intent.ACTION_SCREEN_OFF)
            })
        }

        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            super.onSurfaceChanged(holder, format, width, height)
            val dpi = resources.displayMetrics.densityDpi
            val d = display
            if (d != null) {
                d.resize(width, height, dpi)
                d.surface = holder.surface
                return
            }
            try {
                val dm = getSystemService(DisplayManager::class.java)
                val vd = dm.createVirtualDisplay("orrery-wallpaper", width, height, dpi, holder.surface, 0)
                display = vd
                val p = Page(this@OrreryWallpaper, surfaceNow(), this)
                page = p
                presentation = Presentation(this@OrreryWallpaper, vd.display).apply {
                    setContentView(p.web)
                    show()
                }
                Power.watch(this@OrreryWallpaper, p)
                if (!visible) p.pause()
            } catch (e: Exception) {
                Log.e(Page.TAG, "wallpaper: $e")
            }
        }

        override fun onSurfaceDestroyed(holder: SurfaceHolder) {
            tearDown()
            super.onSurfaceDestroyed(holder)
        }

        override fun onDestroy() {
            tearDown()
            try {
                unregisterReceiver(keyguard)
            } catch (_: Exception) {
            }
            super.onDestroy()
        }

        private fun tearDown() {
            page?.let {
                Power.unwatch(this@OrreryWallpaper, it)
                it.destroy()
            }
            page = null
            presentation?.dismiss()
            presentation = null
            display?.release()
            display = null
        }

        override fun onVisibilityChanged(visible: Boolean) {
            super.onVisibilityChanged(visible)
            this.visible = visible
            val p = page ?: return
            if (visible) {
                syncSurface()
                p.resume()
            } else {
                p.pause()
            }
        }

        private fun surfaceNow(locked: Boolean? = null): String {
            // Set for the lock screen alone (Android 14 and later): always the lock screen.
            if (Build.VERSION.SDK_INT >= 34 && wallpaperFlags == WallpaperManager.FLAG_LOCK)
                return "lock"
            val isLocked = locked ?: getSystemService(KeyguardManager::class.java).isKeyguardLocked
            return if (isLocked && !isPreview) "lock" else "wallpaper"
        }

        private fun syncSurface(locked: Boolean? = null) {
            page?.surface = surfaceNow(locked)
        }

        // Swiping between home screen pages turns the system a little.
        override fun onOffsetsChanged(xOffset: Float, yOffset: Float, xStep: Float, yStep: Float, xPixels: Int, yPixels: Int) {
            page?.send("offset", xOffset.toDouble())
        }

        // A tap on an empty part of the home screen shows a card for what is there.
        override fun onCommand(action: String, x: Int, y: Int, z: Int, extras: Bundle?, resultRequested: Boolean): Bundle? {
            if (action == WallpaperManager.COMMAND_TAP) {
                val d = resources.displayMetrics.density
                page?.send("tap", JSONObject().put("x", x / d).put("y", y / d))
            }
            return null
        }

        override fun call(action: String, arg: String): String = Actions.call(this@OrreryWallpaper, action)
    }
}
