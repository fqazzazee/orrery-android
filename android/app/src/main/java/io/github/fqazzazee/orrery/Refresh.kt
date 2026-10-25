// SPDX-License-Identifier: GPL-2.0-or-later

package io.github.fqazzazee.orrery

import android.content.Context
import android.hardware.display.DisplayManager
import android.view.Display
import android.view.Window
import kotlin.math.roundToInt

// A faster screen for 90 or 120 frames a second: the slowest refresh rate the screen offers
// that keeps up. At 60 and below Orrery asks for nothing and the system chooses, as before:
// asking for less slowed everything on screens with 24, 30 or 48 Hz modes, not just Orrery.
object Refresh {
    const val DEFAULT = 60f

    fun display(context: Context): Display? =
        context.getSystemService(DisplayManager::class.java)?.getDisplay(Display.DEFAULT_DISPLAY)

    // The modes at the display's current resolution: switching between them does not change
    // the picture's size.
    private fun modes(display: Display): List<Display.Mode> {
        val now = display.mode
        return display.supportedModes.filter {
            it.physicalWidth == now.physicalWidth && it.physicalHeight == now.physicalHeight
        }
    }

    fun rates(display: Display): List<Float> =
        modes(display).map { it.refreshRate }.distinctBy { it.roundToInt() }.sorted()

    private fun modeFor(display: Display, fps: Float): Display.Mode? {
        if (fps <= DEFAULT) return null
        val modes = modes(display).sortedBy { it.refreshRate }
        return modes.firstOrNull { it.refreshRate >= fps - 1 } ?: modes.lastOrNull()
    }

    // 0: no preference.
    fun rateFor(display: Display, fps: Float): Float = modeFor(display, fps)?.refreshRate ?: 0f

    // For a window of the app's own: the activity's, the screensaver's.
    fun apply(window: Window, display: Display?, fps: Float): String {
        val id = display?.let { modeFor(it, fps) }?.modeId ?: 0
        val attrs = window.attributes
        if (attrs.preferredDisplayModeId != id) {
            attrs.preferredDisplayModeId = id
            window.attributes = attrs
        }
        return "yes"
    }
}
