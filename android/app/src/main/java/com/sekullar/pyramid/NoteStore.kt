package com.sekullar.pyramid

import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID

/**
 * Notes are `.md` files in the app's private folder, in the same format as on the desktop. Nothing is deleted for good:
 * removed notes move to `.trash`, and files whose name starts with a dot are never listed (same rule as the desktop).
 */
class NoteStore(private val dir: File) {
    class Item(val id: String, val file: File, val title: String, val preview: String, val tags: List<String>, val updated: String)
    class Note(val id: String, val file: File, val created: String, val updated: String, val tags: List<String>, val body: String)

    init { dir.mkdirs() }

    private fun now(): String = ISO.format(java.time.Instant.now())

    private fun files(): List<File> = dir.listFiles { f -> f.isFile && !f.name.startsWith(".") && f.name.endsWith(".md", ignoreCase = true) }?.toList() ?: emptyList()

    fun all(): List<Item> = files().mapNotNull { f ->
        runCatching {
            val p = NoteFormat.parse(f.readText())
            val id = p.id ?: return@runCatching null
            Item(id, f, NoteFormat.titleOf(p.body, f.name), NoteFormat.previewOf(p.body), p.tags, p.updated ?: "")
        }.getOrNull()
    }.sortedByDescending { it.updated }

    fun load(id: String): Note? = files().firstNotNullOfOrNull { f ->
        runCatching {
            val p = NoteFormat.parse(f.readText())
            if (p.id == id) Note(id, f, p.created ?: now(), p.updated ?: now(), p.tags, p.body) else null
        }.getOrNull()
    }

    /** Writes the note; the file is replaced in one step so a crash cannot leave half a note. */
    fun save(id: String, body: String): Note? {
        val old = load(id) ?: return null
        val updated = now()
        write(old.file, NoteFormat.serialize(id, old.created, updated, old.tags, body))
        return Note(id, old.file, old.created, updated, old.tags, body)
    }

    fun create(): String {
        val id = UUID.randomUUID().toString()
        var file = File(dir, "Untitled.md")
        var n = 2
        while (file.exists()) file = File(dir, "Untitled ${n++}.md")
        val t = now()
        write(file, NoteFormat.serialize(id, t, t, emptyList(), "# \n\n"))
        return id
    }

    fun trash(id: String) {
        val note = load(id) ?: return
        val bin = File(dir, ".trash").also { it.mkdirs() }
        Files.move(note.file.toPath(), File(bin, "${System.currentTimeMillis()}-${note.file.name}").toPath(), StandardCopyOption.REPLACE_EXISTING)
    }

    // ---- what sync needs (mirrors desktop/electron/sync/vault.js) ----

    class Raw(val file: File, val raw: String, val hash: String)

    /** Every note that has an id, by id, with its text and fingerprint. */
    fun scan(): Map<String, Raw> {
        val out = LinkedHashMap<String, Raw>()
        for (f in files()) runCatching {
            val raw = f.readText()
            val id = NoteFormat.idOf(raw) ?: return@runCatching
            if (id !in out) out[id] = Raw(f, raw, NoteFormat.hash(raw))
        }
        return out
    }

    /**
     * What the engine needs: live notes with their hash, plus a tombstone for every note that was in sync before
     * (it is in `base`) but is no longer here. That is how a deletion is noticed without recording it.
     */
    fun snapshot(base: org.json.JSONObject): org.json.JSONObject {
        val files = scan()
        val snap = org.json.JSONObject()
        for ((id, r) in files) snap.put(id, org.json.JSONObject().put("hash", r.hash))
        for (id in base.keys()) if (id !in files) snap.put(id, org.json.JSONObject().put("deleted", true))
        return snap
    }

    fun readRaw(id: String): String = scan()[id]?.raw ?: throw IllegalStateException("no such note")

    /** Overwrites the note with this id, or creates a new file named after its title. The text must carry the same id. */
    fun writeRaw(id: String, raw: String) {
        if (NoteFormat.idOf(raw) != id) throw IllegalArgumentException("note id does not match")
        val existing = scan()[id]
        write(existing?.file ?: newFile(raw), raw)
    }

    private fun newFile(raw: String): File {
        val body = NoteFormat.parse(raw).body
        val heading = Regex("(?m)^#[ \\t]+(.+)$").find(body)?.groupValues?.get(1)
        val base = (heading ?: "Untitled").replace(Regex("[^\\p{L}\\p{N} ._()-]"), "").replace(Regex("\\s+"), " ").trim().take(80).ifEmpty { "Untitled" }
        var file = File(dir, "$base.md")
        var n = 2
        while (file.exists()) file = File(dir, "$base ${n++}.md")
        return file
    }

    private fun write(file: File, text: String) {
        val tmp = File(dir, ".${file.name}.tmp")
        tmp.writeText(text)
        Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
    }

    companion object {
        // Same shape as JavaScript's toISOString(): 2026-10-31T10:00:00.000Z
        private val ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)
    }
}
