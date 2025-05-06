import { NotFoundError } from "utilities/errors";

export type TimeoutHandle = ReturnType<typeof setTimeout>;
export type IntervalHandle = ReturnType<typeof setInterval>;

export function nullOr<TIn, TOut>(value: TIn | null | undefined, func: (value: TIn) => TOut): TOut | null {
  return value === null || value === undefined
    ? null
    : func(value);
}

export function undefinedOr<TIn, TOut>(value: TIn | null | undefined, func: (value: TIn) => TOut): TOut | undefined {
  return value === null || value === undefined
    ? undefined
    : func(value);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function *iterateWithIndex<T>(iterable: Iterable<T>): Iterable<[T, number]> {
  let i = 0;
  for (const v of iterable) {
    yield [v, i];
    i++;
  }
}

export function classNames(...values: (string | null | undefined | false)[]): string {
  return values.filter((v) => typeof v === "string").join(" ");
}

export function buildCompleteMapping<TKey extends { toString(): string }, TValue>(
  context: string,
  expectedKeys: TKey[],
  mappings: [TKey, TValue][]): ReadonlyMap<TKey, TValue> {
  const map = new Map<TKey, TValue>(mappings);
  for (const key of expectedKeys) {
    if (!map.has(key)) {
      throw new Error(`A mapping for the key '${key.toString()}' was not found when building mappings for ${context}`);
    }
  }

  for (const key of map.keys()) {
    if (!expectedKeys.includes(key)) {
      throw new Error(`An unexpected mapping for the key '${key.toString()}' was provided when building mappings for ${context}`);
    }
  }

  return map;
}

export function buildCompleteMappingGetter<TKey extends { toString(): string }, TValue>(
  context: string,
  expectedKeys: TKey[],
  mappings: [TKey, TValue][]): (key: TKey) => TValue {
  const map = buildCompleteMapping<TKey, TValue>(context, expectedKeys, mappings);

  function getValue(key: TKey): TValue {
    const result = map.get(key);
    if (result === undefined) { // Do an explicit "undefined" check because null map be a legitimate mapped value
      throw new NotFoundError(key, context);
    }

    return result;
  }

  return getValue;
}

export function sleep(durationMilliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), durationMilliseconds));
}