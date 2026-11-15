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
    @Test fun registrationRequiresNineCharactersAndAllFourClasses() {
        assertFalse(AuthInputPolicy.canSubmit("new-user", "123456", true))
        assertFalse(AuthInputPolicy.canSubmit("new-user", "Abcdef1!", true))
        assertTrue(AuthInputPolicy.canSubmit("new-user", "Abcdef1!x", true))
        for (password in listOf("abcdef12!", "ABCDEF12!", "Abcdefgh!", "Abcdef123", "Password1!")) {
            assertFalse(AuthInputPolicy.canSubmit("new-user", password, true))
            assertTrue(AuthInputPolicy.canSubmit("old-user", password, false))
        }
        assertTrue(AuthInputPolicy.isNewSecretValid("Ab1!" + "x".repeat(124)))
        assertFalse(AuthInputPolicy.isNewSecretValid("Ab1!" + "x".repeat(125)))
    }
}
