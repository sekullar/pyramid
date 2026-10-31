package com.sekullar.pyramid

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/** The vectors below were produced by desktop/electron/sync/ot.mjs; the phone must give the same answers. */
class LiveTextTest {
    // x, a's result, b's result, text after both changes were merged (desktop = a, the side that goes first)
    private val vectors = listOf(
        arrayOf("", " \n", "", " \n"),
        arrayOf("", "ğ😀", "ğc", "ğ😀ğc"),
        arrayOf("ğcbçbğ", "ğcbçbaaağ", "ğcb çbğ", "ğcb çbaaağ"),
        arrayOf(" çc", " c", " çc", " c"),
        arrayOf("", "", "ğcb", "ğcb"),
        arrayOf("😀", "😀", "😀", "😀"),
        arrayOf("ğ\n😀😀 ğ\n", "ğ\n😀a ğ\n", "ğ\n😀😀 ğ\n", "ğ\n😀a ğ\n"),
        arrayOf("bç\nb\n\n", "bç\n\n", "bç\nb\n", "bç\n"),
        arrayOf("😀\n\nçc", "😀\n\n😀😀ğc", "😀çc", "😀😀😀ğc"),
        arrayOf(" 😀\nc\n😀c ç", " 😀😀\nc\n😀c ç", " 😀\nc\n😀c ç", " 😀😀\nc\n😀c ç"),
        arrayOf(" ğbç😀c\ncb", " ğbç😀c\nç", " ğbç😀c\ncb", " ğbç😀c\nç"),
        arrayOf("a", "", "a", ""),
        arrayOf("😀 \nğ\n 😀 cçğ", "😀 \nğ\n 😀 cçğ", "😀  😀 cçğ", "😀  😀 cçğ"),
        arrayOf("c\ncbbağğğ", "a😀bbağğğ", "c\ncbbabağğ", "a😀bbabağğ"),
        arrayOf("", "", "ç😀 ", "ç😀 "),
        arrayOf(" \nccbb😀c😀\n", " \nccb😀c😀\n", " \nccbbc😀\n", " \nccbc😀\n"),
        arrayOf("b", "", "b\nç", "\nç"),
        arrayOf("ğab a😀", "ğab a😀\n\n", "ğab a😀", "ğab a😀\n\n"),
        arrayOf("çbğccç ğğ", "çbğccçğğ", "çbğccç ğ😀cçğ", "çbğccçğ😀cçğ"),
        arrayOf(" cça", " \nbğ", " cça", " \nbğ"),
        arrayOf("", "aç😀", " ğa", "aç😀 ğa"),
        arrayOf("ğa😀ğğ\nca", "ğa😀ğğ\naca", "ğa😀bağğ\nca", "ğa😀bağğ\naca"),
        arrayOf("", "", "", ""),
        arrayOf("😀😀aab ca\nç", "😀😀aa😀\nb ca\nç", "😀😀aab ca\nçb", "😀😀aa😀\nb ca\nçb"),
        arrayOf("bab", "bççb", "ğbbab", "ğbbççb"),
        arrayOf("\nğaç😀cç \nç ", "\nğaç😀cç \nç ", "\n😀ğaç😀cç \nç ", "\n😀ğaç😀cç \nç "),
        arrayOf("ağ a\nğğc", "ağ \nğğc", "a a\nğğc", "a \nğğc"),
        arrayOf("😀ağc", "c", "😀ağc", "c"),
        arrayOf("😀  \n", " ba  \n", "😀  \naa\n", " ba  \naa\n"),
        arrayOf("\n😀ca çğa\nb", "\n😀cb😀 çğa\nb", "\n😀 çğa\nb", "\n😀b😀 çğa\nb"),
    )

    private val sums = listOf(
        "" to 2166136261L,
        "a" to 3826002220L,
        "hello" to 1335831723L,
        "çğ😀\nx" to 569789892L,
    )

    @Test fun mergesLikeTheDesktop() {
        for (v in vectors) {
            val (x, a, b, expected) = v
            val ao = LiveText.diff(x, a)
            val bo = LiveText.diff(x, b)
            val (a2, b2) = LiveText.xform(ao, bo)
            assertEquals("a then b': ${v.toList()}", expected, LiveText.apply(LiveText.apply(x, ao), b2))
            assertEquals("b then a': ${v.toList()}", expected, LiveText.apply(LiveText.apply(x, bo), a2))
        }
    }

    @Test fun checksumMatchesTheDesktop() {
        for ((text, sum) in sums) assertEquals(text, sum, LiveText.checksum(text))
    }

    @Test fun opsSurviveJson() {
        val ops = LiveText.diff("héllo 😀 world", "héllo 😀 brave new world")
        assertEquals(ops, LiveText.fromJson(LiveText.toJson(ops)))
    }

    @Test fun diffNeverSplitsAnEmoji() {
        for ((a, b) in listOf("a😀b" to "a😁b", "😀" to "😁", "x😀" to "x😀😀")) {
            for (op in LiveText.diff(a, b)) if (op is Op.Ins) {
                assertTrue(!op.s.last().isHighSurrogate() && !op.s.first().isLowSurrogate())
            }
            assertEquals(b, LiveText.apply(a, LiveText.diff(a, b)))
        }
    }

    private val alphabet = listOf("a", "b", "c", " ", "\n", "ç", "ğ", "😀")
    private fun text(r: Random, n: Int) = (0 until n).joinToString("") { alphabet[r.nextInt(alphabet.size)] }
    private fun edit(r: Random, t: String): String {
        val chars = t.codePoints().toArray().map { String(Character.toChars(it)) }
        val from = r.nextInt(chars.size + 1)
        val cut = r.nextInt(minOf(4, chars.size - from + 1))
        val add = if (r.nextDouble() < 0.7) text(r, r.nextInt(4)) else ""
        return chars.take(from).joinToString("") + add + chars.drop(from + cut).joinToString("")
    }

    @Test fun randomSimultaneousChangesConverge() {
        val r = Random(5)
        repeat(3000) {
            val x = text(r, r.nextInt(12))
            val ao = LiveText.diff(x, edit(r, x))
            val bo = LiveText.diff(x, edit(r, x))
            val (a2, b2) = LiveText.xform(ao, bo)
            assertEquals(LiveText.apply(LiveText.apply(x, bo), a2), LiveText.apply(LiveText.apply(x, ao), b2))
        }
    }

    /** A pretend desktop, as in ot.test.js. */
    private class FakeServer(var text: String) {
        val history = ArrayList<List<Op>>()
        fun call(req: LiveClient.Request): LiveReply {
            val entries = history.drop(req.rev)
            var o = req.ops
            for (h in entries) o = LiveText.xform(h, o).second
            if (o.isNotEmpty()) { text = LiveText.apply(text, o); history.add(o) }
            return LiveReply(history.size, entries, text.length, LiveText.checksum(text))
        }
    }

    @Test fun threeDevicesTypingConverge() {
        val r = Random(77)
        repeat(200) { round ->
            val start = text(r, 6)
            val server = FakeServer(start)
            val clients = (1..3).map { LiveClient("c$it").also { c -> c.open(start, 0, "e") } }
            val texts = MutableList(3) { start }
            repeat(40) {
                val i = r.nextInt(3)
                if (r.nextDouble() < 0.6) texts[i] = edit(r, texts[i])
                else texts[i] = clients[i].receive(server.call(clients[i].prepare(texts[i])), texts[i])
            }
            repeat(3) { for (i in 0..2) texts[i] = clients[i].receive(server.call(clients[i].prepare(texts[i])), texts[i]) }
            for (i in 0..2) assertEquals("round $round device $i", server.text, texts[i])
        }
    }

    @Test fun editsTypedWhileARequestIsInFlightAreKept() {
        val server = FakeServer("hello")
        val a = LiveClient("a").also { it.open("hello", 0, "e") }
        val b = LiveClient("b").also { it.open("hello", 0, "e") }
        var aText = "hello world"
        val req = a.prepare(aText)
        aText = "hello world!" // typed while the request travels
        server.call(b.prepare("Oh hello"))
        aText = a.receive(server.call(req), aText)
        assertEquals("Oh hello world!", aText)
        aText = a.receive(server.call(a.prepare(aText)), aText)
        assertEquals("Oh hello world!", server.text)
    }
}
