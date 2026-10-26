'use strict';

/**
 * Jest mock for `react-native-icon-switcher`.
 *
 *   jest.mock(
 *     'react-native-icon-switcher',
 *     () => require('react-native-icon-switcher/jest')
 *   );
 */

class IconSwitcherError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = 'IconSwitcherError';
    this.code = code;
  }
}

function defaultState() {
  return {
    isSupported: true,
    iconNames: ['default', 'halloween'],
    current: 'default',
    setImpl: async () => ({ status: 'applied' }),
    applyPendingImpl: async () => ({ status: 'none' }),
  };
}

let state = defaultState();

function __setState(partial) {
  state = { ...state, ...partial };
}

function __reset() {
  state = defaultState();
}

function _assertKnownIcon(name) {
  if (!state.iconNames.includes(name)) {
    throw new IconSwitcherError('unknown_icon', `Unknown icon: ${name}`);
  }
}

const IconSwitcher = {
  get isSupported() {
    return state.isSupported;
  },

  list() {
    return [...state.iconNames];
  },

  async getCurrent() {
    if (!state.isSupported) {
      throw new IconSwitcherError(
        'unsupported',
        'Alternate app icons are not supported'
      );
    }
    return state.current;
  },

  async set(name) {
    if (!state.isSupported) {
      throw new IconSwitcherError(
        'unsupported',
        'Alternate app icons are not supported'
      );
    }
    _assertKnownIcon(name);
    return state.setImpl(name);
  },

  async reset() {
    return IconSwitcher.set('default');
  },

  async applyPending() {
    if (!state.isSupported) {
      throw new IconSwitcherError(
        'unsupported',
        'Alternate app icons are not supported'
      );
    }
    return state.applyPendingImpl();
  },
};

module.exports = {
  __esModule: true,
  default: IconSwitcher,
  IconSwitcher,
  IconSwitcherError,
  __setState,
  __reset,
};
