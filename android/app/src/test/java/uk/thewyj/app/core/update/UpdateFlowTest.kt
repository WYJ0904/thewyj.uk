package uk.thewyj.app.core.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import uk.thewyj.app.core.network.AppConfig

class UpdateFlowTest {
    private fun config(
        versionCode: Int = 3,
        versionName: String = "1.2.0",
        minimum: Int = 1,
        url: String = "https://thewyj.uk/api/app/download",
        notes: String = "权限中心、导航与听写修复。",
        sha: String = "a".repeat(64),
    ) = AppConfig(
        latestVersionCode = versionCode,
        latestVersionName = versionName,
        minimumVersionCode = minimum,
        downloadUrl = url,
        releaseNotes = notes,
        releaseDate = "2026-09-11",
        apkFileName = "thewyj-android-1.2.0.apk",
        apkSha256 = sha,
        apkSizeBytes = 1_700_000,
    )

    @Test fun newestInstalledVersionReportsUpToDate() {
        val state = UpdateFlow.checkResult(3, "1.2.0", config(versionCode = 3))
        assertEquals(UpdateUiState.UpToDate("1.2.0", 3), state)
        assertEquals("当前已是最新版 v1.2.0 (3)", UpdateFlow.describe(state))
    }

    @Test fun olderInstalledVersionOffersTheNewReleaseWithNotes() {
        val state = UpdateFlow.checkResult(2, "1.1.0", config()) as UpdateUiState.Available
        assertEquals("1.2.0", state.versionName)
        assertEquals(3, state.versionCode)
        assertTrue(state.notes.contains("听写"))
        assertTrue(UpdateFlow.describe(state).contains("发现新版本"))
    }

    @Test fun versionCodeIsTheComparisonKeyEvenWhenNamesLookNewer() {
        val state = UpdateFlow.checkResult(5, "1.5.0-debug", config(versionCode = 3))
        assertTrue(state is UpdateUiState.UpToDate)
    }

    @Test fun missingDownloadUrlNeverPrompts() {
        assertTrue(UpdateFlow.checkResult(1, "1.0.0", config(url = "")) is UpdateUiState.UpToDate)
    }

    @Test fun belowMinimumVersionIsFlaggedAsRequired() {
        val state = UpdateFlow.checkResult(1, "1.0.0", config(minimum = 3)) as UpdateUiState.Available
        assertTrue(state.mandatory)
        assertTrue(UpdateFlow.describe(state).contains("需要更新"))
    }

    @Test fun downloadGateExplainsHashAndInstallPermissionProblems() {
        assertTrue(UpdateFlow.afterDownload("1.2.0", true, true) is UpdateUiState.ReadyToInstall)
        assertTrue(UpdateFlow.afterDownload("1.2.0", false, true) is UpdateUiState.NeedsInstallPermission)
        val failed = UpdateFlow.afterDownload("1.2.0", true, verified = false) as UpdateUiState.Failed
        assertTrue(failed.message.contains("SHA-256"))
        val emptyMessage = UpdateFlow.downloadFailed("") as UpdateUiState.Failed
        assertTrue(emptyMessage.message.isNotBlank())
    }

    @Test fun downloadProgressIsShownAsPercent() {
        val state = UpdateUiState.Downloading(percent = 42, downloadedBytes = 42, totalBytes = 100)
        assertEquals("正在下载 42%", UpdateFlow.describe(state))
    }
}
