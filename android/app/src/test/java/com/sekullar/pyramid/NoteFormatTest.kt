package com.sekullar.pyramid

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NoteFormatTest {
    private fun note(tags: String, body: String) =
        "---\nid: x\ncreated: 2026-10-24T10:00:00.000Z\nupdated: 2026-10-31T10:00:00.000Z\ntags: [$tags]\n---\n$body"

    // Expected values were produced by the desktop code (desktop/electron/sync/hash.js, hashNote).
    @Test fun hashMatchesDesktop() {
        assertEquals("32ea99fc202e1f21337515f9a80e7179cae8cbdf119a3da17284e13d1cf9ea3a", NoteFormat.hash(note("", "# Plan\nhello")))
        assertEquals("21c0ea06c874f3620cb3786dc25f097a21e3b593d9e0573429571a5562ed153e", NoteFormat.hash(note("work, ev", "# Alışveriş\r\n- süt\r\n- ekmek\r\n")))
        assertEquals("57b576567ffece0ebfb4cf9e749046c9a5a72e8ceac8907691498e080b7e97c4", NoteFormat.hash(note("", "# \n\nçğıöşü İĞÜ — emoji 🙂")))
        assertEquals("9ba628d11aed3e3b6a99a00274bccc8e4ed25dc3e8b815f27393ec821b5734d9", NoteFormat.hash("no front matter at all"))
        assertEquals("24d4941e67d5965d270eaebdb9816b994311e0f2f0e79ef6bb626f362c52842e", NoteFormat.hash(note("a", "")))
    }

    @Test fun hashIgnoresUpdatedAndLineEndings() {
        val a = note("", "# A\nhi").replace("2026-10-31T10:00:00.000Z", "2030-01-01T00:00:00.000Z")
        assertEquals(NoteFormat.hash(note("", "# A\nhi")), NoteFormat.hash(a))
        assertEquals(NoteFormat.hash(note("", "a\nb\n")), NoteFormat.hash(note("", "a\r\nb\r\n")))
    }

    @Test fun hashChangesWithTextOrTags() {
        val base = NoteFormat.hash(note("", "# A\nhi"))
        assertTrue(base != NoteFormat.hash(note("", "# A\nhi!")))
        assertTrue(base != NoteFormat.hash(note("work", "# A\nhi")))
    }

    @Test fun parseAndSerializeRoundTrip() {
        val raw = NoteFormat.serialize("abc", "2026-10-24T10:00:00.000Z", "2026-10-31T10:00:00.000Z", listOf("work", "ev"), "# T\ntext")
        assertEquals("---\nid: abc\ncreated: 2026-10-24T10:00:00.000Z\nupdated: 2026-10-31T10:00:00.000Z\ntags: [work, ev]\n---\n# T\ntext", raw)
        val p = NoteFormat.parse(raw)
        assertEquals("abc", p.id)
        assertEquals(listOf("work", "ev"), p.tags)
        assertEquals("# T\ntext", p.body)
    }

    @Test fun noFrontMatter() {
        val p = NoteFormat.parse("just text")
        assertNull(p.id)
        assertEquals("just text", p.body)
        assertEquals(emptyList<String>(), p.tags)
    }

    @Test fun titleAndPreview() {
        assertEquals("Plan", NoteFormat.titleOf("# Plan\nbody", "x.md"))
        assertEquals("x", NoteFormat.titleOf("no heading", "x.md"))
        assertEquals("body text", NoteFormat.previewOf("# Plan\nbody   text"))
    }
}
