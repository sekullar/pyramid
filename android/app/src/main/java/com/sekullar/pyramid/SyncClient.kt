package com.sekullar.pyramid

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class SyncException(message: String) : Exception(message)

/** Thrown when a call was cancelled on purpose (a waiting live request, because the user typed). */
class CallCancelled : Exception()

/** Lets another thread cancel a call that is waiting for the desktop. */
class CallHandle {
    @Volatile private var conn: HttpURLConnection? = null
    @Volatile var cancelled = false
        private set
    internal fun attach(c: HttpURLConnection) { conn = c; if (cancelled) c.disconnect() }
    fun cancel() { cancelled = true; conn?.disconnect() }
}

/**
 * Talks to the desktop: POST http://<host>:<port>/pyramid/v1?d=<deviceId>, body = sealed message (see server.js).
 * Tries the addresses from the QR code in order, the one that worked last time first.
 */
class SyncClient(private val store: PairingStore) {
    fun call(type: String, build: JSONObject.() -> Unit = {}): JSONObject = call(type, null, 30_000, build)

    fun call(type: String, handle: CallHandle?, readTimeoutMs: Int, build: JSONObject.() -> Unit = {}): JSONObject {
        val key = store.key ?: throw SyncException("not paired")
        val msg = JSONObject().put("t", System.currentTimeMillis()).put("type", type).apply(build)
        val body = Crypto.seal(key, msg.toString())
        var failure: String? = null
        for (host in store.hosts) {
            try {
                val c = URL("http://$host:${store.port}/pyramid/v1?d=${store.deviceId}").openConnection() as HttpURLConnection
                c.connectTimeout = 2000
                c.readTimeout = readTimeoutMs
                handle?.attach(c)
                c.requestMethod = "POST"
                c.doOutput = true
                try {
                    c.outputStream.use { it.write(body.toByteArray()) }
                    if (c.responseCode != 200) {
                        // 404 is the desktop's only answer to anything it does not accept: unpaired, wrong key or a clock that is off by over a minute.
                        throw SyncException(if (c.responseCode == 404) "REJECTED" else "HTTP ${c.responseCode}")
                    }
                    val text = c.inputStream.bufferedReader().use { it.readText() }
                    val plain = Crypto.open(key, text) ?: throw SyncException("BAD_REPLY")
                    store.remember(host)
                    val reply = JSONObject(plain)
                    if (!reply.optBoolean("ok", false)) throw SyncException(reply.optString("error", "error"))
                    return reply
                } finally {
                    c.disconnect()
                }
            } catch (e: SyncException) {
                throw e // the desktop answered; trying another address of the same computer will not help
            } catch (e: Exception) {
                if (handle?.cancelled == true) throw CallCancelled()
                failure = "UNREACHABLE"
            }
        }
        throw SyncException(failure ?: "UNREACHABLE")
    }
}

/**
 * The phone's half of a sync. Same steps as the FakePhone in desktop/electron/sync/server.test.js, which the desktop
 * tests run against the real server. The phone always starts; `commit` is sent only after everything here is written,
 * so a crash in between only means the next sync repeats the work.
 */
object SyncRunner {
    class Outcome(val pulled: Int, val pushed: Int, val deleted: Int, val conflicts: Int)

    fun run(notes: NoteStore, client: SyncClient, base: BaseState): Outcome {
        val snapshot = notes.snapshot(base.load())
        val reply = client.call("sync") { put("snapshot", snapshot) }
        val session = reply.getString("session")
        val actions = reply.getJSONArray("actions")
        var pulled = 0
        var pushed = 0
        var deleted = 0
        var conflicts = 0
        for (i in 0 until actions.length()) {
            val a = actions.getJSONObject(i)
            val type = a.getString("type")
            val id = a.getString("id")
            when {
                type == "delete" -> if (a.getString("on") == "b") { notes.trash(id); deleted++ }
                type == "conflict" -> {
                    // Push this phone's text first (the desktop keeps it as a marked copy), then take the desktop's text.
                    val copy = client.call("put") { put("session", session); put("id", id); put("text", notes.readRaw(id)) }.getString("copy")
                    notes.writeRaw(id, client.call("get") { put("id", id) }.getString("text"))
                    notes.writeRaw(a.getString("copyId"), copy)
                    conflicts++
                }
                a.getString("from") == "b" -> {
                    client.call("put") { put("session", session); put("id", id); put("text", notes.readRaw(id)) }
                    pushed++
                }
                else -> {
                    val text = client.call("get") { put("id", id) }.getString("text")
                    // Live typing: if the note was edited on the phone while this sync was running, keep that newer text.
                    // The next sync sees it as a phone-side change and sends it on, so nothing is lost.
                    val now = notes.scan()[id]?.hash
                    val sent = snapshot.optJSONObject(id)?.optString("hash")
                    if (now == null || now == sent) {
                        notes.writeRaw(id, text)
                        pulled++
                    }
                }
            }
        }
        base.save(client.call("commit") { put("session", session) }.getJSONObject("nextBase"))
        return Outcome(pulled, pushed, deleted, conflicts)
    }
}
