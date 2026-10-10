package uk.thewyj.task26preview

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PreviewScopeTest {
    @Test fun acceptedLearningRequestsStayOnControlledPreview() {
        assertTrue(PreviewScope.allowsNavigation(PreviewScope.ORIGIN + "/language/english"))
        assertTrue(PreviewScope.allowsNavigation(PreviewScope.ORIGIN + "/language/japanese"))
        assertTrue(PreviewScope.allowsRequest(PreviewScope.ORIGIN + "/api/learning/events"))
        assertTrue(PreviewScope.allowsRequest(PreviewScope.ORIGIN + "/sw.js?v=task26"))
    }
    @Test fun productionAndOtherOriginsAreRejected() {
        for (url in listOf("https://thewyj.uk/api/learning/events", "https://thewyj.uk/finance",
            "http://codex-task26-adaptive-learni.thewyj-uk.pages.dev/", "https://example.com/",
            "file:///sdcard/example.html", "javascript:alert(1)", "content://example/test",
            "${PreviewScope.ORIGIN}:444/api/learning/events", "https://user@codex-task26-adaptive-learni.thewyj-uk.pages.dev/")) {
            assertFalse(url, PreviewScope.allowsRequest(url))
            assertFalse(url, PreviewScope.allowsNavigation(url))
        }
    }
    @Test fun paymentNotificationUpdateAndNativeRoutesAreRejected() {
        for (route in listOf("/api/finance/transactions", "/api/recharge/request", "/api/app/download",
            "/api/notifications", "/api/admin/recharge/process", "/api/admin/secret", "/api/account/secret")) {
            assertFalse(route, PreviewScope.allowsRequest(PreviewScope.ORIGIN + route))
        }
        assertFalse(PreviewScope.allowsNavigation(PreviewScope.ORIGIN + "/finance"))
        assertFalse(PreviewScope.allowsNavigation("thewyj://payment/verify?event_id=12345678"))
    }
    @Test fun pathConfusionCannotEscapeApiScope() {
        for (route in listOf("/api/learning/../finance/transactions", "/api/learning/%2e%2e/finance",
            "/api/learning%2f..%2ffinance", "/api/learning.evil", "/api/learning/../../api/app/download")) {
            assertFalse(route, PreviewScope.allowsRequest(PreviewScope.ORIGIN + route))
        }
    }
}
