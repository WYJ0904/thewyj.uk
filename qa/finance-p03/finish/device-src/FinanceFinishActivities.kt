package uk.thewyj.app.qa.finance
import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import android.widget.TextView

class FinanceFinishPlainActivity:Activity(){
    override fun onCreate(b:Bundle?){super.onCreate(b);setContentView(TextView(this).apply{text="FINANCE P03 SYNTHETIC LIFECYCLE CONTROL"})}
    override fun onResume(){super.onResume();window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)}
    override fun onStop(){window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);super.onStop()}
}
class FinanceFinishCoverActivity:Activity(){
    override fun onCreate(b:Bundle?){super.onCreate(b);setContentView(TextView(this).apply{text="FINANCE P03 SYNTHETIC BACKGROUND CONTROL"});Handler(Looper.getMainLooper()).postDelayed({finish()},700)}
}
