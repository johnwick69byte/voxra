package com.simple_talk.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class IncomingCallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val data = IncomingCallNotifier.readCallExtras(intent)
        when (intent?.action) {
            IncomingCallNotifier.ACTION_ACCEPT -> {
                IncomingCallLaunchStore.set(data, "accept")
                IncomingCallNotifier.dismiss(context, data["call_id"])
                val launch = Intent(context, MainActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP
                }
                context.startActivity(launch)
            }
            IncomingCallNotifier.ACTION_DECLINE -> {
                IncomingCallRejector.reject(data)
                IncomingCallNotifier.dismiss(context, data["call_id"])
            }
        }
    }
}
