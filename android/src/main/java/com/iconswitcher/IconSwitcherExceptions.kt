package com.iconswitcher

internal open class IconSwitcherException(
  val code: String,
  message: String,
) : Exception(message)

internal class ErrUnsupportedException(
  message: String = "Alternate app icons are not supported on this device",
) : IconSwitcherException("ERR_UNSUPPORTED", message)

internal class ErrUnknownIconException(
  message: String = "Unknown icon name",
) : IconSwitcherException("ERR_UNKNOWN_ICON", message)

internal class ErrOsRejectedException(
  message: String = "The OS rejected the icon change",
) : IconSwitcherException("ERR_OS_REJECTED", message)

internal class ErrForegroundException(
  message: String =
    "Cannot apply a pending icon change while the app is in the foreground; " +
      "doing so would close the visible screen. The change is applied automatically when the app goes to the background.",
) : IconSwitcherException("ERR_FOREGROUND", message)
