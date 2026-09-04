package uk.thewyj.app.core.web

import java.net.URI

sealed interface NavigationDecision {
    data object Internal : NavigationDecision
    data object RefreshSession : NavigationDecision
    data object Logout : NavigationDecision
    data object External : NavigationDecision
    data object Blocked : NavigationDecision
}

class WebRoutePolicy(baseUrl: String) {
    private val trusted = URI(baseUrl.trimEnd('/')).also {
        require(
            it.scheme.equals("https", true) && !it.host.isNullOrBlank() && it.userInfo == null &&
                it.rawQuery == null && it.rawFragment == null && it.path.orEmpty().isEmpty()
        ) { "thewyj base URL must be an HTTPS origin" }
    }

    fun decide(rawUrl: String): NavigationDecision {
        val uri = runCatching { URI(rawUrl) }.getOrNull() ?: return NavigationDecision.Blocked
        if (uri.scheme.equals("thewyj", ignoreCase = true)) {
            if (!uri.host.equals("session", ignoreCase = true)) return NavigationDecision.Blocked
            return when (uri.path) {
                "/refresh" -> NavigationDecision.RefreshSession
                "/logout" -> NavigationDecision.Logout
                else -> NavigationDecision.Blocked
            }
        }
        if (uri.scheme.equals("https", ignoreCase = true)) {
            return if (uri.host.equals(trusted.host, ignoreCase = true) && effectivePort(uri) == effectivePort(trusted)) {
                NavigationDecision.Internal
            } else {
                NavigationDecision.External
            }
        }
        if (uri.scheme.equals("mailto", true) || uri.scheme.equals("tel", true)) {
            return NavigationDecision.External
        }
        return NavigationDecision.Blocked
    }

    fun urlFor(path: String): String {
        val safePath = if (path.startsWith('/')) path else "/$path"
        return "${trusted.scheme}://${trusted.authority}$safePath"
    }

    private fun effectivePort(uri: URI): Int = when {
        uri.port > 0 -> uri.port
        uri.scheme.equals("https", true) -> 443
        else -> -1
    }
}
