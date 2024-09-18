// Use these functions for logging which should stick around permanently. For temporary logging when debugging, use console.log() and related functions.

export function logInfo(message: unknown): void {
  console.log(message);
}

export function logWarning(message: unknown): void {
  console.warn(message);
}

export function logError(message: unknown): void {
  console.error(message);
}
