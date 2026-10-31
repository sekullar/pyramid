package com.sekullar.pyramid

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView

class SettingsActivity : Activity() {
    private lateinit var t: T
    private lateinit var syncCard: LinearLayout
    private val handler = Handler(Looper.getMainLooper())
    private var armed = false
    private val tick = object : Runnable {
        override fun run() { renderSync(); handler.postDelayed(this, 30_000) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = Prefs(this)
        t = Strings.of(prefs.lang)
        val ctx = this
        val root = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }

        val bar = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(Ui.dp(ctx, 12), Ui.dp(ctx, 12), Ui.dp(ctx, 12), Ui.dp(ctx, 8))
        }
        bar.addView(Ui.ghostButton(ctx, "‹") { finish() }, LinearLayout.LayoutParams(Ui.dp(ctx, 44), ViewGroup.LayoutParams.WRAP_CONTENT))
        bar.addView(Ui.text(ctx, t["settings"], 18f, bold = true).apply { setPadding(Ui.dp(ctx, 12), 0, 0, 0) })
        root.addView(bar)

        fun card(): LinearLayout = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            background = Ui.round(ctx, Ui.BG, 14, Ui.LINE)
            setPadding(Ui.dp(ctx, 16), Ui.dp(ctx, 14), Ui.dp(ctx, 16), Ui.dp(ctx, 14))
        }
        fun add(v: android.view.View) = root.addView(v, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            setMargins(Ui.dp(ctx, 16), Ui.dp(ctx, 6), Ui.dp(ctx, 16), Ui.dp(ctx, 6))
        })

        add(card().apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(Ui.text(ctx, t["language"], 15f, bold = true), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(Ui.seg(ctx, listOf("Türkçe", "English"), if (prefs.lang == "tr") 0 else 1) { prefs.lang = if (it == 0) "tr" else "en"; recreate() })
        })

        syncCard = card()
        add(syncCard)

        add(card().apply {
            addView(Ui.text(ctx, t["liveTitle"], 15f, bold = true))
            addView(Ui.text(ctx, t["liveHint"], 12.5f, Ui.MUTED).apply { setPadding(0, Ui.dp(ctx, 6), 0, Ui.dp(ctx, 12)) })
            addView(Ui.seg(ctx, listOf(t["liveOff"], t["liveOn"]), if (prefs.liveTyping) 1 else 0) { prefs.liveTyping = it == 1 })
        })

        val version = runCatching { packageManager.getPackageInfo(packageName, 0).versionName }.getOrNull().orEmpty()
        root.addView(Ui.text(ctx, "${t["version"]} $version", 12f, Ui.FAINT).apply { setPadding(Ui.dp(ctx, 22), Ui.dp(ctx, 14), 0, 0) })

        setContentView(root)
        Ui.screen(this, root)
    }

    override fun onResume() {
        super.onResume()
        Sync.listener = { renderSync() }
        handler.post(tick)
    }

    override fun onPause() {
        Sync.listener = null
        handler.removeCallbacks(tick)
        super.onPause()
    }

    private fun renderSync() {
        val ctx = this
        val store = PairingStore(ctx)
        syncCard.removeAllViews()
        syncCard.addView(Ui.text(ctx, t["syncTitle"], 15f, bold = true))

        if (!store.paired) {
            syncCard.addView(Ui.text(ctx, t["syncHintOff"], 12.5f, Ui.MUTED).apply { setPadding(0, Ui.dp(ctx, 6), 0, Ui.dp(ctx, 14)) })
            syncCard.addView(Ui.primaryButton(ctx, t["scanQr"]) { PairFlow.scan(this) { renderSync() } })
            return
        }

        syncCard.addView(Ui.text(ctx, "${t["pairedPc"]}: ${store.pcName}", 12.5f, Ui.MUTED).apply { setPadding(0, Ui.dp(ctx, 4), 0, Ui.dp(ctx, 8)) })
        val line = SyncUi.line(t, store)
        syncCard.addView(statusView(line))
        val summary = SyncUi.summary(t, store)
        if (summary.isNotEmpty() && store.lastError == null) {
            syncCard.addView(Ui.text(ctx, summary, 12f, Ui.FAINT).apply { setPadding(0, Ui.dp(ctx, 4), 0, 0) })
        }

        val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, Ui.dp(ctx, 14), 0, 0) }
        row.addView(Ui.primaryButton(ctx, t["syncNow"]) { Sync.run(ctx) }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val unpair = Ui.ghostButton(ctx, if (armed) t["confirmDelete"] else t["unpair"], if (armed) Ui.DANGER else Ui.MUTED) {
            if (!armed) {
                armed = true
                renderSync()
                handler.postDelayed({ armed = false; renderSync() }, 3000)
            } else {
                armed = false
                PairingStore(ctx).clear()
                BaseState(ctx).clear()
                renderSync()
            }
        }
        row.addView(unpair, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT).apply { leftMargin = Ui.dp(ctx, 10) })
        syncCard.addView(row)
    }

    private fun statusView(line: SyncUi.Line): TextView {
        val color = when (line.tone) { 0 -> 0xFF7EE2A0.toInt(); 2 -> 0xFFFFD37A.toInt(); else -> Ui.MUTED }
        return Ui.text(this, "●  ${line.text}", 13.5f, color)
    }
}
