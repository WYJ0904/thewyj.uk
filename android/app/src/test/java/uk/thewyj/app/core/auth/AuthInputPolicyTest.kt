package uk.thewyj.app.core.auth

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthInputPolicyTest {
    @Test fun existingSecretIsVerifiedByServerRegardlessOfNewPasswordLength() {
        assertTrue(AuthInputPolicy.canSubmit("legacy", "123456", false))
        assertTrue(AuthInputPolicy.canSubmit("legacy", "x", false))
        assertFalse(AuthInputPolicy.canSubmit("legacy", "", false))
        assertFalse(AuthInputPolicy.canSubmit(" ", "123456", false))
    }
    @Test fun registrationRetainsMinimumLength() {
        assertFalse(AuthInputPolicy.canSubmit("new-user", "123456", true))
        assertTrue(AuthInputPolicy.canSubmit("new-user", "1234567", true))
    }
}
