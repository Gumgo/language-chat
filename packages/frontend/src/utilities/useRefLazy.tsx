import { MutableRefObject, useState } from "react";

export function useRefLazy<Type>(initialValue: () => Type): MutableRefObject<Type> {
  return useState<MutableRefObject<Type>>(() => ({ current: initialValue() }))[0];
}
