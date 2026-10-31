package com.sekullar.pyramid

import android.content.Context
import java.util.Locale

class Prefs(ctx: Context) {
    private val p = ctx.getSharedPreferences("pyramid", Context.MODE_PRIVATE)

    /** "tr" or "en"; follows the phone's language until the user picks one. */
    var lang: String
        get() = p.getString("lang", null) ?: if (Locale.getDefault().language == "tr") "tr" else "en"
        set(v) { p.edit().putString("lang", v).apply() }

    /** Letter-by-letter live typing (also needs the switch on the PC). Off = the sync that runs every few seconds. */
    var liveTyping: Boolean
        get() = p.getBoolean("live", false)
        set(v) { p.edit().putBoolean("live", v).apply() }
}

class T(private val map: Map<String, String>) {
    operator fun get(key: String): String = map[key] ?: key
}

object Strings {
    fun of(lang: String) = T(if (lang == "tr") TR else EN)

    private val TR = mapOf(
        "appName" to "Pyramid",
        "search" to "Notlarda ara...",
        "newNote" to "Yeni not",
        "noNotes" to "Henüz not yok.",
        "noMatch" to "Aramana uyan not yok.",
        "untitled" to "Başlıksız",
        "write" to "Yaz",
        "preview" to "Önizle",
        "saved" to "Kaydedildi",
        "saving" to "Kaydediliyor...",
        "delete" to "Sil",
        "confirmDelete" to "Emin misin?",
        "settings" to "Ayarlar",
        "language" to "Dil",
        "back" to "Geri",
        "version" to "Sürüm",
        "syncTitle" to "Bilgisayarla eşitleme",
        "syncHintOff" to "Notların aynı Wi-Fi’deki bilgisayarla eşitlenir. Bilgisayarda Pyramid’i aç: Ayarlar, Telefon eşitleme, Telefon ekle. Sonra buradan kodu okut.",
        "scanQr" to "QR kodu okut",
        "scanFail" to "Kod okunamadı.",
        "badQr" to "Bu bir Pyramid eşleştirme kodu değil.",
        "pairAskTitle" to "Eşleştir?",
        "pairAskText" to "“{pc}” bilgisayarıyla eşleşilsin mi? Notların bu bilgisayarla eşitlenecek.",
        "pairYes" to "Eşleş",
        "cancel" to "Vazgeç",
        "pairedWith" to "{pc} ile eşleşildi.",
        "errRejected" to "Bilgisayar isteği kabul etmedi. Kodu yenile ve saatlerin doğru olduğundan emin ol.",
        "errUnreachable" to "Bilgisayara ulaşılamadı. İkisi de aynı Wi-Fi’de ve bilgisayarda Pyramid açık mı?",
        "pairedPc" to "Eşleşen bilgisayar",
        "syncNow" to "Şimdi eşitle",
        "liveTitle" to "Harf harfine canlı yazma",
        "liveHint" to "Açıkken bilgisayarla aynı notu yazarken her harf anında görünür. Bilgisayarda da açık olmalı. Kapalıyken not birkaç saniyede bir eşitlenir.",
        "liveStatus" to "Canlı",
        "liveOffPc" to "Bilgisayarda canlı yazma kapalı, normal eşitleme kullanılıyor.",
        "liveOn" to "Açık",
        "liveOff" to "Kapalı",
        "unpair" to "Eşleşmeyi kaldır",
        "syncRunning" to "Eşitleniyor...",
        "syncDone" to "Eşitlendi",
        "syncFailed" to "Eşitlenemedi",
        "syncNever" to "Henüz eşitlenmedi",
        "syncLast" to "Son eşitleme",
        "summary" to "{pulled} alındı, {pushed} gönderildi, {deleted} silindi",
        "conflictsNote" to "{n} çakışma: ayrı not olarak duruyor, bilgisayarda çözebilirsin.",
        "agoNow" to "az önce",
        "agoMin" to "{n} dk önce",
        "agoHour" to "{n} sa önce",
        "agoDay" to "{n} gün önce",
        "errUNREACHABLE" to "Bilgisayara ulaşılamadı",
        "errREJECTED" to "Bilgisayar kabul etmedi",
        "errBAD_REPLY" to "Yanıt doğrulanamadı",
        "errOther" to "Hata",
        "notes" to "not",
    )

    private val EN = mapOf(
        "appName" to "Pyramid",
        "search" to "Search notes...",
        "newNote" to "New note",
        "noNotes" to "No notes yet.",
        "noMatch" to "No notes match your search.",
        "untitled" to "Untitled",
        "write" to "Write",
        "preview" to "Preview",
        "saved" to "Saved",
        "saving" to "Saving...",
        "delete" to "Delete",
        "confirmDelete" to "Are you sure?",
        "settings" to "Settings",
        "language" to "Language",
        "back" to "Back",
        "version" to "Version",
        "syncTitle" to "Sync with computer",
        "syncHintOff" to "Your notes sync with the computer on the same Wi-Fi. On the computer open Pyramid: Settings, Phone sync, Add phone. Then scan the code here.",
        "scanQr" to "Scan QR code",
        "scanFail" to "Could not read the code.",
        "badQr" to "That is not a Pyramid pairing code.",
        "pairAskTitle" to "Pair?",
        "pairAskText" to "Pair with “{pc}”? Your notes will sync with this computer.",
        "pairYes" to "Pair",
        "cancel" to "Cancel",
        "pairedWith" to "Paired with {pc}.",
        "errRejected" to "The computer did not accept the request. Refresh the code and check that both clocks are right.",
        "errUnreachable" to "Could not reach the computer. Are both on the same Wi-Fi, with Pyramid open on the computer?",
        "pairedPc" to "Paired computer",
        "syncNow" to "Sync now",
        "liveTitle" to "Letter-by-letter live typing",
        "liveHint" to "When on, every letter you type in a note shows up on the PC right away, and the other way around. It must also be on in the PC app. When off, notes sync every few seconds.",
        "liveStatus" to "Live",
        "liveOffPc" to "Live typing is off on the PC, using normal sync.",
        "liveOn" to "On",
        "liveOff" to "Off",
        "unpair" to "Unpair",
        "syncRunning" to "Syncing...",
        "syncDone" to "Synced",
        "syncFailed" to "Sync failed",
        "syncNever" to "Not synced yet",
        "syncLast" to "Last sync",
        "summary" to "{pulled} received, {pushed} sent, {deleted} deleted",
        "conflictsNote" to "{n} conflict(s): kept as separate notes, you can resolve them on the computer.",
        "agoNow" to "just now",
        "agoMin" to "{n} min ago",
        "agoHour" to "{n} h ago",
        "agoDay" to "{n} d ago",
        "errUNREACHABLE" to "Could not reach the computer",
        "errREJECTED" to "The computer did not accept it",
        "errBAD_REPLY" to "Reply could not be verified",
        "errOther" to "Error",
        "notes" to "notes",
    )
}

/** "3 min ago" style text from a time in milliseconds. */
fun ago(t: T, ms: Long, now: Long = System.currentTimeMillis()): String {
    val mins = ((now - ms) / 60_000).coerceAtLeast(0)
    return when {
        mins < 1 -> t["agoNow"]
        mins < 60 -> t["agoMin"].replace("{n}", mins.toString())
        mins < 60 * 24 -> t["agoHour"].replace("{n}", (mins / 60).toString())
        else -> t["agoDay"].replace("{n}", (mins / 60 / 24).toString())
    }
}
