package uk.thewyj.app.core.auth

object AuthInputPolicy {
    data class Requirement(val label: String, val satisfied: Boolean)
    private val common = setOf("password1!", "password123!", "password1234!", "qwerty123!", "welcome1!", "admin123!", "aeris12345!", "changeme1!")
    fun requirements(secret: String): List<Requirement> = listOf(
        Requirement("至少 9 个字符", secret.codePointCount(0, secret.length) >= 9),
        Requirement("包含大写英文字母 A–Z", secret.any { it in 'A'..'Z' }),
        Requirement("包含小写英文字母 a–z", secret.any { it in 'a'..'z' }),
        Requirement("包含数字 0–9", secret.any { it in '0'..'9' }),
        Requirement("包含特殊符号（空格不计）", Regex("[\\p{P}\\p{S}]").containsMatchIn(secret)),
    )
    fun isNewSecretValid(secret: String): Boolean = requirements(secret).all { it.satisfied } &&
        secret.codePointCount(0, secret.length) <= 128 && !Regex("[\\x00-\\x1f\\x7f]").containsMatchIn(secret) &&
        java.text.Normalizer.normalize(secret, java.text.Normalizer.Form.NFKC).lowercase(java.util.Locale.ROOT) !in common
    fun canSubmit(username: String, secret: String, registering: Boolean): Boolean =
        username.isNotBlank() && if (registering) isNewSecretValid(secret) else secret.isNotEmpty()
}
