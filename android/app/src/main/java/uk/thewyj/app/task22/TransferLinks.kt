package uk.thewyj.app.task22

/**
 * Share links must point at the deployment the account actually used. The host
 * used to be hardcoded to the Production domain, so shares created against a
 * preview deployment produced links that could never resolve.
 */
object TransferLinks {
    fun shareLink(baseUrl: String, shareId: String): String =
        "${baseUrl.trimEnd('/')}/transfer#share=$shareId"
}
