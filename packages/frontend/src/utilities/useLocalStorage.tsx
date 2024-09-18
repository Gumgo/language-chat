import * as React from "react";

export function useLocalStorageState<Type extends { toString: () => string }>(
  key: string,
  parse: (value: string) => Type | undefined,
  initialValue: Type | (() => Type)): [Type, (value: Type) => void] {
  const [value, setValue] = React.useState(
    () => {
      const storageValue = localStorage.getItem(key);
      if (storageValue !== null) {
        const parsedValue = parse(storageValue);
        if (parsedValue !== undefined) {
          return parsedValue;
        }
      }

      return typeof initialValue === "function" ? initialValue() : initialValue;
    });

  const setValueWrapper = React.useCallback(
    (newState: Type | ((prevState: Type) => Type)) => {
      if (typeof newState === "function") {
        setValue(
          (prevState) => {
            const newStateInner = newState(prevState);
            localStorage.setItem(key, newState.toString());
            return newStateInner;
          });
      } else {
        setValue(newState);
        localStorage.setItem(key, newState.toString());
      }
    },
    []);

  return [value, setValueWrapper];
}