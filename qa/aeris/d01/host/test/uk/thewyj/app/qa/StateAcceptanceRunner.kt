package uk.thewyj.app.qa

import android.app.UiAutomation
import androidx.test.runner.AndroidJUnitRunner

/** Never suppress the owner's already-running accessibility services. */
class StateAcceptanceRunner : AndroidJUnitRunner() {
    override fun getUiAutomation(): UiAutomation? =
        super.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
    override fun getUiAutomation(flags:Int): UiAutomation? =
        super.getUiAutomation(flags or UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
}
