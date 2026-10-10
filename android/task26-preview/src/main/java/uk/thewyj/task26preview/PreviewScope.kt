package uk.thewyj.task26preview

import java.net.URI

/** No runtime origin overrides, production bridge, native finance or updater. */
object PreviewScope {
    const val APPLICATION_ID = "uk.thewyj.app.preview"
    const val ORIGIN = "https://codex-task26-adaptive-learni.thewyj-uk.pages.dev"
    private const val HOST = "codex-task26-adaptive-learni.thewyj-uk.pages.dev"
    private val routes = setOf("/", "/login", "/register", "/select", "/language",
        "/language/english", "/language/japanese", "/account", "/admin", "/changelog")
    private val apiPaths = setOf("/api/login", "/api/register", "/api/logout", "/api/me",
        "/api/features", "/api/release-channel", "/api/membership/plans", "/api/health",
        "/api/config", "/api/changelog", "/api/telemetry", "/api/rubric", "/api/judge",
        "/api/quiz/start", "/api/vocabulary/suggest", "/api/japanese/readings",
        "/api/tools/access", "/api/tools/preferences", "/api/admin/feature-flags",
        "/api/admin/feature-flags/override", "/api/admin/feature-flags/evaluate",
        "/api/admin/learning/metrics")

    private fun trusted(rawUrl: String): URI? {
        val uri = runCatching { URI(rawUrl) }.getOrNull() ?: return null
        if (!uri.scheme.equals("https", true) || !uri.host.equals(HOST, true) ||
            uri.userInfo != null || uri.port !in setOf(-1, 443)) return null
        if (uri.rawPath.orEmpty().contains('%') || uri.normalize().path != uri.path ||
            uri.path.orEmpty().contains('\\')) return null
        return uri
    }

    fun allowsNavigation(rawUrl: String): Boolean {
        val uri = trusted(rawUrl) ?: return false
        return uri.path.orEmpty().ifEmpty { "/" } in routes
    }

    fun allowsRequest(rawUrl: String): Boolean {
        val uri = trusted(rawUrl) ?: return false
        val route = uri.path.orEmpty().ifEmpty { "/" }
        return if (route.startsWith("/api/")) route in apiPaths || route.startsWith("/api/learning/")
        else true
    }
}
