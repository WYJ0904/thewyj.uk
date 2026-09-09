package uk.thewyj.app.task21

import java.security.MessageDigest
import java.util.UUID

/**
 * Stable notification identity. The fingerprint is a SHA-256 of the source
 * package plus the raw notification fields, so the same notification update
 * maps to the same fingerprint and never produces duplicate records.
 */
object NotificationFingerprint {
    fun sha256Hex(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { byte -> "%02x".format(byte) }
    }

    fun fingerprint(
        sourcePackage: String,
        title: String,
        text: String,
        bigText: String,
        subText: String,
    ): String {
        val canonical = listOf(sourcePackage, title, text, bigText, subText)
            .joinToString("\u001F") { it.replace("\u001F", "") }
        return sha256Hex(canonical)
    }

    fun stableEventId(): String = UUID.randomUUID().toString()
}

