package com.sekullar.pyramid

import android.app.Activity
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

/** The desktop theme: pure black, near-black surfaces, thin lines, white accent. Same values as desktop/src/styles.css. */
object Ui {
    val BG = 0xFF000000.toInt()
    val PANEL = 0xFF0A0A0A.toInt()
    val RAISE = 0xFF111111.toInt()
    val LINE = 0xFF1C1C1C.toInt()
    val LINE2 = 0xFF2A2A2A.toInt()
    val TEXT = 0xFFF2F2F2.toInt()
    val MUTED = 0xFF8C8C8C.toInt()
    val FAINT = 0xFF5A5A5A.toInt()
    val DANGER = 0xFFFF6B6B.toInt()
    val WHITE = 0xFFFFFFFF.toInt()
    val BLACK = 0xFF000000.toInt()

    fun dp(ctx: Context, v: Int): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), ctx.resources.displayMetrics).toInt()

    fun round(ctx: Context, fill: Int, radiusDp: Int, stroke: Int = 0): GradientDrawable = GradientDrawable().apply {
        setColor(fill)
        cornerRadius = dp(ctx, radiusDp).toFloat()
        if (stroke != 0) setStroke(dp(ctx, 1), stroke)
    }

    fun ripple(ctx: Context, radiusDp: Int, base: Drawable? = null): RippleDrawable =
        RippleDrawable(ColorStateList.valueOf(0x22FFFFFF), base, round(ctx, WHITE, radiusDp))

    fun text(ctx: Context, s: String, sp: Float, color: Int = TEXT, bold: Boolean = false, mono: Boolean = false): TextView = TextView(ctx).apply {
        text = s
        textSize = sp
        setTextColor(color)
        typeface = if (mono) Typeface.MONOSPACE else if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        if (mono && bold) setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
    }

    /** Black window, app draws behind the system bars and pads for them (and for the keyboard). */
    fun screen(a: Activity, root: View) {
        a.window.setBackgroundDrawable(ColorDrawable(BG))
        WindowCompat.setDecorFitsSystemWindows(a.window, false)
        WindowCompat.getInsetsController(a.window, root).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, w ->
            val i = w.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            v.setPadding(i.left, i.top, i.right, i.bottom)
            WindowInsetsCompat.CONSUMED
        }
    }

    fun primaryButton(ctx: Context, label: String, onClick: () -> Unit): TextView = text(ctx, label, 15f, BLACK, bold = true).apply {
        gravity = Gravity.CENTER
        setPadding(dp(ctx, 16), dp(ctx, 13), dp(ctx, 16), dp(ctx, 13))
        background = ripple(ctx, 12, round(ctx, WHITE, 12))
        setOnClickListener { onClick() }
    }

    fun ghostButton(ctx: Context, label: String, color: Int = MUTED, onClick: () -> Unit): TextView = text(ctx, label, 13.5f, color).apply {
        gravity = Gravity.CENTER
        setPadding(dp(ctx, 12), dp(ctx, 8), dp(ctx, 12), dp(ctx, 8))
        background = ripple(ctx, 10, round(ctx, 0, 10, LINE2))
        setOnClickListener { onClick() }
    }

    /** Segmented control like the desktop's: the chosen option is a white pill. */
    fun seg(ctx: Context, labels: List<String>, selected: Int, onSelect: (Int) -> Unit): LinearLayout {
        val box = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            background = round(ctx, RAISE, 11, LINE)
            setPadding(dp(ctx, 3), dp(ctx, 3), dp(ctx, 3), dp(ctx, 3))
        }
        val views = labels.mapIndexed { i, label ->
            text(ctx, label, 13.5f, MUTED).apply {
                gravity = Gravity.CENTER
                setPadding(dp(ctx, 14), dp(ctx, 7), dp(ctx, 14), dp(ctx, 7))
            }.also { box.addView(it, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)) }
        }
        fun paint(sel: Int) = views.forEachIndexed { i, v ->
            v.setTextColor(if (i == sel) BLACK else MUTED)
            v.setTypeface(null, if (i == sel) Typeface.BOLD else Typeface.NORMAL)
            v.background = if (i == sel) round(ctx, WHITE, 8) else null
        }
        paint(selected)
        views.forEachIndexed { i, v -> v.setOnClickListener { paint(i); onSelect(i) } }
        return box
    }
}
