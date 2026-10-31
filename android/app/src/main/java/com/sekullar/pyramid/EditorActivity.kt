package com.sekullar.pyramid

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.Markwon
import io.noties.markwon.core.MarkwonTheme

/** Write / preview editor with autosave (same 700 ms pause as the desktop). */
class EditorActivity : Activity() {
    private lateinit var store: NoteStore
    private lateinit var t: T
    private lateinit var noteId: String
    private lateinit var area: EditText
    private lateinit var previewBox: ScrollView
    private lateinit var previewText: TextView
    private lateinit var status: TextView
    private lateinit var delete: TextView
    private lateinit var markwon: Markwon
    private val handler = Handler(Looper.getMainLooper())
    private var savedBody = ""
    private var dirty = false
    private var armed = false
    private var loading = false
    private var remote = false
    private var session: LiveSession? = null
    private var liveEnded = false // live typing stopped for this visit (PC has it off, link lost, ...): use the normal sync

    private val saveNow = Runnable { flush() }
    private val disarm = Runnable { armed = false; delete.text = t["delete"]; delete.setTextColor(Ui.MUTED); delete.background = Ui.ripple(this, 10, Ui.round(this, 0, 10, Ui.LINE2)) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = NoteStore(java.io.File(filesDir, "notes"))
        t = Strings.of(Prefs(this).lang)
        noteId = intent.getStringExtra("id") ?: return finish()
        val note = store.load(noteId) ?: return finish()
        markwon = Markwon.builder(this).usePlugin(object : AbstractMarkwonPlugin() {
            override fun configureTheme(builder: MarkwonTheme.Builder) {
                builder.linkColor(Ui.WHITE).codeTextColor(0xFFE6E6E6.toInt()).codeBackgroundColor(0xFF151515.toInt())
                    .blockQuoteColor(0xFF333333.toInt()).thematicBreakColor(Ui.LINE2)
            }
        }).build()
        build(note.body)
    }

    private fun build(initial: String) {
        val ctx = this
        savedBody = initial
        val root = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }

        val bar = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(Ui.dp(ctx, 12), Ui.dp(ctx, 10), Ui.dp(ctx, 12), Ui.dp(ctx, 10))
        }
        bar.addView(Ui.ghostButton(ctx, "‹") { finish() }, LinearLayout.LayoutParams(Ui.dp(ctx, 44), ViewGroup.LayoutParams.WRAP_CONTENT))
        bar.addView(Ui.seg(ctx, listOf(t["write"], t["preview"]), 0) { setPreview(it == 1) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { leftMargin = Ui.dp(ctx, 10) })
        status = Ui.text(ctx, t["saved"], 12f, Ui.FAINT).apply { gravity = Gravity.END; setPadding(0, 0, Ui.dp(ctx, 10), 0) }
        bar.addView(status, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        delete = Ui.ghostButton(ctx, t["delete"]) { onDelete() }
        bar.addView(delete)
        root.addView(bar)
        root.addView(View(ctx).apply { setBackgroundColor(Ui.LINE) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1))

        area = EditText(ctx).apply {
            setText(initial)
            setTextColor(Ui.TEXT)
            setHintTextColor(Ui.FAINT)
            hint = "# ..."
            typeface = android.graphics.Typeface.MONOSPACE
            textSize = 14.5f
            setLineSpacing(0f, 1.3f)
            gravity = Gravity.TOP or Gravity.START
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            background = null
            setPadding(Ui.dp(ctx, 18), Ui.dp(ctx, 16), Ui.dp(ctx, 18), Ui.dp(ctx, 16))
            addTextChangedListener(object : TextWatcher {
                override fun afterTextChanged(s: Editable?) {
                    if (loading) return
                    dirty = true
                    status.text = t["saving"]
                    handler.removeCallbacks(saveNow)
                    handler.postDelayed(saveNow, SAVE_DELAY)
                    if (!remote) session?.poke()
                }
                override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, a: Int) {}
                override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {}
            })
        }
        previewText = Ui.text(ctx, "", 15f, 0xFFE6E6E6.toInt()).apply {
            setLineSpacing(0f, 1.35f)
            setPadding(Ui.dp(ctx, 20), Ui.dp(ctx, 16), Ui.dp(ctx, 20), Ui.dp(ctx, 24))
            setTextIsSelectable(true)
        }
        previewBox = ScrollView(ctx).apply { visibility = View.GONE; addView(previewText) }
        val frame = FrameLayout(ctx)
        frame.addView(area, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        frame.addView(previewBox, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(frame, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        setContentView(root)
        Ui.screen(this, root)

        // A brand new note ("# " and nothing else): put the cursor in the title and open the keyboard, like the desktop.
        if (initial.trim() == "#") {
            area.requestFocus()
            area.setSelection(minOf(2, area.text.length))
            area.post { (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).showSoftInput(area, 0) }
        }
    }

    private fun setPreview(on: Boolean) {
        if (on) {
            flush()
            markwon.setMarkdown(previewText, area.text.toString())
            (area.parent as View).findFocus()?.clearFocus()
        }
        area.visibility = if (on) View.GONE else View.VISIBLE
        previewBox.visibility = if (on) View.VISIBLE else View.GONE
    }

    private fun flush() {
        handler.removeCallbacks(saveNow)
        if (!dirty) return
        val text = area.text.toString()
        dirty = false
        savedBody = text
        store.save(noteId, text)
        status.text = savedLabel()
        if (session == null) Sync.run(this) // near-live: send it now instead of waiting for the next round
    }

    private fun onDelete() {
        if (!armed) {
            armed = true
            delete.text = t["confirmDelete"]
            delete.setTextColor(Ui.BLACK)
            delete.background = Ui.ripple(this, 10, Ui.round(this, Ui.DANGER, 10))
            handler.postDelayed(disarm, 3000)
            return
        }
        handler.removeCallbacks(disarm)
        session?.stop()
        session = null
        handler.removeCallbacks(saveNow)
        dirty = false
        store.trash(noteId)
        finish()
    }

    // If the note changed on disk while we were away (sync will do that) and nothing is unsaved, show the new text.
    // Returns false when the note is gone.
    private fun showDiskChange(): Boolean {
        if (!::area.isInitialized || dirty) return true
        val n = store.load(noteId) ?: return false
        if (n.body != savedBody) {
            val old = area.text.toString()
            val cursor = TextMap.cursor(old, n.body, area.selectionStart.coerceAtLeast(0))
            loading = true
            savedBody = n.body
            area.setText(n.body)
            area.setSelection(cursor.coerceIn(0, area.text.length))
            loading = false
            if (previewBox.visibility == View.VISIBLE) markwon.setMarkdown(previewText, n.body)
        }
        return true
    }

    private fun savedLabel() = if (session != null) t["liveStatus"] else t["saved"]

    // Near-live typing (the default): while this note is open, sync every second and a half and right after each save,
    // and show what the PC typed as soon as it lands. (Outside the editor the list syncs every 20 s.)
    private val live = object : Runnable {
        override fun run() {
            if (!showDiskChange()) return finish()
            Sync.run(this@EditorActivity)
            handler.postDelayed(this, LIVE_EVERY)
        }
    }

    private fun startNearLive() {
        if (!showDiskChange()) return finish()
        Sync.run(this)
        handler.removeCallbacks(live)
        handler.postDelayed(live, LIVE_EVERY)
        // Between two sync rounds, pick up what a finished round wrote.
        Sync.listener = { if (!showDiskChange()) finish() }
    }

    // Letter-by-letter live typing (a setting, also needs the switch on the PC).
    private fun startLetterLive() {
        status.text = savedLabel()
        session = LiveSession(
            this, noteId,
            readText = { area.text.toString() },
            showText = { showRemote(it) },
            reloadFromDisk = { showDiskChange() },
            onFallback = { reason ->
                session = null
                liveEnded = true
                status.text = savedLabel()
                if (reason == "LIVE_OFF") android.widget.Toast.makeText(this, t["liveOffPc"], android.widget.Toast.LENGTH_LONG).show()
                if (resumed) startNearLive()
            },
        ).also { session = it; it.start(); status.text = savedLabel() }
    }

    // The PC's letters arrive: change only what changed, so the cursor, the keyboard's word suggestions and the scroll stay put.
    private fun showRemote(text: String) {
        val old = area.text.toString()
        if (old == text) return
        val cursor = TextMap.cursor(old, text, area.selectionStart.coerceAtLeast(0)).let { c -> minOf(c, text.length) }
        remote = true
        val e = area.text
        for (op in LiveText.diff(old, text)) when (op) {
            is Op.Del -> e.delete(op.pos, op.pos + op.n)
            is Op.Ins -> e.insert(op.pos, op.s)
        }
        area.setSelection(cursor.coerceIn(0, area.text.length))
        remote = false
        if (previewBox.visibility == View.VISIBLE) markwon.setMarkdown(previewText, text)
    }

    private var resumed = false

    override fun onResume() {
        super.onResume()
        resumed = true
        if (!::area.isInitialized) return
        if (Prefs(this).liveTyping && PairingStore(this).paired && !liveEnded) startLetterLive() else startNearLive()
    }

    override fun onPause() {
        resumed = false
        handler.removeCallbacks(live)
        Sync.listener = null
        flush()
        session?.stop() // sends what is left, then ends
        session = null
        super.onPause()
    }

    companion object {
        private const val SAVE_DELAY = 700L
        private const val LIVE_EVERY = 1500L
    }
}
