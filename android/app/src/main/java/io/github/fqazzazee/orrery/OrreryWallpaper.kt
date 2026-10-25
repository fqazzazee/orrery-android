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
import android.hardware.display.VirtualDisplayConfig
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.service.wallpaper.WallpaperService
import android.util.Log
import android.view.Surface
import android.view.SurfaceHolder
import android.view.ViewGroup
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
        private var holder: SurfaceHolder? = null
        private var width = 0
        private var height = 0
        // The refresh rate asked for, past 60; 0 leaves it to the system.
        private var rate = 0f

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
            this.holder = holder
            this.width = width
            this.height = height
            val d = display
            if (d != null) {
                d.resize(width, height, resources.displayMetrics.densityDpi)
                d.surface = holder.surface
                return
            }
            show()
        }

        // The page on a virtual display drawing into the wallpaper's surface. Shown again with a
        // new display when the refresh rate changes: a virtual display's rate is set when it is
        // made (Android 14 and later; before, it is 60).
        private fun show() {
            val holder = holder ?: return
            try {
                val dm = getSystemService(DisplayManager::class.java)
                val dpi = resources.displayMetrics.densityDpi
                val vd = if (Build.VERSION.SDK_INT >= 34 && rate > 0f)
                    dm.createVirtualDisplay(
                        VirtualDisplayConfig.Builder("orrery-wallpaper", width, height, dpi)
                            .setSurface(holder.surface)
                            .setRequestedRefreshRate(rate)
                            .build(),
                        null, null)
                else
                    dm.createVirtualDisplay("orrery-wallpaper", width, height, dpi, holder.surface, 0)
                if (vd == null) {
                    Log.e(Page.TAG, "wallpaper: no virtual display")
                    return
                }
                display = vd
                val p = page ?: Page(this@OrreryWallpaper, surfaceNow(), this).also {
                    page = it
                    Power.watch(this@OrreryWallpaper, it)
                    if (!visible) it.pause()
                }
                (p.web.parent as? ViewGroup)?.removeView(p.web)
                presentation = Presentation(this@OrreryWallpaper, vd.display).apply {
                    setContentView(p.web)
                    show()
                }
                setSurfaceRate()
            } catch (e: Exception) {
                Log.e(Page.TAG, "wallpaper: $e")
            }
        }

        // A hint to the compositor (Android 11 and later); 0 takes it back.
        private fun setSurfaceRate() {
            if (Build.VERSION.SDK_INT < 30) return
            try {
                holder?.surface?.setFrameRate(rate, Surface.FRAME_RATE_COMPATIBILITY_DEFAULT)
            } catch (e: Exception) {
                Log.w(Page.TAG, "frame rate: $e")
            }
        }

        private fun setRate(fps: Float) {
            val want = Refresh.display(this@OrreryWallpaper)?.let { Refresh.rateFor(it, fps) } ?: return
            if (want == rate) return
            rate = want
            if (Build.VERSION.SDK_INT >= 34 && display != null) {
                presentation?.dismiss()
                presentation = null
                display?.release()
                display = null
                show()
            } else {
                setSurfaceRate()
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
            holder = null
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

        override fun call(action: String, arg: String): String = when (action) {
            // After the call returns: the page should not wait while it moves to a new display.
            "refreshRate" -> {
                arg.toFloatOrNull()?.let { fps -> Handler(Looper.getMainLooper()).post { setRate(fps) } }
                "yes"
            }
            else -> Actions.call(this@OrreryWallpaper, action, arg)
        }
    }
}
