import sax from 'sax';

import type { ResolvedConfig } from '../types';
import { TransformError } from './errors';

const MAIN_ACTION = 'android.intent.action.MAIN';
const LAUNCHER_CATEGORY = 'android.intent.category.LAUNCHER';
const ICONKIT_ICON_META = 'com.iconswitcher.icon';
const ICONKIT_ICONS_META = 'com.iconswitcher.icons';
const ICONKIT_APPLY_ON_META = 'com.iconswitcher.applyOn';
const ICONKIT_SKIP_BRANDS_META = 'com.iconswitcher.skipBrands';
const DEFAULT_ALIAS = '.IconSwitcher_default';

const RECOGNIZED_ACTIONS = new Set([MAIN_ACTION]);
const RECOGNIZED_CATEGORIES = new Set([LAUNCHER_CATEGORY]);

interface ElementSpan {
  start: number;
  end: number;
}

interface OpenFrame {
  name: string;
  start: number;
  attrs: Record<string, string>;
}

/** @internal For unit tests. */
export function __parseManifestStructureForTests(
  xml: string
): ParsedManifestStructure {
  return _parseManifestStructure(xml);
}

export function patchAndroidManifestText(
  originalXml: string,
  cfg: ResolvedConfig
): string {
  const eol = originalXml.includes('\r\n') ? '\r\n' : '\n';
  const structure = _parseManifestStructure(originalXml);
  const applicationCloseStart =
    structure.applicationCloseStart ??
    originalXml.lastIndexOf('</application>');
  if (applicationCloseStart === -1) {
    throw new TransformError('AndroidManifest has no <application> element');
  }
  const launcherActivityName = _resolveLauncherActivityName(structure);
  const { childIndent, indentStep } = _detectApplicationIndentation(
    originalXml,
    applicationCloseStart,
    eol
  );

  const removals: ElementSpan[] = [];

  for (const filter of structure.launcherIntentFilters) {
    if (filter.activityName === launcherActivityName) {
      _assertRecognizedLauncherFilter(filter);
      removals.push(_spanWithLeadingWhitespace(originalXml, filter.span, eol));
    }
  }

  for (const alias of structure.markedActivityAliases) {
    removals.push(_spanWithLeadingWhitespace(originalXml, alias.span, eol));
  }

  removals.sort((a, b) => a.start - b.start);
  let insertAtAfterRemovals = -1;
  if (structure.markedActivityAliases.length > 0) {
    const firstAliasStart = structure.markedActivityAliases
      .map((alias) => alias.span.start)
      .sort((a, b) => a - b)[0];
    insertAtAfterRemovals = _mapIndexThroughRemovals(
      _lineStartBeforeIndex(originalXml, firstAliasStart, eol),
      removals
    );
  }

  removals.sort((a, b) => b.start - a.start);
  let xml = originalXml;
  for (const span of removals) {
    xml = xml.slice(0, span.start) + xml.slice(span.end);
  }

  const metaByName = new Map(
    _parseManifestStructure(xml).iconSwitcherMetaData.map((item) => [
      item.name,
      item.span,
    ])
  );
  const selfClosingStyle = _detectSelfClosingSuffix(originalXml);
  const metaLines = _applicationMetaLines(cfg, childIndent, selfClosingStyle);
  const metaReplacements: { start: number; end: number; text: string }[] = [];
  const missingMeta: string[] = [];
  for (const line of metaLines) {
    const nameMatch = line.match(/android:name="([^"]+)"/);
    const metaName = nameMatch?.[1];
    if (!metaName) {
      continue;
    }
    const existing = metaByName.get(metaName);
    if (existing) {
      const lineBounds = _fullLineBounds(
        xml,
        existing.start,
        existing.end,
        eol
      );
      const existingLine = xml.slice(lineBounds.start, lineBounds.end);
      const existingIndent = existingLine.match(/^(\s*)/)?.[1] ?? '';
      const lineToWrite = line.replace(/^\s+/, existingIndent);
      const existingBody = existingLine.trim();
      const nextBody = lineToWrite.trim();
      if (existingBody === nextBody) {
        continue;
      }
      metaReplacements.push({
        start: lineBounds.start,
        end: lineBounds.end,
        text: lineToWrite,
      });
    } else {
      missingMeta.push(line);
    }
  }
  metaReplacements.sort((a, b) => b.start - a.start);
  for (const replacement of metaReplacements) {
    xml =
      xml.slice(0, replacement.start) +
      replacement.text +
      xml.slice(replacement.end);
  }

  const applicationCloseIndex = xml.lastIndexOf('</application>');
  if (applicationCloseIndex === -1) {
    throw new TransformError('AndroidManifest has no <application> element');
  }

  const insertAt =
    insertAtAfterRemovals >= 0
      ? insertAtAfterRemovals
      : _lineStartBeforeIndex(xml, applicationCloseIndex, eol);

  const aliasXml = _renderActivityAliases(
    cfg,
    launcherActivityName,
    childIndent,
    indentStep,
    eol,
    selfClosingStyle
  );
  const insertBlock = _joinNonEmptyLines([...missingMeta, aliasXml], eol);

  const prefix = xml.slice(0, insertAt);
  const suffix = xml.slice(insertAt);
  const needsNl =
    insertBlock.length > 0 &&
    !prefix.endsWith('\n') &&
    !prefix.endsWith('\r\n');
  const joiner = needsNl ? eol : '';
  xml = `${prefix}${joiner}${insertBlock}${insertBlock ? eol : ''}${suffix}`;

  return xml;
}

interface LauncherFilterInfo {
  activityName: string;
  span: ElementSpan;
  actions: string[];
  categories: string[];
}

interface ParsedManifestStructure {
  applicationCloseStart: number | null;
  launcherIntentFilters: LauncherFilterInfo[];
  markedActivityAliases: { span: ElementSpan }[];
  iconSwitcherMetaData: { name: string; span: ElementSpan }[];
  activities: { name: string; hasLauncher: boolean }[];
  defaultAliasTarget: string | null;
}

function _parseManifestStructure(xml: string): ParsedManifestStructure {
  const parser = sax.parser(true, { xmlns: true, position: true, trim: false });
  const stack: OpenFrame[] = [];
  const launcherIntentFilters: LauncherFilterInfo[] = [];
  const markedActivityAliases: { span: ElementSpan }[] = [];
  const iconSwitcherMetaData: { name: string; span: ElementSpan }[] = [];
  const activities: { name: string; hasLauncher: boolean }[] = [];
  let currentActivity: string | null = null;
  let currentActivityHasLauncher = false;
  let currentAliasMarker: string | null = null;
  let defaultAliasTarget: string | null = null;
  let insideApplication = false;
  let currentFilter: { actions: string[]; categories: string[] } | null = null;

  parser.onopentag = (node) => {
    const attrs = _normalizeAttrs(node.attributes as Record<string, unknown>);
    const selfClosing = Boolean(
      (node as { isSelfClosing?: boolean }).isSelfClosing
    );
    const frame: OpenFrame = {
      name: node.name,
      start: _openTagStart(xml, parser.startTagPosition),
      attrs,
    };
    if (!selfClosing) {
      stack.push(frame);
    }

    if (node.name === 'application') {
      insideApplication = true;
    }
    if (insideApplication && node.name === 'activity') {
      currentActivity = attrs['android:name'] ?? null;
      currentActivityHasLauncher = false;
    }
    if (node.name === 'intent-filter') {
      const parent = stack[stack.length - 2];
      if (parent?.name === 'activity' && currentActivity) {
        currentFilter = { actions: [], categories: [] };
      }
    }
    if (node.name === 'action' && currentFilter) {
      const actionName = attrs['android:name'];
      if (actionName) {
        currentFilter.actions.push(actionName);
      }
    }
    if (node.name === 'category' && currentFilter) {
      const categoryName = attrs['android:name'];
      if (categoryName) {
        currentFilter.categories.push(categoryName);
      }
    }
    if (insideApplication && node.name === 'activity-alias') {
      currentAliasMarker = null;
      const aliasName = attrs['android:name'];
      const target = attrs['android:targetActivity'];
      if (aliasName === DEFAULT_ALIAS && target) {
        defaultAliasTarget = target;
      }
    }
    if (node.name === 'meta-data') {
      const parent = selfClosing
        ? stack[stack.length - 1]
        : stack[stack.length - 2];
      if (parent?.name === 'activity-alias') {
        const metaName = attrs['android:name'];
        if (metaName === ICONKIT_ICON_META) {
          currentAliasMarker = attrs['android:value'] ?? null;
        }
      }
      if (parent?.name === 'application' && selfClosing) {
        _recordApplicationMetaDataElement(
          frame,
          parser.position,
          iconSwitcherMetaData
        );
      }
    }

    if (
      selfClosing &&
      insideApplication &&
      node.name === 'activity' &&
      currentActivity
    ) {
      activities.push({
        name: currentActivity,
        hasLauncher: currentActivityHasLauncher,
      });
      currentActivity = null;
      currentActivityHasLauncher = false;
    }
  };

  parser.onclosetag = (name) => {
    const top = stack[stack.length - 1];
    if (!top || top.name !== name) {
      return;
    }
    const end = parser.position;
    const frame = stack.pop();
    if (!frame) {
      return;
    }
    const span: ElementSpan = { start: frame.start, end };

    if (name === 'intent-filter' && currentActivity && currentFilter) {
      const { actions, categories } = currentFilter;
      if (
        actions.includes(MAIN_ACTION) &&
        categories.includes(LAUNCHER_CATEGORY)
      ) {
        currentActivityHasLauncher = true;
        launcherIntentFilters.push({
          activityName: currentActivity,
          span,
          actions,
          categories,
        });
      }
      currentFilter = null;
    }

    if (name === 'activity') {
      if (currentActivity) {
        activities.push({
          name: currentActivity,
          hasLauncher: currentActivityHasLauncher,
        });
      }
      currentActivity = null;
    }

    if (name === 'activity-alias' && insideApplication) {
      if (currentAliasMarker !== null) {
        markedActivityAliases.push({ span });
      }
      currentAliasMarker = null;
    }

    if (
      name === 'meta-data' &&
      insideApplication &&
      stack[1]?.name === 'application'
    ) {
      _recordApplicationMetaDataElement(frame, end, iconSwitcherMetaData);
    }
  };

  parser.onerror = (error) => {
    throw error;
  };

  parser.write(xml).close();

  const closeIndex = xml.lastIndexOf('</application>');

  return {
    applicationCloseStart: closeIndex === -1 ? null : closeIndex,
    launcherIntentFilters,
    markedActivityAliases,
    iconSwitcherMetaData,
    activities,
    defaultAliasTarget,
  };
}

function _recordApplicationMetaDataElement(
  frame: OpenFrame,
  end: number,
  iconSwitcherMetaData: { name: string; span: ElementSpan }[]
): void {
  const metaName = frame.attrs['android:name'];
  if (
    metaName === ICONKIT_ICONS_META ||
    metaName === ICONKIT_APPLY_ON_META ||
    metaName === ICONKIT_SKIP_BRANDS_META
  ) {
    iconSwitcherMetaData.push({
      name: metaName,
      span: { start: frame.start, end },
    });
  }
}

function _openTagStart(xml: string, startTagPosition: number): number {
  let index = startTagPosition;
  while (index > 0 && xml[index] !== '<') {
    index -= 1;
  }
  return index;
}

function _normalizeAttrs(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') {
      out[key] = value;
      continue;
    }
    if (value && typeof value === 'object' && 'value' in value) {
      out[key] = String((value as { value: string }).value);
    }
  }
  return out;
}

function _resolveLauncherActivityName(
  structure: ParsedManifestStructure
): string {
  const withLauncher = structure.activities.find((a) => a.hasLauncher);
  if (withLauncher) {
    return withLauncher.name;
  }
  const main = structure.activities.find((a) => a.name === '.MainActivity');
  if (main) {
    return main.name;
  }
  if (structure.defaultAliasTarget) {
    return structure.defaultAliasTarget;
  }
  throw new TransformError(
    'Could not find launcher activity (no MAIN/LAUNCHER filter, .MainActivity, or default activity-alias)'
  );
}

function _assertRecognizedLauncherFilter(filter: LauncherFilterInfo): void {
  for (const action of filter.actions) {
    if (!RECOGNIZED_ACTIONS.has(action)) {
      throw new TransformError(
        `Unrecognized action in launcher intent-filter: ${action}`
      );
    }
  }
  for (const category of filter.categories) {
    if (!RECOGNIZED_CATEGORIES.has(category)) {
      throw new TransformError(
        `Unrecognized category in launcher intent-filter: ${category}`
      );
    }
  }
}

interface ApplicationIndentation {
  childIndent: string;
  indentStep: string;
}

function _detectApplicationIndentation(
  xml: string,
  applicationCloseStart: number,
  eol: string
): ApplicationIndentation {
  const applicationOpen = xml.indexOf('<application');
  if (applicationOpen === -1) {
    return { childIndent: '    ', indentStep: '  ' };
  }
  const applicationLineStart = _lineStartBeforeIndex(xml, applicationOpen, eol);
  const lineBreak = xml.indexOf(eol, applicationOpen);
  const applicationLine = xml.slice(
    applicationLineStart,
    lineBreak === -1 ? xml.length : lineBreak
  );
  const applicationIndent = applicationLine.match(/^(\s*)/)?.[1] ?? '';

  const section = xml.slice(applicationOpen, applicationCloseStart);
  const childMatch = section.match(
    /\n(\s+)<(?:activity|activity-alias|meta-data|service|receiver|provider)\b/
  );
  const childIndent = childMatch?.[1] ?? '    ';

  const nestedMatch = section.match(/\n(\s+)<(?:intent-filter|meta-data)\b/);
  let indentStep = '  ';
  if (nestedMatch?.[1] && nestedMatch[1].startsWith(childIndent)) {
    indentStep = nestedMatch[1].slice(childIndent.length);
  } else if (childIndent.length > applicationIndent.length) {
    indentStep = childIndent.slice(applicationIndent.length);
  } else if (childIndent.length >= 2) {
    indentStep = childIndent.slice(0, childIndent.length / 2);
  }

  if (!indentStep) {
    indentStep = childIndent.length >= 2 ? childIndent.slice(0, 2) : '  ';
  }

  return { childIndent, indentStep };
}

/** @internal For branch coverage in unit tests. */
export const __androidTextTesting = {
  mapIndexThroughRemovals: _mapIndexThroughRemovals,
  selfClosingForAttributeValue: _selfClosingForAttributeValue,
  detectSelfClosingSuffix: _detectSelfClosingSuffix,
  joinNonEmptyLines: _joinNonEmptyLines,
};

/** @internal For unit tests. */
export function __detectApplicationIndentationForTests(
  xml: string,
  applicationCloseStart: number,
  eol: string = '\n'
): ApplicationIndentation {
  return _detectApplicationIndentation(xml, applicationCloseStart, eol);
}

function _lineStartBeforeIndex(
  xml: string,
  index: number,
  eol: string
): number {
  if (index < 0) {
    return -1;
  }
  const lineStart = xml.lastIndexOf(eol, index - 1);
  return lineStart === -1 ? 0 : lineStart + eol.length;
}

function _joinNonEmptyLines(lines: string[], eol: string): string {
  return lines
    .flatMap((block) => block.split(eol))
    .filter((line) => line.trim() !== '')
    .join(eol);
}

function _mapIndexThroughRemovals(
  index: number,
  removals: ElementSpan[]
): number {
  let adjusted = index;
  for (const span of removals) {
    if (span.start < index) {
      adjusted -= span.end - span.start;
    }
  }
  return adjusted;
}

function _detectSelfClosingSuffix(xml: string): string {
  const compact = /[^ ]"\/>/.test(xml);
  const spaced = /" \/>/.test(xml);
  if (compact && !spaced) {
    return '/>';
  }
  return ' />';
}

function _selfClosingForAttributeValue(value: string, style: string): string {
  if (value === '' && style === '/>') {
    return ' />';
  }
  return style;
}

function _fullLineBounds(
  xml: string,
  elementStart: number,
  elementEnd: number,
  eol: string
): ElementSpan {
  let start = elementStart;
  const lineStart = xml.lastIndexOf(eol, start - 1);
  if (lineStart !== -1) {
    const prefix = xml.slice(lineStart + eol.length, start);
    if (/^\s*$/.test(prefix)) {
      start = lineStart + eol.length;
    }
  }
  let end = elementEnd;
  const lineEnd = xml.indexOf(eol, end);
  if (lineEnd !== -1) {
    end = lineEnd;
  }
  return { start, end };
}

function _spanWithLeadingWhitespace(
  xml: string,
  span: ElementSpan,
  eol: string
): ElementSpan {
  let start = span.start;
  const lineStart = xml.lastIndexOf(eol, start - 1);
  if (lineStart !== -1) {
    const linePrefix = xml.slice(lineStart + eol.length, start);
    if (/^\s*$/.test(linePrefix)) {
      start = lineStart + eol.length;
    }
  }
  let end = span.end;
  if (xml.slice(end, end + eol.length) === eol) {
    end += eol.length;
  }
  return { start, end };
}

function _configuredAndroidIconNames(cfg: ResolvedConfig): string[] {
  return cfg.icons
    .filter((icon) => icon.isDefault || icon.android !== null)
    .map((icon) => icon.name);
}

function _applicationMetaLines(
  cfg: ResolvedConfig,
  indent: string,
  selfClosing: string
): string[] {
  const iconsValue = _configuredAndroidIconNames(cfg).join(',');
  const skipBrands = cfg.android.skipBrands.join(',');
  return [
    `${indent}<meta-data android:name="${ICONS_META}" android:value="${iconsValue}"${_selfClosingForAttributeValue(iconsValue, selfClosing)}`,
    `${indent}<meta-data android:name="${ICONS_APPLY_ON_META}" android:value="${cfg.android.applyOn}"${_selfClosingForAttributeValue(cfg.android.applyOn, selfClosing)}`,
    `${indent}<meta-data android:name="${ICONS_SKIP_BRANDS_META}" android:value="${skipBrands}"${_selfClosingForAttributeValue(skipBrands, selfClosing)}`,
  ];
}

const ICONS_META = ICONKIT_ICONS_META;
const ICONS_APPLY_ON_META = ICONKIT_APPLY_ON_META;
const ICONS_SKIP_BRANDS_META = ICONKIT_SKIP_BRANDS_META;

function _renderActivityAliases(
  cfg: ResolvedConfig,
  launcherActivityName: string,
  childIndent: string,
  indentStep: string,
  eol: string,
  selfClosing: string
): string {
  const blocks: string[] = [];
  for (const icon of cfg.icons) {
    if (!icon.isDefault && icon.android === null) {
      continue;
    }
    blocks.push(
      _renderSingleActivityAlias(
        icon.name,
        cfg,
        launcherActivityName,
        childIndent,
        indentStep,
        eol,
        selfClosing
      )
    );
  }
  return blocks.join(eol);
}

function _renderSingleActivityAlias(
  iconName: string,
  cfg: ResolvedConfig,
  launcherActivityName: string,
  childIndent: string,
  indentStep: string,
  eol: string,
  selfClosing: string
): string {
  const icon = cfg.icons.find((item) => item.name === iconName);
  const isDefault = icon?.isDefault ?? iconName === 'default';
  const { icon: iconRef, roundIcon } = _mipmapRefs(iconName, isDefault);
  const enabled = isDefault ? 'true' : 'false';
  const aliasName = `.IconSwitcher_${iconName}`;
  const inner = childIndent + indentStep;
  const deepest = inner + indentStep;
  return [
    `${childIndent}<activity-alias android:name="${aliasName}" android:targetActivity="${launcherActivityName}" android:exported="true" android:enabled="${enabled}" android:icon="${iconRef}" android:roundIcon="${roundIcon}">`,
    `${inner}<intent-filter>`,
    `${deepest}<action android:name="${MAIN_ACTION}"${selfClosing}`,
    `${deepest}<category android:name="${LAUNCHER_CATEGORY}"${selfClosing}`,
    `${inner}</intent-filter>`,
    `${inner}<meta-data android:name="${ICONS_META_ICON}" android:value="${iconName}"${_selfClosingForAttributeValue(iconName, selfClosing)}`,
    `${childIndent}</activity-alias>`,
  ].join(eol);
}

const ICONS_META_ICON = ICONKIT_ICON_META;

function _mipmapRefs(
  iconName: string,
  isDefault: boolean
): { icon: string; roundIcon: string } {
  if (isDefault) {
    return {
      icon: '@mipmap/ic_launcher',
      roundIcon: '@mipmap/ic_launcher_round',
    };
  }
  return {
    icon: `@mipmap/ic_launcher_${iconName}`,
    roundIcon: `@mipmap/ic_launcher_${iconName}_round`,
  };
}
