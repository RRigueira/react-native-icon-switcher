export class TransformError extends Error {
  readonly name = 'TransformError';

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
