package uk.thewyj.app.task22

import org.json.JSONObject
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

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
    private val lock = locks.computeIfAbsent(file.canonicalPath) { Any() }

    fun load(): TransferConfig = synchronized(lock) {
        if (!file.exists()) return@synchronized TransferConfig()
        runCatching { TransferConfig.fromJson(JSONObject(file.readText(Charsets.UTF_8))) }.getOrDefault(TransferConfig())
    }

    fun save(config: TransferConfig) = synchronized(lock) {
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(config.toJson().toString(), Charsets.UTF_8)
        runCatching {
            Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        }.recoverCatching {
            Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
        }.getOrThrow()
    }

    companion object {
        private val locks = java.util.concurrent.ConcurrentHashMap<String, Any>()
        fun inDirectory(directory: File, accountId: String): TransferConfigStore {
            val safe = accountId.replace(Regex("""[^A-Za-z0-9._-]"""), "_").take(80)
            return TransferConfigStore(File(directory, "transfer-config-$safe.json"))
        }
    }
}
