package ir.hozoryar.wifi

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.MessageDigest
import java.util.Locale

class WorkplaceWifiModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("WorkplaceWifi")

        AsyncFunction("scan") { prefix: String, promise: Promise ->
            val context = appContext.reactContext?.applicationContext
            val manager = context?.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            if (context == null || manager == null) {
                promise.reject("WIFI_UNAVAILABLE", "Wi-Fi is unavailable", null)
            } else {
                Handler(Looper.getMainLooper()).post { scan(context, manager, prefix, promise) }
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun scan(context: Context, manager: WifiManager, prefix: String, promise: Promise) {
        if (!manager.isWifiEnabled) {
            promise.reject("WIFI_DISABLED", "Wi-Fi is disabled", null)
            return
        }
        val handler = Handler(Looper.getMainLooper())
        var registered = false
        var finished = false
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.action == WifiManager.SCAN_RESULTS_AVAILABLE_ACTION) complete()
            }

            fun complete() {
                if (finished) return
                try {
                    val nowMicros = SystemClock.elapsedRealtimeNanos() / 1_000
                    val recentResults = manager.scanResults.filter { nowMicros - it.timestamp in 0L..15_000_000L }
                    val digest = MessageDigest.getInstance("SHA-256")
                    val fingerprints = recentResults.sortedByDescending { it.level }
                        .mapNotNull { it.BSSID?.lowercase(Locale.ROOT) }
                        .distinct()
                        .take(256)
                        .map { bssid ->
                            digest.digest((prefix + bssid).toByteArray(Charsets.UTF_8))
                                .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
                        }
                    promise.resolve(fingerprints)
                } catch (error: SecurityException) {
                    promise.reject("WIFI_PERMISSION", "Wi-Fi scan needs precise location", error)
                } finally {
                    finished = true
                    if (registered) context.unregisterReceiver(this)
                }
            }
        }
        try {
            val filter = IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION)
            if (Build.VERSION.SDK_INT >= 33) {
                context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                context.registerReceiver(receiver, filter)
            }
            registered = true
            if (manager.startScan()) {
                handler.postDelayed({ receiver.complete() }, 10_000)
            } else {
                receiver.complete()
            }
        } catch (error: SecurityException) {
            if (registered && !finished) context.unregisterReceiver(receiver)
            promise.reject("WIFI_PERMISSION", "Wi-Fi scan needs precise location", error)
        }
    }
}
