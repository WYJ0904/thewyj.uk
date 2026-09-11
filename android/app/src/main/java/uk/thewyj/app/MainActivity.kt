package uk.thewyj.app

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import uk.thewyj.app.core.design.ThewyjTheme
import uk.thewyj.app.ui.AppViewModel
import uk.thewyj.app.ui.ThewyjApp

class MainActivity : ComponentActivity() {
    private val viewModel by viewModels<AppViewModel>()
    private val connectivityManager by lazy { getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager }
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            viewModel.onNetworkAvailable()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        routeIntent(intent)
        setContent {
            val webDark by viewModel.nativeDark.collectAsStateWithLifecycle()
            ThewyjTheme(darkTheme = webDark ?: isSystemInDarkTheme()) {
                ThewyjApp(viewModel)
            }
        }
    }

    override fun onStart() {
        super.onStart()
        runCatching { connectivityManager.registerDefaultNetworkCallback(networkCallback) }
        // P0-2/P0-3: cold start and resume both reconcile the shared pending-hint
        // state, so web-side confirmations reach the app without a manual refresh.
        Thread {
            runCatching { uk.thewyj.app.task21.payment.PaymentHintSync(applicationContext).sync() }
        }.start()
    }

    override fun onStop() {
        runCatching { connectivityManager.unregisterNetworkCallback(networkCallback) }
        super.onStop()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        routeIntent(intent)
    }

    private fun routeIntent(intent: Intent?) {
        // Payment recognition notifications deep link into the finance page so
        // the user can review the candidate or re-verify the amount.
        val verifyRecognitionId = intent?.getStringExtra(PAYMENT_VERIFY_EXTRA).orEmpty()
        val notificationRecognitionId = intent?.getStringExtra(PAYMENT_NOTIFICATION_EXTRA).orEmpty()
        if (verifyRecognitionId.isNotBlank() || notificationRecognitionId.isNotBlank()) {
            val recognitionId = verifyRecognitionId.ifBlank { notificationRecognitionId }
            // 「核实交易金额」 must really start a new 90 second ticket: the
            // notification used to open /finance and do nothing, which is why
            // the pending payment flow never closed. The ticket is created off
            // the main thread, then the native pending surface is shown.
            Thread {
                runCatching {
                    val center = uk.thewyj.app.task21.payment.PaymentVerificationCenter(applicationContext)
                    if (verifyRecognitionId.isNotBlank()) center.startVerification(verifyRecognitionId)
                }
                runOnUiThread {
                    viewModel.openPaymentVerification(recognitionId)
                }
            }.start()
            return
        }
        val uri = intent?.data ?: return
        val route = when (uri.scheme) {
            "https" -> if (uri.host == "thewyj.uk") uri.encodedPath.orEmpty() else ""
            "thewyj" -> uri.getQueryParameter("route").orEmpty()
            else -> ""
        }
        if (route.isNotBlank()) viewModel.openRoute(route)
    }

    companion object {
        const val PAYMENT_NOTIFICATION_EXTRA = "thewyj_recognition_id"
        const val PAYMENT_VERIFY_EXTRA = "thewyj_verify_recognition_id"
    }
}
