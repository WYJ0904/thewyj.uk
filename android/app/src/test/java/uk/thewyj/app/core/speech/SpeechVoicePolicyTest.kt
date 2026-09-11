package uk.thewyj.app.core.speech

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SpeechVoicePolicyTest {
    private fun voice(name: String, tag: String, language: String, network: Boolean = false, quality: Int = 400) =
        SpeechVoiceInfo(name = name, localeTag = tag, language = language, requiresNetwork = network, quality = quality)

    @Test fun englishContentUsesAnEnglishVoice() {
        val selected = SpeechVoicePolicy.select(
            listOf(
                voice("cmn-cn-x-ccc", "zh-CN", "zh"),
                voice("en-us-x-sfg", "en-US", "en"),
            ),
            "en-US",
        )
        assertEquals("en-us-x-sfg", selected?.name)
    }

    @Test fun offlineVoicesWinOverNetworkVoices() {
        val selected = SpeechVoicePolicy.select(
            listOf(
                voice("en-us-network", "en-US", "en", network = true, quality = 500),
                voice("en-us-local", "en-US", "en", network = false, quality = 300),
            ),
            "en-US",
        )
        assertEquals("en-us-local", selected?.name)
    }

    @Test fun exactLocaleBeatsOtherEnglishRegions() {
        val selected = SpeechVoicePolicy.select(
            listOf(
                voice("en-gb", "en-GB", "en"),
                voice("en-us", "en-US", "en"),
            ),
            "en-US",
        )
        assertEquals("en-us", selected?.name)
    }

    @Test fun japaneseContentSelectsJapaneseVoice() {
        val selected = SpeechVoicePolicy.select(
            listOf(voice("en-us", "en-US", "en"), voice("ja-jp", "ja-JP", "ja")),
            "ja-JP",
        )
        assertEquals("ja-jp", selected?.name)
    }

    @Test fun missingLanguageVoiceIsReportedInsteadOfFallingBack() {
        assertNull(SpeechVoicePolicy.select(listOf(voice("zh-cn", "zh-CN", "zh")), "en-US"))
        assertNull(SpeechVoicePolicy.select(emptyList(), "en-US"))
    }
}
