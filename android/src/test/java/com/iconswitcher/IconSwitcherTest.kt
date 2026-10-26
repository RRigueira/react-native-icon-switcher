package com.iconswitcher

import android.content.ComponentName
import android.content.Context
import android.content.pm.ActivityInfo
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.test.core.app.ApplicationProvider
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class IconSwitcherTest {
  private lateinit var context: Context

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    context.getSharedPreferences(IconSwitcher.PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .clear()
      .apply()
  }

  @Test
  fun discovery_ignores_unmarked_aliases() {
    val switcher = IconSwitcher(context)
    assertEquals(listOf("default", "halloween"), switcher.iconNames)
    assertFalse(switcher.iconNames.contains("UnmarkedAlias"))
  }

  @Test
  fun icon_names_follow_metadata_order_when_package_info_order_differs() {
    val pm = mockk<PackageManager>(relaxed = true)
    val packageName = context.packageName
    every { pm.getPackageInfo(any<String>(), any<Int>()) } returns robolectricPackageInfo(
      packageName,
      iconOrder = listOf("halloween", "zebra", "default"),
    )
    every { pm.getApplicationInfo(any<String>(), any<Int>()) } returns robolectricApplicationInfo(
      icons = "default,zebra,halloween",
    )

    val switcher = IconSwitcher(context, pm)
    assertEquals(listOf("default", "zebra", "halloween"), switcher.iconNames)
  }

  @Test
  fun set_in_background_mode_returns_pending_and_does_not_touch_package_manager() {
    val pm = mockk<PackageManager>(relaxed = true)
    every { pm.getPackageInfo(any<String>(), any<Int>()) } returns robolectricPackageInfo(context.packageName)
    every { pm.getApplicationInfo(any<String>(), any<Int>()) } returns robolectricApplicationInfo()

    val switcher = IconSwitcher(context, pm)
    val result = switcher.set("halloween")

    assertEquals(IconSwitcher.STATUS_PENDING, result.status)
    verify(exactly = 0) { pm.setComponentEnabledSetting(any(), any(), any()) }
    verify(exactly = 0) { pm.setComponentEnabledSettings(any()) }
  }

  @Test
  fun apply_toggles_marked_aliases_with_dont_kill_app() {
    val pm = mockk<PackageManager>(relaxed = true)
    val packageName = context.packageName
    val aliases = robolectricPackageInfo(packageName)
    every { pm.getPackageInfo(any<String>(), any<Int>()) } returns aliases
    every { pm.getApplicationInfo(any<String>(), any<Int>()) } returns robolectricApplicationInfo(
      applyOn = IconSwitcher.APPLY_ON_IMMEDIATE,
    )
    val settingsSlot = slot<List<PackageManager.ComponentEnabledSetting>>()
    every { pm.setComponentEnabledSettings(capture(settingsSlot)) } returns Unit
    every { pm.getComponentEnabledSetting(any()) } answers {
      val component = firstArg<ComponentName>()
      when (component.className) {
        ".IconSwitcher_halloween" -> PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        else -> PackageManager.COMPONENT_ENABLED_STATE_DISABLED
      }
    }

    val switcher = IconSwitcher(context, pm)
    switcher.applyIcon("halloween", deferred = false)

    val settings = settingsSlot.captured
    assertEquals(2, settings.size)
    assertTrue(
      settings.any {
        it.componentName!!.className == ".IconSwitcher_halloween" &&
          it.enabledState == PackageManager.COMPONENT_ENABLED_STATE_ENABLED &&
          it.enabledFlags == PackageManager.DONT_KILL_APP
      },
    )
    assertTrue(
      settings.any {
        it.componentName!!.className == ".IconSwitcher_default" &&
          it.enabledState == PackageManager.COMPONENT_ENABLED_STATE_DISABLED &&
          it.enabledFlags == PackageManager.DONT_KILL_APP
      },
    )
  }

  @Test
  fun read_back_mismatch_reports_os_rejected() {
    val pm = mockk<PackageManager>(relaxed = true)
    val packageName = context.packageName
    every { pm.getPackageInfo(any<String>(), any<Int>()) } returns robolectricPackageInfo(packageName)
    every { pm.getApplicationInfo(any<String>(), any<Int>()) } returns robolectricApplicationInfo(
      applyOn = IconSwitcher.APPLY_ON_IMMEDIATE,
    )
    every { pm.getComponentEnabledSetting(any()) } returns PackageManager.COMPONENT_ENABLED_STATE_DISABLED

    val switcher = IconSwitcher(context, pm)

    assertThrows(ErrOsRejectedException::class.java) {
      switcher.applyIcon("halloween", deferred = false)
    }
  }

  @Test
  fun cold_start_keeps_pending_without_touching_package_manager() {
    val pm = mockk<PackageManager>(relaxed = true)
    val packageName = context.packageName
    every { pm.getPackageInfo(any<String>(), any<Int>()) } returns robolectricPackageInfo(packageName)
    every { pm.getApplicationInfo(any<String>(), any<Int>()) } returns robolectricApplicationInfo()

    context.getSharedPreferences(IconSwitcher.PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(IconSwitcher.KEY_PENDING, "halloween")
      .apply()

    val switcher = IconSwitcher(context, pm)
    switcher.onModuleCreate()

    verify(exactly = 0) { pm.setComponentEnabledSetting(any(), any(), any()) }
    verify(exactly = 0) { pm.setComponentEnabledSettings(any()) }
    val prefs = context.getSharedPreferences(IconSwitcher.PREFS_NAME, Context.MODE_PRIVATE)
    assertEquals("halloween", prefs.getString(IconSwitcher.KEY_PENDING, null))
  }

  @Test
  fun cold_start_pm_mismatch_queues_stored_current_as_pending() {
    val pm = mockk<PackageManager>(relaxed = true)
    val packageName = context.packageName
    every { pm.getPackageInfo(any<String>(), any<Int>()) } returns robolectricPackageInfo(packageName)
    every { pm.getApplicationInfo(any<String>(), any<Int>()) } returns robolectricApplicationInfo()
    every { pm.getComponentEnabledSetting(any()) } answers {
      val component = firstArg<ComponentName>()
      if (component.className == ".IconSwitcher_default") {
        PackageManager.COMPONENT_ENABLED_STATE_ENABLED
      } else {
        PackageManager.COMPONENT_ENABLED_STATE_DISABLED
      }
    }

    context.getSharedPreferences(IconSwitcher.PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(IconSwitcher.KEY_CURRENT, "halloween")
      .apply()

    val switcher = IconSwitcher(context, pm)
    switcher.onModuleCreate()

    verify(exactly = 0) { pm.setComponentEnabledSetting(any(), any(), any()) }
    verify(exactly = 0) { pm.setComponentEnabledSettings(any()) }
    val prefs = context.getSharedPreferences(IconSwitcher.PREFS_NAME, Context.MODE_PRIVATE)
    assertEquals("halloween", prefs.getString(IconSwitcher.KEY_PENDING, null))
  }

  @Test
  fun on_stop_applies_pending_without_blocking_main_thread() {
    val pm = mockk<PackageManager>(relaxed = true)
    val packageName = context.packageName
    every { pm.getPackageInfo(any<String>(), any<Int>()) } returns robolectricPackageInfo(packageName)
    every { pm.getApplicationInfo(any<String>(), any<Int>()) } returns robolectricApplicationInfo()

    context.getSharedPreferences(IconSwitcher.PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(IconSwitcher.KEY_PENDING, "halloween")
      .apply()

    var lifecycleObserver: DefaultLifecycleObserver? = null
    val prefs = context.getSharedPreferences(IconSwitcher.PREFS_NAME, Context.MODE_PRIVATE)
    val switcher = IconSwitcher(
      context = context,
      packageManager = pm,
      packageName = packageName,
      prefs = prefs,
      lifecycleRegistrar = { lifecycleObserver = it },
      isInForeground = { false },
    )

    val applyLatch = CountDownLatch(1)
    val settingsSlot = slot<List<PackageManager.ComponentEnabledSetting>>()
    every { pm.setComponentEnabledSettings(capture(settingsSlot)) } answers {
      applyLatch.countDown()
    }
    every { pm.getComponentEnabledSetting(any()) } answers {
      val component = firstArg<ComponentName>()
      if (component.className == ".IconSwitcher_halloween") {
        PackageManager.COMPONENT_ENABLED_STATE_ENABLED
      } else {
        PackageManager.COMPONENT_ENABLED_STATE_DISABLED
      }
    }

    switcher.onModuleCreate()
    val owner = mockk<LifecycleOwner>(relaxed = true)
    lifecycleObserver!!.onStop(owner)

    assertTrue(applyLatch.await(2, TimeUnit.SECONDS))
    assertTrue(
      settingsSlot.captured.any {
        it.componentName!!.className == ".IconSwitcher_halloween" &&
          it.enabledFlags == PackageManager.DONT_KILL_APP
      },
    )
    var pendingCleared = false
    for (attempt in 0 until 50) {
      if (!prefs.contains(IconSwitcher.KEY_PENDING)) {
        pendingCleared = true
        break
      }
      Thread.sleep(20)
    }
    assertTrue(pendingCleared)
    assertEquals("halloween", prefs.getString(IconSwitcher.KEY_CURRENT, null))
  }

  @Test
  fun apply_pending_none_when_nothing_pending() {
    val pm = mockk<PackageManager>(relaxed = true)
    every { pm.getPackageInfo(any<String>(), any<Int>()) } returns robolectricPackageInfo(context.packageName)
    every { pm.getApplicationInfo(any<String>(), any<Int>()) } returns robolectricApplicationInfo()

    val switcher = switcherWithForeground(pm, inForeground = false)
    val result = switcher.applyPendingNow()

    assertEquals(IconSwitcher.STATUS_NONE, result.status)
    verify(exactly = 0) { pm.setComponentEnabledSetting(any(), any(), any()) }
    verify(exactly = 0) { pm.setComponentEnabledSettings(any()) }
  }

  @Test
  fun apply_pending_in_foreground_throws_and_keeps_pending() {
    val pm = mockk<PackageManager>(relaxed = true)
    every { pm.getPackageInfo(any<String>(), any<Int>()) } returns robolectricPackageInfo(context.packageName)
    every { pm.getApplicationInfo(any<String>(), any<Int>()) } returns robolectricApplicationInfo()

    val prefs = context.getSharedPreferences(IconSwitcher.PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit().putString(IconSwitcher.KEY_PENDING, "halloween").apply()

    val switcher = switcherWithForeground(pm, inForeground = true)

    assertThrows(ErrForegroundException::class.java) {
      switcher.applyPendingNow()
    }
    verify(exactly = 0) { pm.setComponentEnabledSetting(any(), any(), any()) }
    verify(exactly = 0) { pm.setComponentEnabledSettings(any()) }
    assertEquals("halloween", prefs.getString(IconSwitcher.KEY_PENDING, null))
  }

  @Test
  fun apply_pending_in_background_applies_and_clears_pending() {
    val pm = mockk<PackageManager>(relaxed = true)
    val packageName = context.packageName
    every { pm.getPackageInfo(any<String>(), any<Int>()) } returns robolectricPackageInfo(packageName)
    every { pm.getApplicationInfo(any<String>(), any<Int>()) } returns robolectricApplicationInfo()
    val settingsSlot = slot<List<PackageManager.ComponentEnabledSetting>>()
    every { pm.setComponentEnabledSettings(capture(settingsSlot)) } returns Unit
    every { pm.getComponentEnabledSetting(any()) } answers {
      val component = firstArg<ComponentName>()
      if (component.className == ".IconSwitcher_halloween") {
        PackageManager.COMPONENT_ENABLED_STATE_ENABLED
      } else {
        PackageManager.COMPONENT_ENABLED_STATE_DISABLED
      }
    }

    val prefs = context.getSharedPreferences(IconSwitcher.PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit().putString(IconSwitcher.KEY_PENDING, "halloween").apply()

    val switcher = switcherWithForeground(pm, inForeground = false)
    val result = switcher.applyPendingNow()

    assertEquals(IconSwitcher.STATUS_APPLIED, result.status)
    assertTrue(
      settingsSlot.captured.any {
        it.componentName!!.className == ".IconSwitcher_halloween" &&
          it.enabledFlags == PackageManager.DONT_KILL_APP
      },
    )
    assertEquals(null, prefs.getString(IconSwitcher.KEY_PENDING, null))
    assertEquals("halloween", prefs.getString(IconSwitcher.KEY_CURRENT, null))
  }

  @Test
  fun on_module_create_from_background_thread_registers_lifecycle_observer() {
    val switcher = IconSwitcher(context)
    val error = java.util.concurrent.atomic.AtomicReference<Throwable?>(null)
    val done = CountDownLatch(1)
    Thread {
      try {
        switcher.onModuleCreate()
      } catch (t: Throwable) {
        error.set(t)
      } finally {
        done.countDown()
      }
    }.start()
    assertTrue(done.await(2, TimeUnit.SECONDS))
    assertEquals(null, error.get())
    ShadowLooper.idleMainLooper()
  }

  private fun switcherWithForeground(
    pm: PackageManager,
    inForeground: Boolean,
    prefs: android.content.SharedPreferences =
      context.getSharedPreferences(IconSwitcher.PREFS_NAME, Context.MODE_PRIVATE),
  ): IconSwitcher {
    return IconSwitcher(
      context = context,
      packageManager = pm,
      packageName = context.packageName,
      prefs = prefs,
      lifecycleRegistrar = { },
      isInForeground = { inForeground },
    )
  }

  private fun robolectricApplicationInfo(
    applyOn: String = IconSwitcher.APPLY_ON_BACKGROUND,
    icons: String = "default,halloween",
  ): ApplicationInfo {
    return ApplicationInfo().apply {
      metaData = Bundle().apply {
        putString(IconSwitcher.META_APPLY_ON, applyOn)
        putString(IconSwitcher.META_ICONS, icons)
      }
    }
  }

  private fun robolectricPackageInfo(
    packageName: String,
    iconOrder: List<String> = listOf("default", "halloween"),
  ): PackageInfo {
    fun alias(classSuffix: String, iconName: String?, enabled: Boolean): ActivityInfo {
      return ActivityInfo().apply {
        name = classSuffix
        this.packageName = packageName
        this.enabled = enabled
        if (iconName != null) {
          metaData = Bundle().apply { putString(IconSwitcher.META_ICON, iconName) }
        }
      }
    }

    val activities = iconOrder.map { iconName ->
      val suffix = when (iconName) {
        "default" -> ".IconSwitcher_default"
        "halloween" -> ".IconSwitcher_halloween"
        "zebra" -> ".IconSwitcher_zebra"
        else -> ".IconSwitcher_$iconName"
      }
      alias(suffix, iconName, iconName == "default")
    } + alias(".UnmarkedAlias", null, false)

    return PackageInfo().apply {
      this.packageName = packageName
      this.activities = activities.toTypedArray()
    }
  }
}
