package uk.thewyj.app.core.auth

import android.content.Context
import java.util.UUID

fun interface DeviceIdentity {
    fun getOrCreate(): String
}

class DeviceIdentityStore(context: Context) : DeviceIdentity {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    @Synchronized
    override fun getOrCreate(): String {
        val existing = preferences.getString(DEVICE_ID_KEY, null)
        if (existing != null && runCatching { UUID.fromString(existing) }.isSuccess) return existing
        val created = UUID.randomUUID().toString()
        check(preferences.edit().putString(DEVICE_ID_KEY, created).commit()) {
            "Unable to persist device identity"
        }
        return created
    }

    companion object {
        private const val PREFERENCES_NAME = "uk.thewyj.app.device.v1"
        private const val DEVICE_ID_KEY = "device_id"
    }
}
