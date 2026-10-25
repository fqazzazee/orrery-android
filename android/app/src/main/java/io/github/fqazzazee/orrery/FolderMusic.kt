// SPDX-License-Identifier: GPL-2.0-or-later

package io.github.fqazzazee.orrery

import android.annotation.SuppressLint
import android.content.Context
import android.database.Cursor
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.DocumentsContract
import android.util.Log
import org.json.JSONObject

// Your own music: the tracks in a folder Android gave the app access to (and its subfolders),
// shuffled, every one once before any plays again, as the GNOME extension plays them. The page
// says whether it wants music and how loud; this fades in and out, and steps aside for calls
// and other apps' sound. One player for the app and the screensaver.
// It keeps only the application's context, which lives as long as the process: no leak.
@SuppressLint("StaticFieldLeak")
object FolderMusic {
    private const val FADE_IN_MS = 2500f
    private const val FADE_OUT_MS = 1200f
    private const val STEP_MS = 50L
    private val EXTENSIONS = Regex("""\.(mp3|ogg|oga|opus|flac|wav|m4a|aac)$""", RegexOption.IGNORE_CASE)

    private val main = Handler(Looper.getMainLooper())
    // The application's context (see the annotation above).
    private var context: Context? = null
    private var folder = ""
    private var tracks: List<Uri> = emptyList()
    private var listing = false
    private var order = ArrayDeque<Int>()
    private var player: MediaPlayer? = null
    private var prepared = false
    private var failures = 0
    private var wanted = false
    private var volume = 0.35f
    private var level = 0f
    private var focus: AudioFocusRequest? = null
    private var hasFocus = false
    private var ducked = false
    private var error: String? = null

    private val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
        .build()

    // {play, folder, volume} from the page.
    fun call(context: Context, json: String): String {
        val o = try {
            JSONObject(json)
        } catch (_: Exception) {
            return "no"
        }
        this.context = context.applicationContext
        volume = o.optDouble("volume", volume.toDouble()).toFloat().coerceIn(0f, 1f)
        val f = o.optString("folder", folder)
        if (f != folder) {
            folder = f
            stop()
            tracks = emptyList()
            error = null
            if (f.isNotEmpty()) list(f)
        }
        wanted = o.optBoolean("play", false)
        if (wanted) start() else fade()
        return "yes"
    }

    fun status(): JSONObject = JSONObject()
        .put("tracks", tracks.size)
        .put("listing", listing)
        .put("error", error ?: JSONObject.NULL)
        .put("playing", wanted && player?.isPlaying == true)

    // The folder's name, for the settings.
    fun name(context: Context, tree: Uri): String {
        val doc = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
        return context.contentResolver.query(doc, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)
            ?.use { if (it.moveToFirst()) it.getString(0) else null } ?: "Music"
    }

    // The folder's music files, read off the main thread: a big library takes a while.
    private fun list(f: String) {
        val ctx = context ?: return
        listing = true
        Thread {
            val found = mutableListOf<Uri>()
            var problem: String? = null
            try {
                val tree = Uri.parse(f)
                walk(ctx, tree, DocumentsContract.getTreeDocumentId(tree), found, 0)
                if (found.isEmpty()) problem = "no music files in it"
            } catch (e: Exception) {
                Log.w(Page.TAG, "music folder: $e")
                problem = "cannot read it; choose it again"
            }
            main.post {
                if (f != folder) return@post
                listing = false
                tracks = found
                error = problem
                order.clear()
                failures = 0
                Hub.tell("music", status())
                if (wanted) start()
            }
        }.start()
    }

    private fun walk(ctx: Context, tree: Uri, id: String, out: MutableList<Uri>, depth: Int) {
        if (depth > 6) return
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, id)
        val columns = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME)
        ctx.contentResolver.query(children, columns, null, null, null)?.use { c: Cursor ->
            while (c.moveToNext()) {
                val child = c.getString(0)
                val mime = c.getString(1) ?: ""
                val name = c.getString(2) ?: ""
                if (mime == DocumentsContract.Document.MIME_TYPE_DIR)
                    walk(ctx, tree, child, out, depth + 1)
                else if (mime.startsWith("audio/") || EXTENSIONS.containsMatchIn(name))
                    out += DocumentsContract.buildDocumentUriUsingTree(tree, child)
            }
        }
    }

    private fun start() {
        if (!requestFocus()) return
        val p = player
        if (p == null) {
            next()
        } else if (prepared && !p.isPlaying) {
            p.start()
        }
        fade()
    }

    private fun next() {
        val ctx = context ?: return
        releasePlayer()
        if (tracks.isEmpty()) return
        if (order.isEmpty()) order = ArrayDeque(tracks.indices.shuffled())
        val uri = tracks[order.removeFirst()]
        val p = MediaPlayer()
        player = p
        p.setAudioAttributes(attributes)
        p.setVolume(level, level)
        p.setOnPreparedListener {
            prepared = true
            failures = 0
            if (wanted && hasFocus) it.start()
        }
        p.setOnCompletionListener { next() }
        p.setOnErrorListener { _, what, extra ->
            Log.w(Page.TAG, "music: cannot play $uri ($what, $extra)")
            skip()
            true
        }
        try {
            p.setDataSource(ctx, uri)
            p.prepareAsync()
        } catch (e: Exception) {
            Log.w(Page.TAG, "music: $uri: $e")
            main.post { skip() }
        }
    }

    // A file that will not play: on to the next, unless none will.
    private fun skip() {
        failures++
        if (failures >= tracks.size) {
            releasePlayer()
            error = "none of its files would play"
            Hub.tell("music", status())
            return
        }
        next()
    }

    // Toward the volume while wanted, or to silence, then paused.
    private val fader = object : Runnable {
        override fun run() {
            val target = if (wanted && hasFocus) volume * (if (ducked) 0.3f else 1f) else 0f
            val step = STEP_MS / (if (target > level) FADE_IN_MS else FADE_OUT_MS)
            level = if (target > level) minOf(target, level + step) else maxOf(target, level - step)
            player?.setVolume(level, level)
            if (level != target) {
                main.postDelayed(this, STEP_MS)
            } else if (level == 0f && !wanted) {
                if (prepared && player?.isPlaying == true) player?.pause()
                abandonFocus()
            }
        }
    }

    private fun fade() {
        main.removeCallbacks(fader)
        main.post(fader)
    }

    private fun stop() {
        main.removeCallbacks(fader)
        level = 0f
        releasePlayer()
        abandonFocus()
    }

    private fun releasePlayer() {
        player?.release()
        player = null
        prepared = false
    }

    // A call, a video, another music app: they come first.
    private val onFocus = AudioManager.OnAudioFocusChangeListener { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_GAIN -> {
                hasFocus = true
                ducked = false
                if (wanted && prepared && player?.isPlaying == false) player?.start()
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> ducked = true
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                hasFocus = false
                player?.takeIf { prepared && it.isPlaying }?.pause()
            }
            AudioManager.AUDIOFOCUS_LOSS -> {
                // Until the page asks again: the next time Orrery is opened.
                hasFocus = false
                wanted = false
                player?.takeIf { prepared && it.isPlaying }?.pause()
                abandonFocus()
            }
        }
        fade()
    }

    private fun requestFocus(): Boolean {
        if (hasFocus) return true
        val am = context?.getSystemService(AudioManager::class.java) ?: return false
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(attributes)
            .setOnAudioFocusChangeListener(onFocus, main)
            .build()
        focus = request
        hasFocus = am.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        return hasFocus
    }

    private fun abandonFocus() {
        val request = focus ?: return
        context?.getSystemService(AudioManager::class.java)?.abandonAudioFocusRequest(request)
        focus = null
        hasFocus = false
    }
}
