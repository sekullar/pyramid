package com.sekullar.pyramid

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.TextUtils
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView

/** Note list with search. */
class MainActivity : Activity() {
    private lateinit var store: NoteStore
    private lateinit var t: T
    private lateinit var list: ListView
    private lateinit var empty: TextView
    private lateinit var count: TextView
    private var all: List<NoteStore.Item> = emptyList()
    private var query = ""
    private var shown: List<NoteStore.Item> = emptyList()
    private var lang = ""
    private lateinit var badge: TextView
    private val handler = Handler(Looper.getMainLooper())

    // While the list is on screen, sync every 20 s so notes written on the computer show up without doing anything.
    private val tick = object : Runnable {
        override fun run() {
            Sync.run(this@MainActivity)
            handler.postDelayed(this, 20_000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = NoteStore(java.io.File(filesDir, "notes"))
        build()
        handlePairLink(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handlePairLink(intent)
    }

    // A pyramid://pair?d=... link (for example opened from the camera or a message) goes through the same confirmation as the QR scan.
    private fun handlePairLink(i: Intent?) {
        val uri = i?.data ?: return
        if (uri.scheme == "pyramid" && uri.host == "pair") PairFlow.ask(this, uri.toString()) { refreshBadge() }
        i.data = null
    }

    override fun onResume() {
        super.onResume()
        // The language may have been changed in settings.
        if (lang != Prefs(this).lang) build()
        reload()
        refreshBadge()
        Sync.listener = { refreshBadge(); reload() }
        handler.post(tick)
    }

    override fun onPause() {
        Sync.listener = null
        handler.removeCallbacks(tick)
        super.onPause()
    }

    private fun refreshBadge() {
        val store = PairingStore(this)
        if (!store.paired) { badge.visibility = View.GONE; return }
        val line = SyncUi.line(t, store)
        badge.text = "●  ${line.text}"
        badge.setTextColor(when (line.tone) { 0 -> 0xFF7EE2A0.toInt(); 2 -> 0xFFFFD37A.toInt(); else -> Ui.MUTED })
        badge.visibility = View.VISIBLE
    }

    private fun build() {
        lang = Prefs(this).lang
        t = Strings.of(lang)
        val ctx = this
        val root = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }

        val header = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(Ui.dp(ctx, 20), Ui.dp(ctx, 14), Ui.dp(ctx, 12), Ui.dp(ctx, 6))
        }
        header.addView(ImageView(ctx).apply { setImageResource(R.drawable.ic_logo) }, LinearLayout.LayoutParams(Ui.dp(ctx, 28), Ui.dp(ctx, 28)))
        header.addView(Ui.text(ctx, t["appName"], 18f, bold = true).apply { setPadding(Ui.dp(ctx, 10), 0, 0, 0) }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        header.addView(Ui.ghostButton(ctx, t["settings"]) { startActivity(Intent(ctx, SettingsActivity::class.java)) })
        root.addView(header)

        val search = EditText(ctx).apply {
            hint = t["search"]
            setHintTextColor(Ui.FAINT)
            setTextColor(Ui.TEXT)
            textSize = 15f
            isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT
            background = Ui.round(ctx, Ui.BG, 12, Ui.LINE)
            setPadding(Ui.dp(ctx, 14), Ui.dp(ctx, 11), Ui.dp(ctx, 14), Ui.dp(ctx, 11))
            setText(query) // before the listener: the list does not exist yet
            addTextChangedListener(object : TextWatcher {
                override fun afterTextChanged(s: Editable?) { query = s?.toString().orEmpty(); applyFilter() }
                override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, a: Int) {}
                override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {}
            })
        }
        root.addView(search, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            setMargins(Ui.dp(ctx, 16), Ui.dp(ctx, 6), Ui.dp(ctx, 16), Ui.dp(ctx, 6))
        })

        list = ListView(ctx).apply {
            divider = null
            dividerHeight = 0
            selector = android.graphics.drawable.ColorDrawable(0)
            clipToPadding = false
            setPadding(Ui.dp(ctx, 8), 0, Ui.dp(ctx, 8), Ui.dp(ctx, 8))
            adapter = Adapter()
            setOnItemClickListener { _, _, pos, _ -> open(shown[pos].id) }
        }
        empty = Ui.text(ctx, "", 13.5f, Ui.FAINT).apply { gravity = Gravity.CENTER; setPadding(0, Ui.dp(ctx, 36), 0, 0) }
        val body = android.widget.FrameLayout(ctx)
        body.addView(list, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        body.addView(empty, android.widget.FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))
        root.addView(body, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        badge = Ui.text(ctx, "", 12.5f, Ui.MUTED).apply {
            setPadding(Ui.dp(ctx, 20), Ui.dp(ctx, 8), Ui.dp(ctx, 20), Ui.dp(ctx, 0))
            visibility = View.GONE
            setOnClickListener { Sync.run(ctx) }
        }
        root.addView(badge)

        val foot = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(Ui.dp(ctx, 16), Ui.dp(ctx, 8), Ui.dp(ctx, 16), Ui.dp(ctx, 12))
        }
        count = Ui.text(ctx, "", 12f, Ui.FAINT)
        foot.addView(count, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        foot.addView(Ui.primaryButton(ctx, "+ ${t["newNote"]}") { open(store.create()) })
        root.addView(foot)

        setContentView(root)
        Ui.screen(this, root)
    }

    private fun reload() {
        all = store.all()
        applyFilter()
    }

    private fun applyFilter() {
        val q = query.trim().lowercase()
        shown = if (q.isEmpty()) all else all.filter { "${it.title} ${it.preview} ${it.tags.joinToString(" ")}".lowercase().contains(q) }
        (list.adapter as BaseAdapter).notifyDataSetChanged()
        empty.text = if (shown.isEmpty()) (if (all.isEmpty()) t["noNotes"] else t["noMatch"]) else ""
        count.text = "${all.size} ${t["notes"]}"
    }

    private fun open(id: String) = startActivity(Intent(this, EditorActivity::class.java).putExtra("id", id))

    private inner class Adapter : BaseAdapter() {
        override fun getCount() = shown.size
        override fun getItem(position: Int) = shown[position]
        override fun getItemId(position: Int) = position.toLong()
        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val ctx = this@MainActivity
            val row = (convertView as? LinearLayout) ?: LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(Ui.dp(ctx, 12), Ui.dp(ctx, 11), Ui.dp(ctx, 12), Ui.dp(ctx, 11))
                background = Ui.ripple(ctx, 12)
                addView(Ui.text(ctx, "", 15f, bold = true).apply { maxLines = 1; ellipsize = TextUtils.TruncateAt.END })
                addView(Ui.text(ctx, "", 12.5f, Ui.MUTED).apply { maxLines = 1; ellipsize = TextUtils.TruncateAt.END; setPadding(0, Ui.dp(ctx, 3), 0, 0) })
            }
            val n = shown[position]
            (row.getChildAt(0) as TextView).text = n.title.ifEmpty { t["untitled"] }
            (row.getChildAt(1) as TextView).text = n.preview
            return row
        }
    }
}
