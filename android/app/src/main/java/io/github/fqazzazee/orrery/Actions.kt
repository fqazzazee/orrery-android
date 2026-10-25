// SPDX-License-Identifier: GPL-2.0-or-later

package io.github.fqazzazee.orrery

import android.app.WallpaperManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.util.Log

// What every page may ask for: to be the wallpaper or the screensaver.
object Actions {
    fun call(context: Context, action: String): String = when (action) {
        // Android lets an app ask for its live wallpaper, but the person picks where it goes:
        // the home screen, the lock screen or both.
        "wallpaper", "lockscreen" -> start(context,
            Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER).putExtra(
                WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT,
                ComponentName(context, OrreryWallpaper::class.java)),
            Intent(WallpaperManager.ACTION_LIVE_WALLPAPER_CHOOSER))
        "screensaver" -> start(context, Intent(Settings.ACTION_DREAM_SETTINGS), Intent(Settings.ACTION_DISPLAY_SETTINGS))
        else -> "no"
    }

    private fun start(context: Context, vararg intents: Intent): String {
        for (intent in intents) {
            try {
                context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return "yes"
            } catch (e: Exception) {
                Log.w(Page.TAG, "${intent.action}: $e")
            }
        }
        return "no"
    }
}
