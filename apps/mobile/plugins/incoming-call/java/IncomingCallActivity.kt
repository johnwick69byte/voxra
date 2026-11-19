package com.simple_talk.app

import android.app.NotificationManager
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.WindowManager
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class IncomingCallActivity : AppCompatActivity() {
    private var player: MediaPlayer? = null
    private val handler = Handler(Looper.getMainLooper())
    private var callId: String? = null
    private val timeout = Runnable {
        if (!isFinishing) {
            IncomingCallNotifier.dismiss(this, callId)
            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showOverLockScreen()
        setContentView(R.layout.activity_incoming_call)
        showing = this
        bind(intent)
    }

    @Deprecated("Decline is the only way to leave the ring")
    override fun onBackPressed() {
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        bind(intent)
    }

    override fun onDestroy() {
        handler.removeCallbacks(timeout)
        stopRing()
        if (showing === this) showing = null
        super.onDestroy()
    }

    private fun bind(intent: Intent?) {
        val data = IncomingCallNotifier.readCallExtras(intent)
        callId = data["call_id"]
        val name = data["caller_name"] ?: "Someone"
        val video = (data["call_type"] ?: "AUDIO").equals("VIDEO", true)
        findViewById<TextView>(R.id.caller_name).text = name
        findViewById<TextView>(R.id.call_kind).text =
            if (video) "Incoming video call" else "Incoming audio call"
        val settings = findViewById<TextView>(R.id.fullscreen_settings)
        val needsSetting = Build.VERSION.SDK_INT >= 34 &&
            !(getSystemService(NOTIFICATION_SERVICE) as NotificationManager).canUseFullScreenIntent()
        settings.visibility = if (needsSetting) TextView.VISIBLE else TextView.GONE
        settings.setOnClickListener {
            val screen = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
                this.data = Uri.parse("package:$packageName")
            }
            startActivity(screen)
        }
        findViewById<TextView>(R.id.btn_decline).setOnClickListener { decline(data) }
        findViewById<TextView>(R.id.btn_accept).setOnClickListener { accept(data) }
        startRing()
        handler.removeCallbacks(timeout)
        handler.postDelayed(timeout, 45_000)
    }

    private fun accept(data: Map<String, String>) {
        IncomingCallLaunchStore.set(data, "accept")
        stopRing()
        IncomingCallNotifier.dismiss(this, data["call_id"])
        val launch = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        startActivity(launch)
        finish()
    }

    private fun decline(data: Map<String, String>) {
        IncomingCallRejector.reject(data)
        stopRing()
        IncomingCallNotifier.dismiss(this, data["call_id"])
        finish()
    }

    private fun startRing() {
        if (player != null) return
        try {
            val created = MediaPlayer()
            created.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            created.setDataSource(
                this,
                Uri.parse("android.resource://$packageName/${R.raw.sound_effect}")
            )
            created.isLooping = true
            created.prepare()
            created.start()
            player = created
        } catch (_: Exception) {
            player?.release()
            player = null
        }
    }

    private fun stopRing() {
        try {
            player?.stop()
        } catch (_: Exception) {
        }
        player?.release()
        player = null
    }

    private fun showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    companion object {
        @Volatile
        private var showing: IncomingCallActivity? = null

        fun finishIfShowing(callId: String?) {
            val activity = showing ?: return
            if (callId != null && activity.callId != null && activity.callId != callId) return
            activity.runOnUiThread {
                if (!activity.isFinishing) activity.finish()
            }
        }
    }
}
