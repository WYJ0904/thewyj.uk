package uk.thewyj.app.core.web

/** Rendering demand is separate from the retained WebView/session lifetime. */
internal fun webContentActive(nativePageVisible: Boolean, overlayVisible: Boolean): Boolean =
    !nativePageVisible && !overlayVisible
