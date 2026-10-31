package com.sekullar.pyramid

/** Keeps the cursor where the user was when live sync replaces the text. Same rule as desktop/src/textmap.js. */
object TextMap {
    fun cursor(old: String, new: String, pos: Int): Int {
        val limit = minOf(old.length, new.length)
        var prefix = 0
        while (prefix < limit && old[prefix] == new[prefix]) prefix++
        var suffix = 0
        while (suffix < limit - prefix && old[old.length - 1 - suffix] == new[new.length - 1 - suffix]) suffix++
        return when {
            pos <= prefix -> pos
            pos >= old.length - suffix -> pos + (new.length - old.length)
            else -> new.length - suffix
        }
    }
}
