package com.simple_talk.app

import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object IncomingCallRejector {
    private const val DEFAULT_API = "https://voxra-dkfe.onrender.com/api"

    fun reject(data: Map<String, String>) {
        val callId = data["call_id"] ?: return
        val token = data["decline_token"] ?: return
        val base = (data["api_base"] ?: DEFAULT_API).trimEnd('/')
        Thread {
            var connection: HttpURLConnection? = null
            try {
                connection = (URL("$base/calls/$callId/reject-token").openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    setRequestProperty("Content-Type", "application/json")
                    doOutput = true
                    connectTimeout = 8000
                    readTimeout = 8000
                }
                val body = JSONObject().put("decline_token", token).toString()
                connection.outputStream.use { it.write(body.toByteArray()) }
                connection.responseCode
            } catch (error: Exception) {
                Log.w("IncomingCall", "decline failed", error)
            } finally {
                connection?.disconnect()
            }
        }.start()
    }
}
