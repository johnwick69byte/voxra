package com.simple_talk.app

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class IncomingCallModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "IncomingCallLaunch"

    @ReactMethod
    fun consume(promise: Promise) {
        promise.resolve(IncomingCallLaunchStore.consume())
    }

    @ReactMethod
    fun dismiss() {
        IncomingCallNotifier.dismiss(reactApplicationContext, IncomingCallNotifier.activeCallId)
    }
}
