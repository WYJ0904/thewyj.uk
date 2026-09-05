package uk.thewyj.app.core.auth

object AuthInputPolicy {
    fun canSubmit(username: String, secret: String, registering: Boolean): Boolean =
        username.isNotBlank() && if (registering) secret.length >= 7 else secret.isNotEmpty()
}
