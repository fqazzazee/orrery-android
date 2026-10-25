// SPDX-License-Identifier: GPL-2.0-or-later

package io.github.fqazzazee.orrery

import android.service.dreams.DreamService

// The screensaver: a story or a tour while the phone charges or sits in its dock. A touch
// ends it.
class OrreryDream : DreamService(), PageHost {
    private var page: Page? = null

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        isInteractive = false
        isFullscreen = true
        isScreenBright = true
        val p = Page(this, "dream", this)
        page = p
        setContentView(p.web)
        Power.watch(this, p)
    }

    override fun onDreamingStarted() {
        super.onDreamingStarted()
        page?.resume()
    }

    override fun onDreamingStopped() {
        page?.pause()
        super.onDreamingStopped()
    }

    override fun onDetachedFromWindow() {
        page?.let {
            Power.unwatch(this, it)
            it.destroy()
        }
        page = null
        super.onDetachedFromWindow()
    }

    override fun call(action: String, arg: String): String = Actions.call(this, action)
}
