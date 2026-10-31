package com.sekullar.pyramid

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

/**
 * Letter-by-letter live typing for one open note (the setting on the Settings screen). Runs a loop on its own thread:
 * send what was typed, get what the PC (or another device) typed, repeat; with nothing to send, the request waits at
 * the PC and is answered the moment something happens there. Typing cancels such a waiting request so the new letters
 * go out at once. The merging rules are in LiveText.kt; the PC's side is desktop/electron/sync/live.js.
 *
 * Everything that touches the editor text or the LiveClient state runs on the main thread (via ui {}), so the text that
 * a reply is merged into is always the text the user sees at that moment.
 */
class LiveSession(
    context: Context,
    private val noteId: String,
    private val readText: () -> String, // main thread
    private val showText: (String) -> Unit, // main thread: replace the editor text, keep the cursor
    private val reloadFromDisk: () -> Unit, // main thread: after the first normal sync
    private val onFallback: (String) -> Unit, // main thread: live typing stopped, carry on the normal way
) {
    private val app = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val client = SyncClient(PairingStore(app))
    private val live = LiveClient(UUID.randomUUID().toString())
    @Volatile private var stopped = false
    @Volatile private var waiting: CallHandle? = null

    fun start() {
        Thread({ run() }, "pyramid-live").apply { isDaemon = true }.start()
    }

    /** The user typed: a request that is only waiting for news must give way. */
    fun poke() {
        waiting?.cancel()
    }

    /** Send what is left, then end. */
    fun stop() {
        stopped = true
        waiting?.cancel()
    }

    private fun <T> ui(block: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()
        val task = FutureTask(block)
        main.post(task)
        return task.get(10, TimeUnit.SECONDS)
    }

    private fun fallback(reason: String) {
        main.post { onFallback(reason) }
    }

    private fun JSONObject.toReply() = LiveReply(
        rev = getInt("rev"),
        entries = getJSONArray("entries").let { a -> (0 until a.length()).map { LiveText.fromJson(a.getJSONArray(it)) } },
        len = getInt("len"),
        cs = getLong("cs"),
    )

    private fun fetch(): JSONObject = client.call("live") { put("id", noteId); put("cid", live.cid); put("rev", -1) }

    private fun run() {
        try {
            // Both sides must start from the same files, so the normal sync goes first. Whatever it changed is shown.
            Sync.runNow(app)
            if (stopped) return
            ui { reloadFromDisk() }
            val first = fetch()
            ui { live.open(first.getString("text"), first.getInt("rev"), first.getString("ep")) }

            var failures = 0
            var pending: LiveClient.Request? = null
            while (true) {
                val req = pending ?: ui { live.prepare(readText()) }.also { pending = it }
                val poll = req.ops.isEmpty()
                if (poll && stopped) return // nothing left to send
                val handle = CallHandle()
                waiting = if (poll) handle else null
                try {
                    val r = client.call("live", handle, if (poll) 35_000 else 10_000) {
                        put("id", noteId)
                        put("cid", live.cid)
                        put("ep", req.ep)
                        put("rev", req.rev)
                        put("seq", req.seq)
                        put("ops", LiveText.toJson(req.ops))
                        put("wait", if (poll) 20_000 else 0)
                    }
                    waiting = null
                    failures = 0
                    pending = null
                    val reply = r.toReply()
                    ui {
                        val local = readText()
                        val next = live.receive(reply, local)
                        if (next != local) showText(next)
                    }
                } catch (e: CallCancelled) {
                    pending = null // only a waiting request is ever cancelled; the next round sends the new letters
                } catch (e: LiveDesync) {
                    fallback("DESYNC")
                    return
                } catch (e: SyncException) {
                    val m = e.message.orEmpty()
                    when {
                        m == "REOPEN" -> {
                            pending = null
                            if (!reopen()) return
                        }
                        m == "UNREACHABLE" || m.startsWith("HTTP") -> {
                            if (++failures >= 5 || stopped) { fallback("NETWORK"); return }
                            Thread.sleep(800)
                        }
                        else -> { fallback(m); return } // LIVE_OFF, REJECTED, NO_NOTE, BAD_OPS ...
                    }
                } finally {
                    waiting = null
                }
            }
        } catch (e: Exception) {
            if (!stopped) fallback(e.javaClass.simpleName)
        }
    }

    /** The PC closed the note (e.g. it ran a normal sync): ask for a fresh copy and carry on. False = gave up. */
    private fun reopen(): Boolean {
        val r = fetch()
        val text = r.getString("text")
        var ok = true
        ui {
            val before = live.base
            val local = readText()
            if (text == before || local == before) {
                live.open(text, r.getInt("rev"), r.getString("ep"))
                if (text != local && local == before) showText(text)
            } else {
                ok = false // changed on the PC and typed here too: stop live, the normal sync keeps both
            }
        }
        if (!ok) fallback("CONFLICT")
        return ok
    }
}
