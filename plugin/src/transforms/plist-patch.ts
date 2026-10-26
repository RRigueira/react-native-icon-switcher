import { isDeepStrictEqual } from 'node:util';

import plist from '@expo/plist';

import type { ResolvedConfig } from '../types';
import { _isLegacy01PrimaryIconBundle, applyInfoPlist } from './ios';

export function patchInfoPlistText(
  originalXml: string,
  cfg: ResolvedConfig
): string {
  const parsed = plist.parse(originalXml) as Record<string, unknown>;
  const next = applyInfoPlist(parsed, cfg);
  if (isDeepStrictEqual(parsed, next)) {
    return originalXml;
  }

  const eol = _detectEol(originalXml);
  const { keyIndent, indentStep } = _detectPlistIndentation(originalXml, eol);
  const icons = next.IconSwitcherIcons as string[];

  let xml = originalXml;
  let changed = false;

  if (_isLegacy01PrimaryIconBundle(parsed.CFBundleIcons)) {
    const removed = _removePlistKeyBlock(xml, 'CFBundleIcons', eol);
    if (removed !== xml) {
      xml = removed;
      changed = true;
    }
  }
  if (_isLegacy01PrimaryIconBundle(parsed['CFBundleIcons~ipad'])) {
    const removed = _removePlistKeyBlock(xml, 'CFBundleIcons~ipad', eol);
    if (removed !== xml) {
      xml = removed;
      changed = true;
    }
  }

  if (xml.includes('<key>IconSwitcherIcons</key>')) {
    const existingIcons = _readIconSwitcherIconsFromText(xml);
    if (isDeepStrictEqual(existingIcons, icons)) {
      const result = changed ? xml : originalXml;
      return _collapseBlankLinesBeforeDictClose(result, eol);
    }
    const iconsBlock = _renderIconSwitcherIcons(
      icons,
      keyIndent,
      indentStep,
      eol,
      _iconSwitcherArrayItemIndent(xml, eol)
    );
    xml = _replacePlistKeyValue(xml, 'IconSwitcherIcons', iconsBlock, eol);
    return _collapseBlankLinesBeforeDictClose(xml, eol);
  }

  const iconsBlock = _renderIconSwitcherIcons(
    icons,
    keyIndent,
    indentStep,
    eol
  );
  xml = _insertBeforeRootDictClose(xml, iconsBlock, keyIndent, eol);
  return _collapseBlankLinesBeforeDictClose(xml, eol);
}

interface PlistIndentation {
  keyIndent: string;
  indentStep: string;
}

function _detectEol(xml: string): string {
  return xml.includes('\r\n') ? '\r\n' : '\n';
}

function _detectPlistIndentation(xml: string, eol: string): PlistIndentation {
  const arrayItemIndent = _iconSwitcherArrayItemIndent(xml, eol);
  const keyMatch = xml.match(new RegExp(`${eol}( +)<key>[^<]+</key>`));
  const tabKeyMatch = xml.match(new RegExp(`${eol}(\\t+)<key>[^<]+</key>`));
  const keyIndent = keyMatch?.[1] ?? tabKeyMatch?.[1] ?? '\t';

  const arrayStepMatch = xml.match(
    new RegExp(`${eol}( +)<array>${eol}( +)<string>`, 'm')
  );
  const tabArrayStepMatch = xml.match(
    new RegExp(`${eol}(\\t+)<array>${eol}(\\t+)<string>`, 'm')
  );
  let indentStep = '\t';
  if (arrayStepMatch) {
    const arrayIndent = arrayStepMatch[1];
    const stringIndent = arrayStepMatch[2];
    if (stringIndent.startsWith(arrayIndent)) {
      indentStep = stringIndent.slice(arrayIndent.length);
    }
  } else if (tabArrayStepMatch) {
    const arrayIndent = tabArrayStepMatch[1];
    const stringIndent = tabArrayStepMatch[2];
    if (stringIndent.startsWith(arrayIndent)) {
      indentStep = stringIndent.slice(arrayIndent.length);
    }
  } else if (arrayItemIndent && arrayItemIndent.startsWith(keyIndent)) {
    indentStep = arrayItemIndent.slice(keyIndent.length);
  } else if (keyIndent.length >= 2 && !keyIndent.includes('\t')) {
    indentStep = keyIndent.slice(0, 2);
  }

  if (!indentStep) {
    indentStep = keyIndent.includes('\t') ? '\t' : '  ';
  }

  return { keyIndent, indentStep };
}

function _iconSwitcherArrayItemIndent(xml: string, eol: string): string | null {
  const keyTag = '<key>IconSwitcherIcons</key>';
  const start = xml.indexOf(keyTag);
  if (start === -1) {
    return null;
  }
  const arrayStart = xml.indexOf('<array>', start);
  if (arrayStart === -1) {
    return null;
  }
  const stringStart = xml.indexOf('<string>', arrayStart);
  if (stringStart === -1) {
    return null;
  }
  const lineStart = _lineStartBeforeIndex(xml, stringStart, eol);
  const indent = xml.slice(lineStart, stringStart);
  return /^\s*$/.test(indent) ? indent : null;
}

function _readIconSwitcherIconsFromText(xml: string): string[] {
  const keyTag = '<key>IconSwitcherIcons</key>';
  const start = xml.indexOf(keyTag);
  if (start === -1) {
    return [];
  }
  const arrayStart = xml.indexOf('<array>', start);
  if (arrayStart === -1) {
    return [];
  }
  const arrayEnd = _findBalancedTagEnd(xml, arrayStart, 'array');
  const block = xml.slice(arrayStart, arrayEnd);
  const names: string[] = [];
  const re = /<string>([^<]*)<\/string>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(block)) !== null) {
    names.push(match[1] ?? '');
  }
  return names;
}

function _renderIconSwitcherIcons(
  names: string[],
  keyIndent: string,
  indentStep: string,
  eol: string,
  arrayItemIndent?: string | null
): string {
  const itemIndent = arrayItemIndent ?? `${keyIndent}${indentStep}`;
  const lines = [
    `${keyIndent}<key>IconSwitcherIcons</key>`,
    `${keyIndent}<array>`,
    ...names.map((name) => `${itemIndent}<string>${name}</string>`),
    `${keyIndent}</array>`,
  ];
  return lines.join(eol);
}

function _lineStartBeforeIndex(
  xml: string,
  index: number,
  eol: string
): number {
  if (index <= 0) {
    return 0;
  }
  const lineStart = xml.lastIndexOf(eol, index - 1);
  return lineStart === -1 ? 0 : lineStart + eol.length;
}

function _removePlistKeyBlock(xml: string, key: string, eol: string): string {
  const keyTag = `<key>${key}</key>`;
  const start = xml.indexOf(keyTag);
  if (start === -1) {
    return xml;
  }
  const afterKey = start + keyTag.length;
  const dictStart = xml.indexOf('<dict>', afterKey);
  if (dictStart === -1) {
    return xml;
  }
  let depth = 0;
  let i = dictStart;
  while (i < xml.length) {
    if (xml.startsWith('<dict>', i)) {
      depth += 1;
      i += 6;
      continue;
    }
    if (xml.startsWith('</dict>', i)) {
      depth -= 1;
      i += 7;
      if (depth === 0) {
        const end = i;
        let removeStart = _lineStartBeforeIndex(xml, start, eol);
        let result = xml.slice(0, removeStart) + xml.slice(end);
        result = _collapseBlankLinesBeforeDictClose(result, eol);
        return result;
      }
      continue;
    }
    i += 1;
  }
  return xml;
}

function _collapseBlankLinesBeforeDictClose(xml: string, eol: string): string {
  const escaped = eol.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
  const repeated = new RegExp(
    `(${escaped}[ \\t]*){2,}(?=${escaped}[ \\t]*</dict>${escaped}</plist>)`,
    'g'
  );
  let result = xml.replace(repeated, eol);
  const singleBlank = new RegExp(
    `${escaped}[ \\t]*(?=${escaped}[ \\t]*</dict>${escaped}</plist>)`,
    'g'
  );
  result = result.replace(singleBlank, '');
  return result;
}

function _replacePlistKeyValue(
  xml: string,
  key: string,
  replacementBlock: string,
  eol: string
): string {
  const keyTag = `<key>${key}</key>`;
  const start = xml.indexOf(keyTag);
  if (start === -1) {
    return xml;
  }
  const lineStart = _lineStartBeforeIndex(xml, start, eol);
  const afterKey = start + keyTag.length;
  const valueStart = xml.indexOf('<', afterKey);
  if (valueStart === -1) {
    return xml;
  }
  const valueEnd = _findBalancedTagEnd(xml, valueStart, 'array');
  return xml.slice(0, lineStart) + replacementBlock + xml.slice(valueEnd);
}

function _findBalancedTagEnd(
  xml: string,
  openIndex: number,
  tag: string
): number {
  let depth = 0;
  let i = openIndex;
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  while (i < xml.length) {
    if (xml.startsWith(open, i)) {
      depth += 1;
      i += open.length;
      continue;
    }
    if (xml.startsWith(close, i)) {
      depth -= 1;
      i += close.length;
      if (depth === 0) {
        return i;
      }
      continue;
    }
    i += 1;
  }
  return xml.length;
}

function _insertBeforeRootDictClose(
  xml: string,
  block: string,
  _indent: string,
  eol: string
): string {
  const plistClose = xml.lastIndexOf('</plist>');
  if (plistClose === -1) {
    return xml;
  }
  const beforePlist = xml.slice(0, plistClose).trimEnd();
  const dictClose = beforePlist.lastIndexOf('</dict>');
  if (dictClose === -1) {
    return xml;
  }
  const prefix = xml.slice(0, dictClose);
  const suffix = xml.slice(dictClose);
  const needsNl = !prefix.endsWith('\n') && !prefix.endsWith('\r\n');
  const joiner = needsNl ? eol : '';
  return `${prefix}${joiner}${block}${eol}${suffix}`;
}

/** @internal For branch coverage in unit tests. */
export const __plistPatchTesting = {
  removePlistKeyBlock: _removePlistKeyBlock,
  detectPlistIndentation: _detectPlistIndentation,
  detectEol: _detectEol,
  insertBeforeRootDictClose: _insertBeforeRootDictClose,
  replacePlistKeyValue: _replacePlistKeyValue,
  readIconSwitcherIconsFromText: _readIconSwitcherIconsFromText,
  collapseBlankLinesBeforeDictClose: _collapseBlankLinesBeforeDictClose,
  iconSwitcherArrayItemIndent: _iconSwitcherArrayItemIndent,
};
