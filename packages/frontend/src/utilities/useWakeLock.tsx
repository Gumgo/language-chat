import React from "react";

export function useWakeLock(): void {
  const wakeLockPromise = React.useRef<Promise<WakeLockSentinel> | null>(null);

  const acquireWakeLock = React.useCallback(
    async () => {
      if (wakeLockPromise.current !== null) {
        return;
      }

      const currentWakeLockPromise = navigator.wakeLock.request("screen");
      wakeLockPromise.current = currentWakeLockPromise;
      try {
        const wakeLock = await currentWakeLockPromise;
        wakeLock.addEventListener(
          "release",
          () => {
            // Clear out the wake lock promise only if it hasn't changed
            if (wakeLockPromise.current === currentWakeLockPromise) {
              wakeLockPromise.current = null;
            }
          });
      } catch {
        // We can't acquire a wake lock on the current device or in its current state so just ignore the error
      }
    },
    []);

  const releaseWakeLock = React.useCallback(
    async () => {
      const currentWakeLockPromise = wakeLockPromise.current;
      if (currentWakeLockPromise === null) {
        return;
      }

      wakeLockPromise.current = null;
      try {
        const wakeLock = await currentWakeLockPromise;
        await wakeLock.release();
      } catch {
        // On failure, there's nothing to do
      }
    },
    []);

  const handleVisibilityChange = React.useCallback(
    () => {
      if (document.visibilityState === "visible") {
        void acquireWakeLock();
      }
    },
    []);

  React.useEffect(
    () => {
      void acquireWakeLock();
      document.addEventListener("visibilitychange", handleVisibilityChange);
      return () => {
        void releaseWakeLock();
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      };
    },
    []);
}