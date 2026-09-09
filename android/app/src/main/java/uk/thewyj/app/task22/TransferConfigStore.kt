package uk.thewyj.app.task22

import org.json.JSONObject
import java.io.File

data class TransferConfig(
    val minutes: Int = 1440,
    val maxDownloads: Int = 5,
    val oneTime: Boolean = false,
    val password: String = "",
) {
    fun toJson(): JSONObject = JSONObject()
        .put("minutes", minutes)
        .put("max_downloads", maxDownloads)
        .put("one_time", oneTime)
        .put("password", password)

    companion object {
        fun fromJson(json: JSONObject): TransferConfig = TransferConfig(
            minutes = json.optInt("minutes", 1440),
            maxDownloads = json.optInt("max_downloads", 5),
            oneTime = json.optBoolean("one_time", false),
            password = json.optString("password", ""),
        )
    }
}

class TransferConfigStore(private val file: File) {

    fun load(): TransferConfig {
        if (!file.exists()) return TransferConfig()
        return runCatching { TransferConfig.fromJson(JSONObject(file.readText(Charsets.UTF_8))) }.getOrDefault(TransferConfig())
    }

    fun save(config: TransferConfig) {
        file.parentFile?.mkdirs()
        file.writeText(config.toJson().toString(), Charsets.UTF_8)
    }

    companion object {
        fun inDirectory(directory: File, accountId: String): TransferConfigStore {
            val safe = accountId.replace(Regex("""[^A-Za-z0-9._-]"""), "_").take(80)
            return TransferConfigStore(File(directory, "transfer-config-$safe.json"))
        }
    }
}
