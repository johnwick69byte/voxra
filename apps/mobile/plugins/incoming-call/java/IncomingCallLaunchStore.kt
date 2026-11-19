package com.simple_talk.app

import org.json.JSONObject

/** One-shot payload the lock-screen Accept button hands to JS. */
object IncomingCallLaunchStore {
    @Volatile
    private var payload: String? = null

    fun set(data: Map<String, String>, action: String) {
        val json = JSONObject()
        for ((key, value) in data) {
            json.put(key, value)
        }
        json.put("action", action)
        payload = json.toString()
    }

    fun consume(): String? {
        val value = payload
        payload = null
        return value
    }
}
