package com.sekullar.pyramid

import java.security.MessageDigest

/**
 * The note file format, identical to desktop/electron/notes.js and desktop/electron/sync/hash.js:
 *
 *   ---
 *   id: <uuid>
 *   created: <iso>
 *   updated: <iso>
 *   tags: [a, b]
 *   ---
 *   <markdown>
 *
 * No Android classes in here so it runs in plain JVM unit tests. NoteFormatTest pins the hashes to values produced by
 * the desktop code: if the two ever disagree, sync would see edits that never happened.
 */
object NoteFormat {
    private val FM = Regex("^---\\r?\\n([\\s\\S]*?)\\r?\\n---\\r?\\n?")
    private val HEADING = Regex("(?m)^#\\s+(.+)$")
    private val FIRST_HEADING_LINE = Regex("(?m)^#.*$")
    private val WHITESPACE = Regex("\\s+")
    private val BRACKETS = Regex("^\\[|\\]$")

    class Parsed(val meta: Map<String, String>, val body: String) {
        val id get() = meta["id"]
        val created get() = meta["created"]
        val updated get() = meta["updated"]
        val tags: List<String> get() = (meta["tags"] ?: "").replace(BRACKETS, "").split(",").map { it.trim() }.filter { it.isNotEmpty() }
    }

    fun parse(raw: String): Parsed {
        val m = FM.find(raw) ?: return Parsed(emptyMap(), raw)
        val meta = LinkedHashMap<String, String>()
        for (line in m.groupValues[1].split(Regex("\\r?\\n"))) {
            val i = line.indexOf(':')
            if (i < 0) continue
            meta[line.substring(0, i).trim()] = line.substring(i + 1).trim()
        }
        return Parsed(meta, raw.substring(m.value.length))
    }

    fun serialize(id: String, created: String, updated: String, tags: List<String>, body: String): String =
        "---\nid: $id\ncreated: $created\nupdated: $updated\ntags: [${tags.joinToString(", ")}]\n---\n$body"

    fun idOf(raw: String): String? = parse(raw).id

    /** Title = first "# " heading, else the file name (same rule as the desktop list). */
    fun titleOf(body: String, fileName: String): String =
        (HEADING.find(body)?.groupValues?.get(1) ?: fileName.removeSuffix(".md")).trim().take(120)

    fun previewOf(body: String): String = body.replaceFirst(FIRST_HEADING_LINE, "").replace(WHITESPACE, " ").trim().take(140)

    /**
     * Fingerprint of what the user wrote: body + tags. `updated`/`created` are left out so re-saving or syncing a note
     * never looks like an edit, and line endings are normalised so Windows and Android agree.
     */
    fun hash(raw: String): String {
        val p = parse(raw)
        val tags = (p.meta["tags"] ?: "").replace(WHITESPACE, "")
        val text = tags + "\n" + p.body.replace("\r\n", "\n")
        return MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
}
