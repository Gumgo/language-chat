import * as React from "react";
import { ImmutableRefObject } from "utilities/useStateRef";

export function useIsMounted(): ImmutableRefObject<boolean> {
  const isMounted = React.useRef(true);

  React.useEffect(
    () => () => {
      isMounted.current = false;
    },
    []);

  return isMounted;
}