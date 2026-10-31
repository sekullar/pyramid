package com.sekullar.pyramid

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Base64

/** What the desktop puts in the QR code: pyramid://pair?d=<base64url JSON>. Pure Kotlin so it is unit tested. */
class PairPayload(val pcName: String, val hosts: List<String>, val port: Int, val key: ByteArray, val deviceId: String) {
    companion object {
        fun parse(uri: String): PairPayload? = try {
            if (!uri.startsWith("pyramid://pair?")) null else {
                val d = uri.substringAfter("?d=").substringBefore("&")
                val o = JSONObject(String(Base64.getUrlDecoder().decode(d), Charsets.UTF_8))
                val key = Base64.getDecoder().decode(o.getString("k"))
                val hostsJson = o.getJSONArray("h")
                val hosts = (0 until hostsJson.length()).map { hostsJson.getString(it) }.filter { it.isNotBlank() }
                val port = o.getInt("p")
                val id = o.getString("d")
                if (o.getInt("v") != 1 || key.size != 32 || hosts.isEmpty() || port !in 1..65535 || id.isBlank()) null
                else PairPayload(o.optString("n", "PC").ifBlank { "PC" }, hosts, port, key, id)
            }
        } catch (e: Exception) { null }
    }
}

/** Pairing info and the last sync result. App-private (allowBackup=false); the key is as sensitive as a password. */
class PairingStore(ctx: Context) {
    private val p = ctx.getSharedPreferences("pyramid_sync", Context.MODE_PRIVATE)

    val paired get() = p.getString("key", null) != null
    val key: ByteArray? get() = p.getString("key", null)?.let { Base64.getDecoder().decode(it) }
    val deviceId get() = p.getString("device", "") ?: ""
    val pcName get() = p.getString("pc", "") ?: ""
    val port get() = p.getInt("port", 47820)
    val hosts: List<String> get() {
        val a = JSONArray(p.getString("hosts", "[]"))
        val list = (0 until a.length()).map { a.getString(it) }
        val last = p.getString("last", null)
        return if (last != null && last in list) listOf(last) + list.filter { it != last } else list
    }

    var lastSyncMs: Long
        get() = p.getLong("lastSync", 0L)
        set(v) { p.edit().putLong("lastSync", v).apply() }
    var lastError: String?
        get() = p.getString("lastError", null)
        set(v) { p.edit().putString("lastError", v).apply() }
    var lastSummary: String
        get() = p.getString("lastSummary", "") ?: ""
        set(v) { p.edit().putString("lastSummary", v).apply() }

    fun save(x: PairPayload) {
        p.edit().clear()
            .putString("key", Base64.getEncoder().encodeToString(x.key))
            .putString("device", x.deviceId).putString("pc", x.pcName)
            .putString("hosts", JSONArray(x.hosts).toString()).putInt("port", x.port).apply()
    }

    fun remember(host: String) = p.edit().putString("last", host).apply()
    fun clear() = p.edit().clear().apply()
}

/**
 * What both sides agreed on at the last sync (the engine's `base`): note id -> {hash} or {deleted:true}.
 * Always cleared together with the pairing: a base from another computer would make the engine think notes were deleted.
 */
class BaseState(ctx: Context) {
    private val file = File(ctx.filesDir, "sync-base.json")

    fun load(): JSONObject = try { JSONObject(file.readText()) } catch (e: Exception) { JSONObject() }

    fun save(base: JSONObject) {
        val tmp = File(file.parentFile, "sync-base.json.tmp")
        tmp.writeText(base.toString())
        java.nio.file.Files.move(tmp.toPath(), file.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING)
    }

    fun clear() { file.delete() }
}
