package uk.thewyj.app.core.network

import org.junit.Assert.assertEquals
import org.junit.Test

class AppUpdatePolicyTest {
    @Test fun latestVersionDoesNotPrompt() {
        assertEquals(
            AppUpdatePolicy.Decision.UP_TO_DATE,
            AppUpdatePolicy.decide(2, 2, 1, "https://thewyj.uk/api/app/download"),
        )
    }

    @Test fun newerInstalledVersionDoesNotPrompt() {
        assertEquals(
            AppUpdatePolicy.Decision.UP_TO_DATE,
            AppUpdatePolicy.decide(3, 2, 1, "https://thewyj.uk/api/app/download"),
        )
    }

    @Test fun olderVersionPromptsAnUpdate() {
        assertEquals(
            AppUpdatePolicy.Decision.UPDATE_AVAILABLE,
            AppUpdatePolicy.decide(1, 2, 1, "https://thewyj.uk/api/app/download"),
        )
    }

    @Test fun belowMinimumVersionIsMandatory() {
        assertEquals(
            AppUpdatePolicy.Decision.MANDATORY_UPDATE,
            AppUpdatePolicy.decide(1, 5, 3, "https://thewyj.uk/api/app/download"),
        )
    }

    @Test fun missingDownloadUrlFallsBackWithoutPrompting() {
        assertEquals(AppUpdatePolicy.Decision.UP_TO_DATE, AppUpdatePolicy.decide(1, 2, 1, ""))
        assertEquals(AppUpdatePolicy.Decision.UP_TO_DATE, AppUpdatePolicy.decide(1, 2, 1, "   "))
    }
}
