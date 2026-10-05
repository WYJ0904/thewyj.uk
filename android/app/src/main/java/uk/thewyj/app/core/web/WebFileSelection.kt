package uk.thewyj.app.core.web

/** Preserve SAF order and URI identity; only content providers can supply files. */
internal fun chooseWebFileUris(clipUris: List<String>, parsedUris: List<String>): List<String> =
    clipUris.ifEmpty { parsedUris }.filter { it.substringBefore(':') == "content" }
