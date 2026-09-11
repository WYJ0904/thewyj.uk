package uk.thewyj.app.core.speech

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SpeechVoicePolicyTest {
    private fun voice(name: String, tag: String, language: String, network: Boolean = false, quality: Int = 400) =
        SpeechVoiceInfo(name = name, localeTag = tag, language = language, requiresNetwork = network, quality = quality)

    @Test fun englishContentUsesAnEnglishVoice() {
        val plan = SpeechVoicePolicy.plan(
            listOf(
                voice("cmn-cn-x-ccc", "zh-CN", "zh"),
                voice("en-us-x-sfg", "en-US", "en"),
            ),
            "en-US",
        )
        assertEquals("en-us-x-sfg", plan.voice?.name)
        assertEquals("preferred-local", plan.stage)
    }

    @Test fun offlineVoicesWinOverNetworkVoices() {
        val plan = SpeechVoicePolicy.plan(
            listOf(
                voice("en-us-network", "en-US", "en", network = true, quality = 500),
                voice("en-us-local", "en-US", "en", network = false, quality = 300),
            ),
            "en-US",
        )
        assertEquals("en-us-local", plan.voice?.name)
    }

    @Test fun exactLocaleBeatsOtherEnglishRegions() {
        val plan = SpeechVoicePolicy.plan(
            listOf(
                voice("en-gb", "en-GB", "en"),
                voice("en-us", "en-US", "en"),
            ),
            "en-US",
        )
        assertEquals("en-us", plan.voice?.name)
    }

    @Test fun japaneseContentSelectsJapaneseVoice() {
        val plan = SpeechVoicePolicy.plan(
            listOf(voice("en-us", "en-US", "en"), voice("ja-jp", "ja-JP", "ja")),
            "ja-JP",
        )
        assertEquals("ja-jp", plan.voice?.name)
    }

    /**
     * Real-device regression: a missing preferred en-US voice must fall back
     * through installed/network voices and finally the engine locale default
     * instead of reporting "no English TTS".
     */
    @Test fun missingPreferredVoiceFallsBackInsteadOfFailing() {
        val otherEnglish = SpeechVoicePolicy.plan(listOf(voice("en-gb", "en-GB", "en")), "en-US")
        assertEquals("en-gb", otherEnglish.voice?.name)
        assertEquals("any-local", otherEnglish.stage)

        val networkOnly = SpeechVoicePolicy.plan(
            listOf(voice("en-au-network", "en-AU", "en", network = true)),
            "en-US",
        )
        assertEquals("network", networkOnly.stage)
        assertEquals("en-au-network", networkOnly.voice?.name)

        val noVoices = SpeechVoicePolicy.plan(emptyList(), "en-US")
        assertNull(noVoices.voice)
        assertEquals("locale-default", noVoices.stage)

        val japanese = SpeechVoicePolicy.plan(emptyList(), "ja-JP")
        assertEquals("locale-default", japanese.stage)
        assertEquals("ja-JP", japanese.language)
    }
}
