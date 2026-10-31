package uk.thewyj.app.qa.financep06

import android.app.UiAutomation
import androidx.test.runner.AndroidJUnitRunner

class FinanceP06Runner : AndroidJUnitRunner() {
    override fun getUiAutomation(): UiAutomation? =
        super.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
    override fun getUiAutomation(flags: Int): UiAutomation? =
        super.getUiAutomation(flags or UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
}
