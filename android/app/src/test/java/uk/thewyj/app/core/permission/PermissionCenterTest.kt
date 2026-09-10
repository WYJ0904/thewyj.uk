package uk.thewyj.app.core.permission

import android.Manifest
import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class PermissionCenterTest {
    private val context: Context = RuntimeEnvironment.getApplication()

    @Test fun catalogCoversEveryPermissionTheAppActuallyUses() {
        val states = PermissionCenter.states(context)
        assertEquals(AppPermissionId.entries.toSet(), states.map { it.id }.toSet())
        val listener = states.first { it.id == AppPermissionId.NOTIFICATION_LISTENER }
        assertEquals(PermissionKind.SYSTEM_SETTINGS, listener.kind)
        assertNotNull(PermissionCenter.settingsIntent(context, listener.id))
        val runtime = states.first { it.id == AppPermissionId.RECEIVE_SMS }
        assertEquals(PermissionKind.RUNTIME, runtime.kind)
        assertTrue(PermissionCenter.runtimePermissionsFor(runtime.id).contains(Manifest.permission.RECEIVE_SMS))
        val battery = states.first { it.id == AppPermissionId.BATTERY_OPTIMIZATION }
        assertEquals(PermissionKind.OPTIONAL_SETTINGS, battery.kind)
    }

    @Test fun everyItemExplainsWhatIsMissingAndWhereToFixIt() {
        PermissionCenter.states(context).forEach { state ->
            assertTrue("${state.id} needs a title", state.title.isNotBlank())
            assertTrue("${state.id} needs a purpose", state.purpose.isNotBlank())
            assertTrue("${state.id} needs an action label", state.actionLabel.isNotBlank())
            assertTrue("${state.id} needs a status", state.statusText.isNotBlank())
            if (!state.granted) {
                assertTrue("${state.id} must explain where to fix it", state.statusText != "未开启" || state.kind == PermissionKind.RUNTIME)
            }
        }
    }

    @Test fun runtimeStateFollowsTheSystemGrant() {
        val application = context as android.app.Application
        assertFalse(PermissionCenter.runtimeGranted(context, Manifest.permission.RECEIVE_SMS))
        shadowOf(application).grantPermissions(Manifest.permission.RECEIVE_SMS)
        assertTrue(PermissionCenter.runtimeGranted(context, Manifest.permission.RECEIVE_SMS))
        val sms = PermissionCenter.states(context).first { it.id == AppPermissionId.RECEIVE_SMS }
        assertTrue(sms.granted)
        assertEquals("已开启", sms.statusText)
    }

    @Test fun notificationListenerIntentTargetsTheSystemListenerScreen() {
        val intent = PermissionCenter.settingsIntent(context, AppPermissionId.NOTIFICATION_LISTENER)
        assertEquals("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS", intent?.action)
        val install = PermissionCenter.settingsIntent(context, AppPermissionId.INSTALL_PACKAGES)
        assertEquals(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, install?.action)
        assertEquals("package:${context.packageName}", install?.data?.toString())
    }

    @Test fun restrictedSettingsHintOnlyAppliesToSideloadedModernAndroid() {
        assertFalse(PermissionDecisions.restrictedSettingsRisk(32, "com.android.vending"))
        assertFalse(PermissionDecisions.restrictedSettingsRisk(34, "com.android.vending"))
        assertTrue(PermissionDecisions.restrictedSettingsRisk(34, null))
        assertTrue(PermissionDecisions.restrictedSettingsRisk(34, "com.example.filemanager"))
    }
}
