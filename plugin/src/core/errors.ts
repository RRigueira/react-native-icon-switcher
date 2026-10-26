export class ConfigError extends Error {
  readonly name = 'ConfigError';

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
