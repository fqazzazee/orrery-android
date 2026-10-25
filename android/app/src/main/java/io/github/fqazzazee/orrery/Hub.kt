// SPDX-License-Identifier: GPL-2.0-or-later

package io.github.fqazzazee.orrery

import android.app.WallpaperManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

// The settings, one store for the app, the wallpaper and the screensaver: each key's value as
// JSON text, in shared preferences. A change made on one page reaches the others at once.
object Hub {
    val pages = mutableSetOf<Page>()

    private fun prefs(context: Context) = context.getSharedPreferences("settings", Context.MODE_PRIVATE)

    fun settings(context: Context): JSONObject {
        val out = JSONObject()
        for ((key, text) in prefs(context).all) {
            try {
                out.put(key, JSONTokener(text as String).nextValue())
            } catch (_: Exception) {
            }
        }
        return out
    }

    // json "null" removes the key: back to its default. from is the page that made the change
    // (it knows already); null tells every page.
    fun save(context: Context, from: Page?, key: String, json: String) {
        val value = try {
            JSONTokener(json).nextValue()
        } catch (_: Exception) {
            return
        }
        val edit = prefs(context).edit()
        if (value == JSONObject.NULL) edit.remove(key) else edit.putString(key, json)
        edit.apply()
        val message = JSONObject().put("key", key).put("value", value)
        for (page in pages.toList())
            if (page !== from) page.send("setting", message)
    }

    // A message for every page.
    fun tell(type: String, data: Any?) {
        for (page in pages.toList()) page.send(type, data)
    }

    // Whether Orrery is the wallpaper, on the lock screen, the screensaver.
    fun status(context: Context): JSONObject {
        val ours = ComponentName(context, OrreryWallpaper::class.java)
        val wm = WallpaperManager.getInstance(context)
        val home = wm.wallpaperInfo?.component == ours
        // The lock screen shows the home screen's wallpaper unless it was given one of its own.
        val lock = try {
            if (Build.VERSION.SDK_INT >= 34)
                wm.getWallpaperInfo(WallpaperManager.FLAG_LOCK)?.component == ours ||
                    home && wm.getWallpaperId(WallpaperManager.FLAG_LOCK) < 0
            else
                home && wm.getWallpaperId(WallpaperManager.FLAG_LOCK) < 0
        } catch (_: Exception) {
            false
        }
        val dream = try {
            Settings.Secure.getString(context.contentResolver, "screensaver_components")
                ?.contains(OrreryDream::class.java.name) == true
        } catch (_: Exception) {
            false
        }
        return JSONObject()
            .put("wallpaper", home)
            .put("lock", lock)
            .put("dream", dream)
            .put("version", BuildConfig.VERSION_NAME)
            .put("sdk", Build.VERSION.SDK_INT)
            .put("refreshRates", JSONArray(Refresh.display(context)?.let { Refresh.rates(it) }?.map { it.toDouble() } ?: listOf<Double>()))
            .put("lockNote", "The lock screen shows the live wallpaper unless it has a picture of its own: " +
                "to give it Orrery, set the wallpaper again and choose the lock screen too.")
    }
}
