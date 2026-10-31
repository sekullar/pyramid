package com.sekullar.pyramid

import org.json.JSONArray

/**
 * Letter-by-letter live typing, phone side. The rules are the ones in desktop/electron/sync/ot.mjs (same names, same
 * steps) and LiveTextTest pins them with vectors produced by that file. Positions are UTF-16 units on both sides.
 */
sealed class Op {
    data class Ins(val pos: Int, val s: String) : Op()
    data class Del(val pos: Int, val n: Int) : Op()
}

class LiveDesync : Exception("copies differ")

object LiveText {
    private fun xp(a: Op, b: Op): Pair<List<Op>, List<Op>> {
        if (a is Op.Ins && b is Op.Ins) {
            return if (a.pos <= b.pos) listOf(a) to listOf(Op.Ins(b.pos + a.s.length, b.s))
            else listOf<Op>(Op.Ins(a.pos + b.s.length, a.s)) to listOf(b)
        }
        if (a is Op.Ins && b is Op.Del) {
            val p = a.pos
            val q = b.pos
            val n = b.n
            return when {
                p <= q -> listOf<Op>(a) to listOf(Op.Del(q + a.s.length, n))
                p >= q + n -> listOf<Op>(Op.Ins(p - n, a.s)) to listOf(b)
                else -> {
                    val k = p - q // the insert lands inside the deleted part: the delete splits around it
                    listOf<Op>(Op.Ins(q, a.s)) to listOf(Op.Del(q, k), Op.Del(q + a.s.length, n - k))
                }
            }
        }
        if (a is Op.Del && b is Op.Ins) {
            val (bl, al) = xp(b, a)
            return al to bl
        }
        a as Op.Del
        b as Op.Del
        val overlap = maxOf(0, minOf(a.pos + a.n, b.pos + b.n) - maxOf(a.pos, b.pos))
        fun moved(from: Int, otherFrom: Int, otherLen: Int) = if (from >= otherFrom + otherLen) from - otherLen else if (from >= otherFrom) otherFrom else from
        val aLen = a.n - overlap
        val bLen = b.n - overlap
        return (if (aLen > 0) listOf<Op>(Op.Del(moved(a.pos, b.pos, b.n), aLen)) else emptyList()) to
            (if (bLen > 0) listOf<Op>(Op.Del(moved(b.pos, a.pos, a.n), bLen)) else emptyList())
    }

    /** a goes first on a tie (the desktop side). Returns (a', b'): a' applies after b, b' after a. */
    fun xform(a: List<Op>, b: List<Op>): Pair<List<Op>, List<Op>> {
        if (a.isEmpty() || b.isEmpty()) return a to b
        if (a.size == 1 && b.size == 1) return xp(a[0], b[0])
        if (a.size > 1) {
            val (a1, b1) = xform(listOf(a[0]), b)
            val (rest, b2) = xform(a.drop(1), b1)
            return (a1 + rest) to b2
        }
        val (a1, b1) = xform(a, listOf(b[0]))
        val (a2, rest) = xform(a1, b.drop(1))
        return a2 to (b1 + rest)
    }

    fun apply(text: String, ops: List<Op>): String {
        var out = text
        for (op in ops) out = when (op) {
            is Op.Ins -> out.substring(0, op.pos) + op.s + out.substring(op.pos)
            is Op.Del -> out.substring(0, op.pos) + out.substring(op.pos + op.n)
        }
        return out
    }

    /** The one change that turns a into b. Never cuts an emoji in half. */
    fun diff(a: String, b: String): List<Op> {
        if (a == b) return emptyList()
        val limit = minOf(a.length, b.length)
        var prefix = 0
        while (prefix < limit && a[prefix] == b[prefix]) prefix++
        if (prefix > 0 && a[prefix - 1].isHighSurrogate()) prefix--
        var suffix = 0
        while (suffix < limit - prefix && a[a.length - 1 - suffix] == b[b.length - 1 - suffix]) suffix++
        while (suffix > 0 && a[a.length - suffix].isLowSurrogate()) suffix--
        val removed = a.length - prefix - suffix
        val added = b.substring(prefix, b.length - suffix)
        val ops = ArrayList<Op>()
        if (removed > 0) ops.add(Op.Del(prefix, removed))
        if (added.isNotEmpty()) ops.add(Op.Ins(prefix, added))
        return ops
    }

    /** FNV-1a over UTF-16 units, as an unsigned 32-bit number. */
    fun checksum(text: String): Long {
        var h = 0x811c9dc5L
        for (c in text) {
            h = h xor c.code.toLong()
            h = (h * 0x01000193L) and 0xFFFFFFFFL
        }
        return h
    }

    fun toJson(ops: List<Op>): JSONArray {
        val arr = JSONArray()
        for (op in ops) arr.put(
            when (op) {
                is Op.Ins -> JSONArray().put("i").put(op.pos).put(op.s)
                is Op.Del -> JSONArray().put("d").put(op.pos).put(op.n)
            },
        )
        return arr
    }

    fun fromJson(arr: JSONArray): List<Op> = (0 until arr.length()).map {
        val o = arr.getJSONArray(it)
        if (o.getString(0) == "i") Op.Ins(o.getInt(1), o.getString(2)) else Op.Del(o.getInt(1), o.getInt(2))
    }
}

/** What the desktop answered: changes by others since our rev, plus size/checksum of its text. */
class LiveReply(val rev: Int, val entries: List<List<Op>>, val len: Int, val cs: Long)

/**
 * One device's side of a live note (same as LiveClient in ot.mjs). Not thread-safe: call it from one thread, and give
 * receive() the text that is in the editor at that moment.
 */
class LiveClient(val cid: String) {
    var base = ""; private set
    var rev = -1; private set
    var epoch = ""; private set
    private var inflight: List<Op>? = null
    private var sentText = ""
    private var seq = 0

    class Request(val ep: String, val rev: Int, val ops: List<Op>, val seq: Int)

    fun open(text: String, rev: Int, epoch: String) {
        base = text
        this.rev = rev
        this.epoch = epoch
        inflight = null
        sentText = text
    }

    fun prepare(local: String): Request {
        val ops = LiveText.diff(base, local)
        sentText = local
        inflight = ops.ifEmpty { null }
        if (ops.isNotEmpty()) seq += 1
        return Request(epoch, rev, ops, if (ops.isEmpty()) 0 else seq)
    }

    /** Returns the editor's new text (the same as [local] when nothing came in). */
    fun receive(reply: LiveReply, local: String): String {
        var s = inflight ?: emptyList()
        var newBase = base
        val incoming = ArrayList<List<Op>>()
        for (h in reply.entries) {
            val (h2, s2) = LiveText.xform(h, s)
            incoming.add(h2)
            s = s2
            newBase = LiveText.apply(newBase, h)
        }
        newBase = LiveText.apply(newBase, s)
        if (newBase.length != reply.len || LiveText.checksum(newBase) != reply.cs) throw LiveDesync()
        var e = LiveText.diff(sentText, local)
        var text = local
        for (h2 in incoming) {
            val (h3, e2) = LiveText.xform(h2, e)
            text = LiveText.apply(text, h3)
            e = e2
        }
        base = newBase
        rev = reply.rev
        inflight = null
        return text
    }
}
