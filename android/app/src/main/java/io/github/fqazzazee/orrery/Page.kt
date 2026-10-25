// SPDX-License-Identifier: GPL-2.0-or-later

package io.github.fqazzazee.orrery

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

// What a page asks of the component that shows it: the app, the live wallpaper or the
// screensaver. call() returns "no" for what it cannot do.
interface PageHost {
    fun call(action: String, arg: String): String = "no"
}

// One Orrery page in a WebView: the web app from the APK's assets, served over https by
// WebViewAssetLoader so its ES modules load, with the bridge web/js/host.js talks to.
@SuppressLint("SetJavaScriptEnabled")
class Page(context: Context, surface: String, private val host: PageHost, query: String = "") {
    val web = WebView(context)
    var surface = surface
        set(value) {
            if (field == value) return
            field = value
            send("surface", value)
        }

    private val main = Handler(Looper.getMainLooper())
    private var ready = false
    // Messages for the page, held until it has started.
    private val pending = mutableListOf<Pair<String, Any?>>()

    init {
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
            .build()
        web.setBackgroundColor(Color.BLACK)
        web.isVerticalScrollBarEnabled = false
        web.isHorizontalScrollBarEnabled = false
        web.overScrollMode = WebView.OVER_SCROLL_NEVER
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            // The ambient music starts without a tap first.
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            textZoom = 100
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            // Links (the About section's) open in the browser.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == ASSET_HOST) return false
                open(view.context, request.url.toString())
                return true
            }
        }
        web.addJavascriptInterface(Bridge(), "OrreryHost")
        web.loadUrl("https://$ASSET_HOST/assets/web/index.html$query")
        Hub.pages += this
    }

    // A message for window.orrery.fromHost(type, data).
    fun send(type: String, data: Any? = null) {
        main.post {
            if (!ready) {
                pending += type to data
                return@post
            }
            val json = JSONObject.wrap(data)?.toString() ?: "null"
            web.evaluateJavascript("window.orrery && orrery.fromHost(${JSONObject.quote(type)}, $json)", null)
        }
    }

    // Asks the page to go back a step: done is told whether it did.
    fun back(done: (Boolean) -> Unit) {
        if (!ready) return done(false)
        web.evaluateJavascript("window.orrery ? orrery.back() : false") { done(it == "true") }
    }

    fun resume() {
        web.onResume()
        send("visible", true)
    }

    fun pause() {
        send("visible", false)
        web.onPause()
    }

    fun destroy() {
        Hub.pages -= this
        web.stopLoading()
        web.removeJavascriptInterface("OrreryHost")
        web.destroy()
    }

    // Called by the page, on a thread of WebView's: what touches views goes to the main thread.
    private inner class Bridge {
        @JavascriptInterface
        fun settings(): String = Hub.settings(web.context).toString()

        @JavascriptInterface
        fun save(key: String, json: String) {
            main.post { Hub.save(web.context, this@Page, key, json) }
        }

        @JavascriptInterface
        fun surface(): String = surface

        @JavascriptInterface
        fun call(action: String, arg: String): String {
            if (action == "open") {
                main.post { open(web.context, arg) }
                return "yes"
            }
            var result = "no"
            val done = java.util.concurrent.CountDownLatch(1)
            main.post {
                result = try {
                    host.call(action, arg)
                } catch (e: Exception) {
                    Log.w(TAG, "$action: $e")
                    "no"
                }
                done.countDown()
            }
            done.await(2, java.util.concurrent.TimeUnit.SECONDS)
            return result
        }

        @JavascriptInterface
        fun status(): String = Hub.status(web.context).toString()

        @JavascriptInterface
        fun ready() {
            main.post {
                ready = true
                val held = pending.toList()
                pending.clear()
                for ((type, data) in held) send(type, data)
                Power.latest(web.context)?.let { send("power", it) }
            }
        }
    }

    companion object {
        const val TAG = "Orrery"
        const val ASSET_HOST = "appassets.androidplatform.net"

        fun open(context: Context, url: String) {
            try {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (e: Exception) {
                Log.w(TAG, "open $url: $e")
            }
        }
    }
}
