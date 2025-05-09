import * as React from "react";
import { assert } from "utilities/errors";
import { useRefLazy } from "utilities/useRefLazy";
import { ImmutableRefObject } from "utilities/useStateRef";

export interface RepeatableActionData<T> {
  // Call this when the action occurs
  handleAction: (data: T) => void;

  // Call this when the action can no longer occur - resolves actionPromise with null
  handleStopAction: () => void;

  // Await this to detect the action
  actionPromise: ImmutableRefObject<Promise<T | null>>;

  // Number of times the action has occurred
  actionCount: ImmutableRefObject<number>;
}

export function useRepeatableAction<T = unknown>(): RepeatableActionData<T> {
  // Note: null signifies stop
  interface ActionPromiseData {
    promise: Promise<T | null>;
    resolve: (result: T | null) => void;
  }

  function createActionPromise(): ActionPromiseData {
    let resolve: ((result: T | null) => void) | null = null;
    const promise = new Promise<T | null>((resolveInner) => { resolve = resolveInner; });

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    assert(resolve !== null);
    return { promise, resolve };
  }

  const actionPromiseData = useRefLazy<ActionPromiseData>(() => createActionPromise());
  const actionPromise = React.useRef(actionPromiseData.current.promise);
  const actionCount = React.useRef(0);

  const handleAction = React.useCallback(
    (gesture: T) => {
      actionCount.current++;
      actionPromiseData.current.resolve(gesture);
      actionPromiseData.current = createActionPromise();
      actionPromise.current = actionPromiseData.current.promise;
    },
    []);

  const handleStopAction = React.useCallback(
    () => {
      actionPromiseData.current.resolve(null);
      actionPromiseData.current = createActionPromise();
      actionPromise.current = actionPromiseData.current.promise;
    },
    []);

  return { handleAction, handleStopAction, actionPromise, actionCount };
}