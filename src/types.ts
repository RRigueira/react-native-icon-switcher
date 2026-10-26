/** A path to a square PNG master, ideally 1024 px. Relative to the project root. */
export type ImagePath = string;

/** Hex colour, `#RGB` or `#RRGGBB`. */
export type HexColor = string;

export interface IosIconVariants {
  light: ImagePath;
  /** Phase 2. */
  dark?: ImagePath;
  /** Phase 2. */
  tinted?: ImagePath;
}

export interface AndroidAdaptiveIcon {
  foreground: ImagePath;
  background: ImagePath | HexColor;
  /** Phase 2. Android 13+ themed icons. */
  monochrome?: ImagePath;
}

export interface IconSpec {
  ios?: ImagePath | IosIconVariants;
  android?: ImagePath | AndroidAdaptiveIcon;
}

/** A bare path means "same master for both platforms". */
export type IconSource = ImagePath | IconSpec;

export interface IconSwitcherConfig {
  /** Primary icon. Omit on Expo to reuse `icon` / `android.adaptiveIcon`. */
  default?: IconSource;
  icons: Record<string, IconSource>;
  ios?: {
    /** Background colour that transparent pixels are flattened onto. Default `#FFFFFF`. */
    flattenOn?: HexColor;
  };
  android?: {
    /** Default `'background'`. */
    applyOn?: 'background' | 'immediate';
    /** Lower-cased `Build.BRAND` values where switching is disabled. Default `[]`. */
    skipBrands?: string[];
  };
}

/** Config after validation and defaults; every icon normalised to per-platform specs. */
export interface ResolvedIcon {
  name: string;
  isDefault: boolean;
  ios: IosIconVariants | null;
  android: AndroidAdaptiveIcon | { legacy: ImagePath } | null;
}

export interface ResolvedConfig {
  /** `default` first, then alternates in declaration order. */
  icons: ResolvedIcon[];
  ios: { flattenOn: HexColor };
  android: { applyOn: 'background' | 'immediate'; skipBrands: string[] };
}
