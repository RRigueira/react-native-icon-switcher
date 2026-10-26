/** Augment via `declare module 'react-native-icon-switcher' { interface Register { icons: ... } }`. */
export interface Register {}

export type IconName = Register extends { icons: infer T } ? T : string;
