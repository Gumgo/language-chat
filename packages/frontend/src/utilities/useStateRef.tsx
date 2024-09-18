import { useRef, useState } from "react";

export interface ImmutableRefObject<Type> {
  readonly current: Type;
}

// Combines useState() and useRef() - state refers to the state and current refers to the most recently set value
export function useStateRef<Type>(initialValue: Type | (() => Type)): [Type, ImmutableRefObject<Type>, (value: Type) => void] {
  const [state, setState] = useState(initialValue);
  const ref = useRef(state);

  function setStateRef(value: Type): void {
    ref.current = value;
    setState(value);
  }

  return [state, ref, setStateRef];
}
