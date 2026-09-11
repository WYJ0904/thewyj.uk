package uk.thewyj.app.ui

/**
 * Content overlays (permission center, notification archive, file transfer)
 * are drawn above the WebView but are not a second navigation stack. The
 * bottom bar is the single shared navigation entry point, so tapping any of
 * its six destinations must always close every overlay and land on the tapped
 * page. Keeping this as pure data makes the "permission center swallows the
 * bottom bar" regression testable without a device.
 */
data class ShellOverlayState(
    val permissions: Boolean = false,
    val archive: Boolean = false,
    val transfer: Boolean = false,
) {
    val anyVisible: Boolean get() = permissions || archive || transfer
}

data class ShellNavigationResult(
    val destination: AppDestination,
    val overlays: ShellOverlayState,
)

fun bottomNavigationSelection(
    tapped: AppDestination,
    overlays: ShellOverlayState = ShellOverlayState(),
): ShellNavigationResult = ShellNavigationResult(
    destination = tapped,
    overlays = ShellOverlayState(),
)
