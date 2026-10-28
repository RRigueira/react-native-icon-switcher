package com.iconswitcher

import android.app.Activity
import android.app.Application
import android.content.ComponentName
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.annotation.VisibleForTesting
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.Future

class SetResult(
  val status: String,
)

class IconSwitcher internal constructor(
  private val context: Context,
  private val packageManager: PackageManager,
  private val packageName: String,
  private val prefs: android.content.SharedPreferences,
  private val lifecycleRegistrar: (DefaultLifecycleObserver) -> Unit,
  private val activityLifecycleRegistrar: (Application.ActivityLifecycleCallbacks) -> Unit,
  private val isInForeground: () -> Boolean,
) {
  private val writeExecutor = Executors.newSingleThreadExecutor()
  private val processStartLock = Any()
  private var processStartInitialized = false
  private var startedActivityCount = 0

  private val markedAliases: Map<String, ComponentName> by lazy { discoverMarkedAliases() }
  private val applyOn: String by lazy { readApplyOn() }
  private val skipBrands: Set<String> by lazy { readSkipBrands() }

  val iconNames: List<String> by lazy { buildIconNames() }

  val isSupported: Boolean by lazy {
    markedAliases.isNotEmpty() && !skipBrands.contains(Build.BRAND.lowercase())
  }

  constructor(context: Context) : this(
    context = context.applicationContext,
    packageManager = context.applicationContext.packageManager,
    packageName = context.applicationContext.packageName,
    prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE),
    lifecycleRegistrar = { observer ->
      if (Looper.myLooper() == Looper.getMainLooper()) {
        ProcessLifecycleOwner.get().lifecycle.addObserver(observer)
      } else {
        Handler(Looper.getMainLooper()).post {
          ProcessLifecycleOwner.get().lifecycle.addObserver(observer)
        }
      }
    },
    activityLifecycleRegistrar = { callbacks ->
      (context.applicationContext as Application).registerActivityLifecycleCallbacks(callbacks)
    },
    isInForeground = {
      ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
    },
  )

  internal constructor(
    context: Context,
    packageManager: PackageManager,
  ) : this(
    context = context.applicationContext,
    packageManager = packageManager,
    packageName = context.applicationContext.packageName,
    prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE),
    lifecycleRegistrar = { },
    activityLifecycleRegistrar = { },
    isInForeground = { false },
  )

  fun onModuleCreate() {
    onProcessStart()
  }

  fun onProcessStart() {
    synchronized(processStartLock) {
      if (processStartInitialized) {
        return
      }
      activityLifecycleRegistrar(createActivityLifecycleCallbacks())
      lifecycleRegistrar(
        object : DefaultLifecycleObserver {
          override fun onStop(owner: LifecycleOwner) {
            val pending = prefs.getString(KEY_PENDING, null)
            if (pending != null) {
              runApply(pending, deferred = true)
            }
          }
        },
      )
      runColdStart()
      processStartInitialized = true
    }
  }

  fun current(): String {
    val fromPm = readCurrentFromPackageManager()
    if (fromPm != null) {
      return fromPm
    }
    return prefs.getString(KEY_CURRENT, DEFAULT_ICON_NAME) ?: DEFAULT_ICON_NAME
  }

  fun set(name: String): SetResult {
    if (!isSupported) {
      throw ErrUnsupportedException()
    }
    if (!markedAliases.containsKey(name)) {
      throw ErrUnknownIconException("Unknown icon name: $name")
    }

    val pending = prefs.getString(KEY_PENDING, null)
    if (name == current() && pending == null) {
      return SetResult(STATUS_APPLIED)
    }

    if (applyOn == APPLY_ON_BACKGROUND) {
      prefs.edit().putString(KEY_PENDING, name).apply()
      return SetResult(STATUS_PENDING)
    }

    runApply(name, deferred = false)
    return SetResult(STATUS_APPLIED)
  }

  fun applyPendingNow(): SetResult {
    val pending = prefs.getString(KEY_PENDING, null)
    if (pending == null) {
      return SetResult(STATUS_NONE)
    }
    if (isInForeground()) {
      throw ErrForegroundException()
    }
    runApply(pending, deferred = false)
    return SetResult(STATUS_APPLIED)
  }

  private fun createActivityLifecycleCallbacks(): Application.ActivityLifecycleCallbacks {
    return object : Application.ActivityLifecycleCallbacks {
      override fun onActivityStarted(activity: Activity) {
        startedActivityCount++
      }

      override fun onActivityStopped(activity: Activity) {
        // Clamped: when registered late (no startup provider, so from the module),
        // activities that started earlier were never counted.
        startedActivityCount = maxOf(0, startedActivityCount - 1)
        if (startedActivityCount == 0 && !activity.isChangingConfigurations) {
          val pending = prefs.getString(KEY_PENDING, null)
          if (pending != null) {
            applyPendingOnLastActivityStop(pending)
          }
        }
      }

      override fun onActivityCreated(activity: Activity, savedInstanceState: android.os.Bundle?) {}
      override fun onActivityResumed(activity: Activity) {}
      override fun onActivityPaused(activity: Activity) {}
      override fun onActivitySaveInstanceState(activity: Activity, outState: android.os.Bundle) {}
      override fun onActivityDestroyed(activity: Activity) {}
    }
  }

  private fun applyPendingOnLastActivityStop(name: String) {
    val future = submitOnWriteExecutor { applyOnExecutor(name, deferred = true) }
    try {
      future.get()
    } catch (_: Exception) {
      // applyOnExecutor stores lastError for deferred failures; never propagate here.
    }
  }

  private fun runColdStart() {
    if (prefs.getString(KEY_PENDING, null) != null) {
      return
    }

    val stored = prefs.getString(KEY_CURRENT, DEFAULT_ICON_NAME) ?: DEFAULT_ICON_NAME
    val fromPm = readCurrentFromPackageManager()
    if (fromPm != null && fromPm != stored) {
      prefs.edit().putString(KEY_PENDING, stored).apply()
    }
  }

  private fun runApply(name: String, deferred: Boolean) {
    val future = submitOnWriteExecutor { applyOnExecutor(name, deferred) }
    if (deferred) {
      return
    }
    try {
      future.get()
    } catch (e: ErrOsRejectedException) {
      throw e
    } catch (e: Exception) {
      val cause = e.cause
      if (cause is ErrOsRejectedException) {
        throw cause
      }
      throw e
    }
  }

  private fun applyOnExecutor(name: String, deferred: Boolean) {
    if (!markedAliases.containsKey(name)) {
      if (deferred) {
        prefs.edit().putString(KEY_LAST_ERROR, "Unknown icon: $name").apply()
      } else {
        throw ErrUnknownIconException("Unknown icon name: $name")
      }
      return
    }

    val settings = buildComponentSettings(name)

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        val apiSettings = settings.map { setting ->
          PackageManager.ComponentEnabledSetting(
            setting.componentName,
            setting.enabledState,
            PackageManager.DONT_KILL_APP,
          )
        }
        packageManager.setComponentEnabledSettings(apiSettings)
      } else {
        for (setting in settings) {
          packageManager.setComponentEnabledSetting(
            setting.componentName,
            setting.enabledState,
            PackageManager.DONT_KILL_APP,
          )
        }
      }
    } catch (e: Exception) {
      val message = e.message ?: "Failed to update component enabled state"
      if (deferred) {
        prefs.edit().putString(KEY_LAST_ERROR, message).apply()
        return
      }
      throw ErrOsRejectedException(message)
    }

    if (!verifyReadBack(name)) {
      val message = "Component enabled state read-back did not match expected values"
      if (deferred) {
        prefs.edit().putString(KEY_LAST_ERROR, message).apply()
        return
      }
      throw ErrOsRejectedException(message)
    }

    prefs.edit()
      .putString(KEY_CURRENT, name)
      .remove(KEY_PENDING)
      .remove(KEY_LAST_ERROR)
      .apply()
  }

  private data class ComponentSetting(
    val componentName: ComponentName,
    val enabledState: Int,
  )

  private fun buildComponentSettings(targetName: String): List<ComponentSetting> {
    return markedAliases.map { (iconName, component) ->
      val state = if (iconName == targetName) {
        PackageManager.COMPONENT_ENABLED_STATE_ENABLED
      } else {
        PackageManager.COMPONENT_ENABLED_STATE_DISABLED
      }
      ComponentSetting(component, state)
    }
  }

  internal fun applyIcon(name: String, deferred: Boolean = false) {
    runApply(name, deferred)
  }

  private fun verifyReadBack(expectedActive: String): Boolean {
    for ((iconName, component) in markedAliases) {
      val expectedEnabled = iconName == expectedActive
      val actual = packageManager.getComponentEnabledSetting(component)
      val isEnabled = actual == PackageManager.COMPONENT_ENABLED_STATE_ENABLED ||
        (actual == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && expectedEnabled && _isDefaultEnabledInManifest(component))
      val isDisabled = actual == PackageManager.COMPONENT_ENABLED_STATE_DISABLED ||
        (actual == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && !expectedEnabled && !_isDefaultEnabledInManifest(component))

      if (expectedEnabled && !isEnabled) {
        return false
      }
      if (!expectedEnabled && !isDisabled) {
        return false
      }
    }
    return true
  }

  private fun _isDefaultEnabledInManifest(component: ComponentName): Boolean {
    val flags = PackageManager.GET_ACTIVITIES or
      PackageManager.GET_META_DATA or
      PackageManager.MATCH_DISABLED_COMPONENTS
    val info = packageManager.getPackageInfo(packageName, flags)
    val activity = info.activities?.find { it.name == component.className } ?: return false
    return activity.enabled
  }

  private fun readCurrentFromPackageManager(): String? {
    if (markedAliases.isEmpty()) {
      return null
    }
    val enabled = mutableListOf<String>()
    for ((name, component) in markedAliases) {
      val state = packageManager.getComponentEnabledSetting(component)
      val isOn = state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED ||
        (state == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && _isDefaultEnabledInManifest(component))
      if (isOn) {
        enabled.add(name)
      }
    }
    if (enabled.size == 1) {
      return enabled[0]
    }
    if (enabled.size > 1) {
      val stored = prefs.getString(KEY_CURRENT, null)
      if (stored != null && enabled.contains(stored)) {
        return stored
      }
      return enabled.first()
    }
    return null
  }

  private fun discoverMarkedAliases(): Map<String, ComponentName> {
    val flags = PackageManager.GET_ACTIVITIES or
      PackageManager.GET_META_DATA or
      PackageManager.MATCH_DISABLED_COMPONENTS
    val packageInfo = try {
      packageManager.getPackageInfo(packageName, flags)
    } catch (_: PackageManager.NameNotFoundException) {
      return emptyMap()
    }

    val result = linkedMapOf<String, ComponentName>()
    val activities = packageInfo.activities ?: return emptyMap()
    for (activity in activities) {
      val meta = activity.metaData ?: continue
      if (!meta.containsKey(META_ICON)) {
        continue
      }
      val iconName = meta.getString(META_ICON) ?: continue
      result[iconName] = ComponentName(packageName, activity.name)
    }
    return result
  }

  private fun buildIconNames(): List<String> {
    val marked = markedAliases.keys
    val configured = readConfiguredIconOrder()
    val ordered = mutableListOf<String>()
    for (name in configured) {
      if (marked.contains(name)) {
        ordered.add(name)
      }
    }
    val missing = marked.filter { !ordered.contains(it) }.sorted()
    ordered.addAll(missing)
    return if (ordered.contains(DEFAULT_ICON_NAME)) {
      ordered.remove(DEFAULT_ICON_NAME)
      listOf(DEFAULT_ICON_NAME) + ordered
    } else {
      ordered
    }
  }

  private fun readConfiguredIconOrder(): List<String> {
    val appInfo = applicationInfoOrNull() ?: return emptyList()
    val raw = appInfo.metaData?.getString(META_ICONS) ?: return emptyList()
    return raw.split(',').map { it.trim() }.filter { it.isNotEmpty() }
  }

  private fun readApplyOn(): String {
    val appInfo = applicationInfoOrNull() ?: return APPLY_ON_BACKGROUND
    val value = appInfo.metaData?.getString(META_APPLY_ON) ?: return APPLY_ON_BACKGROUND
    return if (value == APPLY_ON_IMMEDIATE) APPLY_ON_IMMEDIATE else APPLY_ON_BACKGROUND
  }

  private fun readSkipBrands(): Set<String> {
    val appInfo = applicationInfoOrNull() ?: return emptySet()
    val raw = appInfo.metaData?.getString(META_SKIP_BRANDS) ?: return emptySet()
    return raw.split(',').map { it.trim().lowercase() }.filter { it.isNotEmpty() }.toSet()
  }

  private fun applicationInfoOrNull(): ApplicationInfo? {
    return try {
      packageManager.getApplicationInfo(packageName, PackageManager.GET_META_DATA)
    } catch (_: PackageManager.NameNotFoundException) {
      null
    }
  }

  private fun <T> submitOnWriteExecutor(callable: Callable<T>): Future<T> {
    return writeExecutor.submit(callable)
  }

  companion object {
    const val PREFS_NAME = "icon_switcher"
    const val KEY_CURRENT = "current"
    const val KEY_PENDING = "pending"
    const val KEY_LAST_ERROR = "lastError"

    const val META_ICON = "com.iconswitcher.icon"
    const val META_ICONS = "com.iconswitcher.icons"
    const val META_APPLY_ON = "com.iconswitcher.applyOn"
    const val META_SKIP_BRANDS = "com.iconswitcher.skipBrands"

    const val APPLY_ON_BACKGROUND = "background"
    const val APPLY_ON_IMMEDIATE = "immediate"

    const val DEFAULT_ICON_NAME = "default"
    const val STATUS_APPLIED = "applied"
    const val STATUS_PENDING = "pending"
    const val STATUS_NONE = "none"

    @Volatile
    private var instance: IconSwitcher? = null

    fun getInstance(context: Context): IconSwitcher {
      val appContext = context.applicationContext
      instance?.let { return it }
      return synchronized(this) {
        instance ?: IconSwitcher(appContext).also { instance = it }
      }
    }

    @VisibleForTesting
    internal fun clearInstanceForTests() {
      synchronized(this) {
        instance = null
      }
    }
  }
}
