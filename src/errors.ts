export type IconSwitcherErrorCode =
  'unsupported' | 'unknown_icon' | 'os_rejected' | 'foreground';

export class IconSwitcherError extends Error {
  readonly code: IconSwitcherErrorCode;

  constructor(code: IconSwitcherErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'IconSwitcherError';
    this.code = code;
  }
}

const _NATIVE_TO_JS: Record<string, IconSwitcherErrorCode> = {
  ERR_UNSUPPORTED: 'unsupported',
  ERR_UNKNOWN_ICON: 'unknown_icon',
  ERR_OS_REJECTED: 'os_rejected',
  ERR_FOREGROUND: 'foreground',
};

export function mapNativeError(error: unknown): IconSwitcherError {
  if (error instanceof IconSwitcherError) {
    return error;
  }
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : undefined;
  const mapped = code ? _NATIVE_TO_JS[code] : undefined;
  if (mapped) {
    const message = error instanceof Error ? error.message : undefined;
    return new IconSwitcherError(mapped, message);
  }
  return new IconSwitcherError(
    'os_rejected',
    error instanceof Error ? error.message : String(error)
  );
}
