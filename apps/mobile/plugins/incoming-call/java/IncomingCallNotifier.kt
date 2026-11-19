package com.simple_talk.app

import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat

object IncomingCallNotifier {
    const val CHANNEL_ID = "incoming_calls_v2"
    const val ACTION_ACCEPT = "com.simple_talk.app.INCOMING_ACCEPT"
    const val ACTION_DECLINE = "com.simple_talk.app.INCOMING_DECLINE"
    private const val EXTRA_PREFIX = "call_"

    @Volatile
    var activeCallId: String? = null

    fun isAppForeground(context: Context): Boolean {
        val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val pkg = context.packageName
        val processes = manager.runningAppProcesses ?: return false
        return processes.any {
            it.processName == pkg &&
                it.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
        }
    }

    fun show(context: Context, data: Map<String, String>) {
        val callId = data["call_id"] ?: return
        activeCallId = callId
        ensureChannel(context)
        val notification = buildNotification(context, data)
        manager(context).notify(notificationId(callId), notification)

        val canFullScreen = if (Build.VERSION.SDK_INT >= 34) {
            manager(context).canUseFullScreenIntent()
        } else {
            true
        }
        if (canFullScreen) {
            val activity = Intent(context, IncomingCallActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP
                putCallExtras(data)
            }
            try {
                context.startActivity(activity)
            } catch (_: Exception) {
                // The full-screen intent on the notification is the fallback.
            }
        }
    }

    fun dismiss(context: Context, callId: String?) {
        val id = callId ?: activeCallId
        if (!id.isNullOrEmpty()) {
            manager(context).cancel(notificationId(id))
        }
        if (callId == null || callId == activeCallId) {
            activeCallId = null
            IncomingCallActivity.finishIfShowing(callId)
        }
    }

    fun buildNotification(context: Context, data: Map<String, String>): Notification {
        val callId = data["call_id"] ?: ""
        val name = data["caller_name"] ?: "Someone"
        val kind = if ((data["call_type"] ?: "AUDIO").equals("VIDEO", true)) "video" else "audio"
        val content = activityIntent(context, data)
        val accept = actionIntent(context, ACTION_ACCEPT, data)
        val decline = actionIntent(context, ACTION_DECLINE, data)
        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(0xFF0F766E.toInt())
            .setContentTitle(name)
            .setContentText("Incoming $kind call")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(content)
            .setFullScreenIntent(content, true)
            .addAction(0, "Decline", decline)
            .addAction(0, "Accept", accept)
            .build()
    }

    private fun activityIntent(context: Context, data: Map<String, String>): PendingIntent {
        val intent = Intent(context, IncomingCallActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putCallExtras(data)
        }
        return PendingIntent.getActivity(
            context,
            requestCode(data["call_id"], "open"),
            intent,
            pendingFlags()
        )
    }

    private fun actionIntent(context: Context, action: String, data: Map<String, String>): PendingIntent {
        val intent = Intent(context, IncomingCallReceiver::class.java).apply {
            this.action = action
            putCallExtras(data)
        }
        return PendingIntent.getBroadcast(
            context,
            requestCode(data["call_id"], action),
            intent,
            pendingFlags()
        )
    }

    private fun Intent.putCallExtras(data: Map<String, String>) {
        for ((key, value) in data) {
            putExtra(EXTRA_PREFIX + key, value)
        }
    }

    fun readCallExtras(intent: Intent?): Map<String, String> {
        if (intent == null) return emptyMap()
        val out = linkedMapOf<String, String>()
        val extras = intent.extras ?: return out
        for (key in extras.keySet()) {
            if (!key.startsWith(EXTRA_PREFIX)) continue
            val value = extras.getString(key) ?: continue
            out[key.removePrefix(EXTRA_PREFIX)] = value
        }
        return out
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = manager(context)
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Incoming Calls",
            NotificationManager.IMPORTANCE_HIGH
        )
        channel.description = "Incoming audio and video calls"
        channel.enableVibration(true)
        channel.vibrationPattern = longArrayOf(300, 500, 300, 500)
        channel.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        val sound = Uri.parse("android.resource://${context.packageName}/${R.raw.sound_effect}")
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        channel.setSound(sound, attrs)
        manager.createNotificationChannel(channel)
    }

    private fun manager(context: Context): NotificationManager {
        return context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    }

    fun notificationId(callId: String): Int = callId.hashCode()

    private fun requestCode(callId: String?, salt: String): Int {
        return (callId ?: "call").hashCode() xor salt.hashCode()
    }

    private fun pendingFlags(): Int {
        return PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    }
}
