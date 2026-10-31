package com.sekullar.pyramid

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Runs syncs one at a time on a background thread and keeps the result for the screens. */
object Sync {
    private val exec = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val busy = AtomicBoolean(false)
    private val lock = Any()

    @Volatile var running = false
        private set

    /** Called on the main thread whenever the state shown to the user may have changed. */
    @Volatile var listener: (() -> Unit)? = null

    private fun changed() = main.post { listener?.invoke() }

    /** One sync on the calling thread (not the main thread), waiting for one that is already running. Used before a live session starts. */
    fun runNow(ctx: Context) {
        val app = ctx.applicationContext
        val pairing = PairingStore(app)
        if (!pairing.paired) return
        synchronized(lock) {
            try {
                SyncRunner.run(NoteStore(File(app.filesDir, "notes")), SyncClient(pairing), BaseState(app))
                pairing.lastSyncMs = System.currentTimeMillis()
                pairing.lastError = null
            } catch (e: Exception) {
                pairing.lastError = (e as? SyncException)?.message ?: e.javaClass.simpleName
            }
        }
    }

    fun run(ctx: Context) {
        val app = ctx.applicationContext
        val pairing = PairingStore(app)
        if (!pairing.paired || !busy.compareAndSet(false, true)) return
        running = true
        changed()
        exec.execute {
            try {
              synchronized(lock) {
                val out = SyncRunner.run(NoteStore(File(app.filesDir, "notes")), SyncClient(pairing), BaseState(app))
                pairing.lastSyncMs = System.currentTimeMillis()
                pairing.lastError = null
                pairing.lastSummary = "${out.pulled}|${out.pushed}|${out.deleted}|${out.conflicts}"
              }
            } catch (e: Exception) {
                // Nothing is lost on failure: the agreed state is only saved after a complete sync.
                pairing.lastError = (e as? SyncException)?.message ?: e.javaClass.simpleName
            } finally {
                running = false
                busy.set(false)
                changed()
            }
        }
    }
}

/** QR scan or pyramid://pair link -> confirm with the user -> pair -> first sync. */
object PairFlow {
    fun scan(a: Activity, onDone: () -> Unit) {
        val t = Strings.of(Prefs(a).lang)
        val opts = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning.getClient(a, opts).startScan()
            .addOnSuccessListener { ask(a, it.rawValue.orEmpty(), onDone) }
            .addOnFailureListener { e ->
                // Closing the scanner with the back button is not an error worth showing.
                if (e.message?.contains("cancel", ignoreCase = true) != true) Toast.makeText(a, t["scanFail"], Toast.LENGTH_LONG).show()
            }
    }

    fun ask(a: Activity, uri: String, onDone: () -> Unit) {
        val t = Strings.of(Prefs(a).lang)
        val p = PairPayload.parse(uri) ?: return Toast.makeText(a, t["badQr"], Toast.LENGTH_LONG).show()
        AlertDialog.Builder(a, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle(t["pairAskTitle"])
            .setMessage(t["pairAskText"].replace("{pc}", p.pcName))
            .setPositiveButton(t["pairYes"]) { _, _ -> pair(a, p, onDone) }
            .setNegativeButton(t["cancel"], null)
            .show()
    }

    private fun pair(a: Activity, p: PairPayload, onDone: () -> Unit) {
        val t = Strings.of(Prefs(a).lang)
        val store = PairingStore(a)
        val base = BaseState(a)
        Thread {
            // Kept so a failed re-pairing does not cost the user the pairing they already had.
            val old = store.key?.let { PairPayload(store.pcName, store.hosts, store.port, it, store.deviceId) }
            val oldBase = base.load()
            // A new pairing starts from nothing: an old agreed state would make the engine see deletions that never happened.
            store.save(p)
            base.clear()
            try {
                SyncClient(store).call("hello") { put("name", Build.MODEL) }
                a.runOnUiThread { Toast.makeText(a, t["pairedWith"].replace("{pc}", p.pcName), Toast.LENGTH_SHORT).show(); onDone() }
                Sync.run(a)
            } catch (e: Exception) {
                if (old != null) { store.save(old); base.save(oldBase) } else store.clear()
                val msg = if ((e as? SyncException)?.message == "REJECTED") t["errRejected"] else t["errUnreachable"]
                a.runOnUiThread { Toast.makeText(a, msg, Toast.LENGTH_LONG).show(); onDone() }
            }
        }.start()
    }
}

/** The one-line sync status shown in the note list and in settings. tone: 0 fine, 1 working, 2 problem. */
object SyncUi {
    class Line(val text: String, val tone: Int)

    fun line(t: T, s: PairingStore): Line {
        val err = s.lastError
        return when {
            Sync.running -> Line(t["syncRunning"], 1)
            err != null -> Line("${t["syncFailed"]}: ${t["err$err"].takeIf { it != "err$err" } ?: t["errOther"]}", 2)
            s.lastSyncMs == 0L -> Line(t["syncNever"], 1)
            else -> Line("${t["syncDone"]} · ${ago(t, s.lastSyncMs)}", 0)
        }
    }

    /** "2 received, 1 sent, 0 deleted" plus a conflict note when there were conflicts. */
    fun summary(t: T, s: PairingStore): String {
        val p = s.lastSummary.split("|").mapNotNull { it.toIntOrNull() }
        if (p.size != 4) return ""
        val base = t["summary"].replace("{pulled}", p[0].toString()).replace("{pushed}", p[1].toString()).replace("{deleted}", p[2].toString())
        return if (p[3] > 0) base + "\n" + t["conflictsNote"].replace("{n}", p[3].toString()) else base
    }
}
