package com.iconswitcher

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap

class IconSwitcherModule(reactContext: ReactApplicationContext) :
  NativeIconSwitcherSpec(reactContext) {

  private val switcher = IconSwitcher.getInstance(reactApplicationContext)

  override fun initialize() {
    super.initialize()
    switcher.onModuleCreate()
  }

  override fun getTypedExportedConstants(): Map<String, Any> {
    return mapOf(
      "isSupported" to switcher.isSupported,
      "iconNames" to switcher.iconNames,
    )
  }

  override fun getCurrent(promise: Promise) {
    try {
      promise.resolve(switcher.current())
    } catch (e: Throwable) {
      rejectPromise(promise, e)
    }
  }

  override fun set(name: String, promise: Promise) {
    try {
      val result = switcher.set(name)
      promise.resolve(statusMap(result.status))
    } catch (e: Throwable) {
      rejectPromise(promise, e)
    }
  }

  override fun applyPending(promise: Promise) {
    try {
      val result = switcher.applyPendingNow()
      promise.resolve(statusMap(result.status))
    } catch (e: Throwable) {
      rejectPromise(promise, e)
    }
  }

  companion object {
    const val NAME = NativeIconSwitcherSpec.NAME

    private fun statusMap(status: String): WritableMap {
      val map = Arguments.createMap()
      map.putString("status", status)
      return map
    }

    private fun rejectPromise(promise: Promise, error: Throwable) {
      when (error) {
        is IconSwitcherException -> promise.reject(error.code, error.message, error)
        else -> promise.reject("ERR_OS_REJECTED", error.message ?: "Unknown error", error)
      }
    }
  }
}
