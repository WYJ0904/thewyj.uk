package uk.thewyj.app.task22

import org.junit.Assert.assertEquals
import org.junit.Test

class TransferLinksTest {
    @Test fun shareLinkUsesTheDeploymentTheAccountSignedInTo() {
        assertEquals(
            "https://thewyj.uk/transfer#share=abc123",
            TransferLinks.shareLink("https://thewyj.uk", "abc123"),
        )
        assertEquals(
            "https://f7adc3d0.thewyj-uk.pages.dev/transfer#share=abc123",
            TransferLinks.shareLink("https://f7adc3d0.thewyj-uk.pages.dev/", "abc123"),
        )
    }
}
