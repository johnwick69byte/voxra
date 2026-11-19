package com.simple_talk.app

import com.google.firebase.messaging.RemoteMessage
import io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService

/**
 * Replaces the stock Firebase messaging service so a killed app still gets a
 * lock-screen call. Foreground rings are left to JS. The stock service's
 * onMessageReceived is a no-op; JS delivery stays on the Firebase receiver.
 */
class IncomingCallMessagingService : ReactNativeFirebaseMessagingService() {
    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        val data = remoteMessage.data
        when (data["type"]) {
            "call_cancel" -> IncomingCallNotifier.dismiss(this, data["call_id"])
            "incoming_call" -> {
                if (!IncomingCallNotifier.isAppForeground(this)) {
                    IncomingCallNotifier.show(this, data)
                }
            }
        }
        super.onMessageReceived(remoteMessage)
    }
}
