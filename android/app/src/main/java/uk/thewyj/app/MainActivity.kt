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
            ThewyjTheme(darkTheme = isSystemInDarkTheme()) {
                ThewyjApp(viewModel)
            }
        }
    }

    override fun onStart() {
        super.onStart()
        runCatching { connectivityManager.registerDefaultNetworkCallback(networkCallback) }
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
        val uri = intent?.data ?: return
        val route = when (uri.scheme) {
            "https" -> if (uri.host == "thewyj.uk") uri.encodedPath.orEmpty() else ""
            "thewyj" -> uri.getQueryParameter("route").orEmpty()
            else -> ""
        }
        if (route.isNotBlank()) viewModel.openRoute(route)
    }
}
