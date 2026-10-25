// SPDX-License-Identifier: GPL-2.0-or-later

package io.github.fqazzazee.orrery

import android.content.Context
import android.hardware.display.DisplayManager
import android.view.Display
import android.view.Window
import kotlin.math.roundToInt

// The screen's refresh rate for a frame rate: the slowest the screen offers that keeps up with
// it, so 30 frames a second do not keep a 120 Hz screen at 120, and 90 or 120 get a screen
// that fast where there is one.
object Refresh {
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
        val modes = modes(display).sortedBy { it.refreshRate }
        return modes.firstOrNull { it.refreshRate >= fps - 1 } ?: modes.lastOrNull()
    }

    fun rateFor(display: Display, fps: Float): Float = modeFor(display, fps)?.refreshRate ?: 60f

    // For a window of the app's own: the activity's, the screensaver's.
    fun apply(window: Window, display: Display?, fps: Float): String {
        val mode = display?.let { modeFor(it, fps) } ?: return "no"
        val attrs = window.attributes
        if (attrs.preferredDisplayModeId != mode.modeId) {
            attrs.preferredDisplayModeId = mode.modeId
            window.attributes = attrs
        }
        return "yes"
    }
}
