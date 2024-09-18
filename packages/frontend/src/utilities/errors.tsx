// This function allows an exception to be thrown with the ?? operator, as follows: const x = condition ?? doThrow(new Error("Error"))
export function doThrow(error: Error): never {
  throw error;
}

export class CustomError extends Error {
  public constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    // See https://stackoverflow.com/a/48342359/435463
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends CustomError {
  public constructor(key: { toString(): string }, context?: string) {
    super(context === undefined ? `The item '${key.toString()}' was not found` : `The item '${key.toString()}' was not found in '${context}'`);
  }
}

export class NullishError extends CustomError {
  public constructor(itemName: string) {
    super(`'${itemName}' was nullish`);
  }
}

export class UnhandledEnumValueError extends CustomError {
  public constructor(enumValue: string) {
    super(`Unhandled enum value '${enumValue}'`);
  }
}

export class AssertionError extends CustomError {
  public constructor(message?: string) {
    super(message ?? "Assertion failed");
  }
}

export function assert(condition: boolean, message?: string): asserts condition {
  if (!condition) {
    throw new AssertionError(message);
  }
}
