package uk.thewyj.app.core.update

import uk.thewyj.app.core.network.AppConfig
import uk.thewyj.app.core.network.AppUpdatePolicy

/**
 * Pure mapping from the published release metadata to what the update screen
 * shows. Kept free of Android types so every branch is unit tested.
 */
object UpdateFlow {
    fun checkResult(
        currentVersionCode: Int,
        currentVersionName: String,
        config: AppConfig,
    ): UpdateUiState {
        val decision = AppUpdatePolicy.decide(
            currentVersionCode,
            config.latestVersionCode,
            config.minimumVersionCode,
            config.downloadUrl,
        )
        return when (decision) {
            AppUpdatePolicy.Decision.UP_TO_DATE ->
                UpdateUiState.UpToDate(currentVersionName, currentVersionCode)
            AppUpdatePolicy.Decision.UPDATE_AVAILABLE ->
                UpdateUiState.Available(
                    config.latestVersionName,
                    config.latestVersionCode,
                    config.releaseNotes,
                    mandatory = false,
                )
            AppUpdatePolicy.Decision.MANDATORY_UPDATE ->
                UpdateUiState.Available(
                    config.latestVersionName,
                    config.latestVersionCode,
                    config.releaseNotes,
                    mandatory = true,
                )
        }
    }

    fun downloadFailed(message: String): UpdateUiState =
        UpdateUiState.Failed(message.ifBlank { "安装包下载失败，请检查网络后重试。" })

    fun afterDownload(versionName: String, canInstallPackages: Boolean, verified: Boolean): UpdateUiState = when {
        !verified -> UpdateUiState.Failed("安装包校验失败（SHA-256 不一致），已停止安装。请重新下载。")
        !canInstallPackages -> UpdateUiState.NeedsInstallPermission(versionName)
        else -> UpdateUiState.ReadyToInstall(versionName)
    }

    fun describe(state: UpdateUiState): String = when (state) {
        UpdateUiState.Idle -> "尚未检查更新"
        UpdateUiState.Checking -> "正在检查更新…"
        is UpdateUiState.UpToDate -> "当前已是最新版 v${state.versionName} (${state.versionCode})"
        is UpdateUiState.Available -> "发现新版本 v${state.versionName} (${state.versionCode})${if (state.mandatory) "，此版本需要更新" else ""}"
        is UpdateUiState.Downloading -> "正在下载 ${state.percent}%"
        is UpdateUiState.Verifying -> "正在校验安装包…"
        is UpdateUiState.NeedsInstallPermission -> "请先允许 thewyj 安装应用，返回后继续安装 v${state.versionName}"
        is UpdateUiState.ReadyToInstall -> "安装包已就绪，即将打开系统安装器 v${state.versionName}"
        is UpdateUiState.Failed -> state.message
    }
}
