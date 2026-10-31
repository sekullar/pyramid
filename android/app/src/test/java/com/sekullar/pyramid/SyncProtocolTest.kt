package com.sekullar.pyramid

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Base64

class SyncProtocolTest {
    private val key = ByteArray(32) { 7 }

    // Produced by the desktop code: seal(Buffer.alloc(32, 7), {t:1761900000000,type:'hello',name:'Galaxy'})
    private val fromDesktop = "eogdctcC1YC6OPGeQTs0wWToGy7o6yQ1Wzxy8cdZYBSPquaGJTQsH3iig9sgvD62UoiCgvG9slOh/vjPbBmVJjJEoyebQHjdPQj8R8lF"

    @Test fun opensWhatTheDesktopSealed() {
        val plain = Crypto.open(key, fromDesktop)
        assertNotNull(plain)
        val o = JSONObject(plain!!)
        assertEquals("hello", o.getString("type"))
        assertEquals("Galaxy", o.getString("name"))
        assertEquals(1761900000000L, o.getLong("t"))
    }

    @Test fun roundTripAndWrongKey() {
        val sealed = Crypto.seal(key, """{"t":1,"type":"sync","snapshot":{}}""")
        assertEquals("""{"t":1,"type":"sync","snapshot":{}}""", Crypto.open(key, sealed))
        assertNull(Crypto.open(ByteArray(32) { 8 }, sealed))
        assertNull(Crypto.open(key, "not base64 at all !!"))
        assertNull(Crypto.open(key, sealed.dropLast(4) + "AAAA"))
    }

    @Test fun twoSealsOfTheSameTextDiffer() {
        assertEquals(false, Crypto.seal(key, "x") == Crypto.seal(key, "x"))
    }

    private fun payload(json: String) = "pyramid://pair?d=" + Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray())
    private val goodKey = Base64.getEncoder().encodeToString(key)

    @Test fun parsesAPairingCode() {
        val p = PairPayload.parse(payload("""{"v":1,"n":"Test PC","h":["172.16.26.81","192.168.137.1"],"p":47820,"k":"$goodKey","d":"abc123"}"""))!!
        assertEquals("Test PC", p.pcName)
        assertEquals(listOf("172.16.26.81", "192.168.137.1"), p.hosts)
        assertEquals(47820, p.port)
        assertEquals("abc123", p.deviceId)
        assertArrayEquals(key, p.key)
    }

    @Test fun rejectsBadPairingCodes() {
        assertNull(PairPayload.parse("https://example.com"))
        assertNull(PairPayload.parse("phoneix://pair?d=" + Base64.getUrlEncoder().encodeToString("{}".toByteArray())))
        assertNull(PairPayload.parse("pyramid://pair?d=%%%"))
        assertNull(PairPayload.parse(payload("""{"v":2,"n":"x","h":["1.1.1.1"],"p":1,"k":"$goodKey","d":"a"}""")))
        assertNull(PairPayload.parse(payload("""{"v":1,"n":"x","h":[],"p":47820,"k":"$goodKey","d":"a"}""")))
        assertNull(PairPayload.parse(payload("""{"v":1,"n":"x","h":["1.1.1.1"],"p":0,"k":"$goodKey","d":"a"}""")))
        assertNull(PairPayload.parse(payload("""{"v":1,"n":"x","h":["1.1.1.1"],"p":47820,"k":"AAAA","d":"a"}""")))
    }
}
