// SPDX-License-Identifier: GPL-2.0-or-later

package io.github.fqazzazee.orrery

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import org.json.JSONObject

// The charger and battery saver, for the pages: they slow down on battery saver, and the
// sunlight view can follow the charger.
object Power {
    private val watchers = mutableSetOf<Page>()
    private var receiver: BroadcastReceiver? = null

    fun latest(context: Context): JSONObject? {
        val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return null
        val plugged = battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
        val saver = context.getSystemService(PowerManager::class.java)?.isPowerSaveMode == true
        return JSONObject().put("onBattery", !plugged).put("charging", plugged).put("saver", saver)
    }

    fun watch(context: Context, page: Page) {
        watchers += page
        if (receiver != null) return
        val app = context.applicationContext
        receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                val now = latest(app) ?: return
                // Just plugged in or out, the battery's sticky state can still say the
                // opposite: the broadcast itself is right.
                val plugged = when (intent.action) {
                    Intent.ACTION_POWER_CONNECTED -> true
                    Intent.ACTION_POWER_DISCONNECTED -> false
                    else -> now.getBoolean("charging")
                }
                now.put("charging", plugged).put("onBattery", !plugged)
                for (p in watchers.toList()) p.send("power", now)
            }
        }
        register(app, receiver!!, IntentFilter().apply {
            addAction(Intent.ACTION_POWER_CONNECTED)
            addAction(Intent.ACTION_POWER_DISCONNECTED)
            addAction(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED)
        })
    }

    // For the system's broadcasts, which reach a receiver that is not exported (before Android
    // 13 there is no flag to say so).
    @SuppressLint("UnspecifiedRegisterReceiverFlag")
    fun register(context: Context, receiver: BroadcastReceiver, filter: IntentFilter) {
        if (Build.VERSION.SDK_INT >= 33)
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        else
            context.registerReceiver(receiver, filter)
    }

    fun unwatch(context: Context, page: Page) {
        watchers -= page
        if (watchers.isEmpty()) {
            receiver?.let { context.applicationContext.unregisterReceiver(it) }
            receiver = null
        }
    }
}
