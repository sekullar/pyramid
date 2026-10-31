package com.sekullar.pyramid

import org.junit.Assert.assertEquals
import org.junit.Test

class TextMapTest {
    @Test fun cursorBeforeTheChangeStays() = assertEquals(2, TextMap.cursor("hello world", "hello brave world", 2))
    @Test fun cursorAfterTheChangeMoves() = assertEquals(17, TextMap.cursor("hello world", "hello brave world", 11))
    @Test fun cursorInsideRewrittenPartGoesAfterIt() = assertEquals(5, TextMap.cursor("abcXYZdef", "abcQQdef", 4))
    @Test fun deletionBeforeCursorShiftsItBack() = assertEquals(3, TextMap.cursor("abcdef", "def", 6))
    @Test fun identicalTextKeepsCursor() = assertEquals(4, TextMap.cursor("same", "same", 4))
}
