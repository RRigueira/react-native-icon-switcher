package com.iconswitcher

import android.content.Context
import androidx.lifecycle.ProcessLifecycleInitializer
import androidx.startup.Initializer

class IconSwitcherInitializer : Initializer<Unit> {
  override fun create(context: Context) {
    IconSwitcher.getInstance(context).onProcessStart()
  }

  override fun dependencies(): List<Class<out Initializer<*>>> {
    return listOf(ProcessLifecycleInitializer::class.java)
  }
}
