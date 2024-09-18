import { useCallback, useLayoutEffect, useRef } from "react";

// This is a temporary implementation of https://github.com/reactjs/rfcs/pull/220. The final version hasn't been released yet.
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function useEvent<T extends Function>(callback: T): T {
  const callbackRef = useRef(callback);

  useLayoutEffect(
    () => {
      callbackRef.current = callback;
    },
    [callback]);

  const callbackUntyped = useCallback(
    (...args: unknown[]) => {
      const latestCallbackUntyped = callbackRef.current as unknown as (...argsInner: unknown[]) => unknown;
      return latestCallbackUntyped(...args);
    },
    []);

  return callbackUntyped as unknown as T;
}
