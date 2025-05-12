import * as React from "react";
import { createPortal } from "react-dom";
import { useEvent } from "utilities/useEvent";
import { useRepeatableAction } from "utilities/useRepeatableAction";
import { ImmutableRefObject } from "utilities/useStateRef";
import { useWakeLock } from "utilities/useWakeLock";
import { classNames } from "utilities/utilities";

export type Gesture =
  | "Tap"
  | "SwipeLeft"
  | "SwipeRight"
  | "SwipeUp"
  | "SwipeDown"
  | "SpinClockwise"
  | "SpinCounterClockwise";

interface TrackedGesture {
  pointerId: number;
  points: DOMPoint[];
}

function detectTapGesture(points: DOMPoint[]): Gesture | null {
  const maxTapRadius = 5;

  for (const point of points) {
    const dx = point.x - points[0].x;
    const dy = point.y - points[0].y;
    if (dx * dx + dy * dy > maxTapRadius * maxTapRadius) {
      return null;
    }
  }

  return "Tap";
}

function detectLineGesture(points: DOMPoint[]): Gesture | null {
  const startPoint = points[0];
  const endPoint = points[points.length - 1];

  // First, detect swipe gestures, which should be straight lines
  const minLineLength = 50;
  const maxLineDeviationRatio = 0.25;
  const lineDx = endPoint.x - startPoint.x;
  const lineDy = endPoint.y - startPoint.y;
  if (lineDx === 0 && lineDy === 0) {
    return null;
  }

  const lineLength = Math.sqrt(lineDx * lineDx + lineDy * lineDy);
  if (lineLength < minLineLength) {
    return null;
  }

  const normalizedLineDx = lineDx / lineLength;
  const normalizedLineDy = lineDy / lineLength;
  let lastProjectedPosition = 0;
  for (const point of points) {
    const pointDx = point.x - startPoint.x;
    const pointDy = point.y - startPoint.y;

    // Project onto line
    const projectedPosition = normalizedLineDx * pointDx + normalizedLineDy * pointDy;
    if (projectedPosition < lastProjectedPosition) {
      return null;
    }

    // Project onto perpendicular line
    const perpendicularProjectedPosition = normalizedLineDy * pointDx - normalizedLineDx * pointDy;
    if (Math.abs(perpendicularProjectedPosition) > lineLength * maxLineDeviationRatio) {
      return null;
    }

    lastProjectedPosition = projectedPosition;
  }

  const lineAngle = Math.atan2(lineDy, lineDx);
  const angleThreshold = 30 * Math.PI / 180;
  if (lineAngle >= -angleThreshold && lineAngle < angleThreshold) {
    return "SwipeRight";
  } else if (lineAngle >= Math.PI * 0.5 - angleThreshold && lineAngle < Math.PI * 0.5 + angleThreshold) {
    return "SwipeDown";
  } else if (lineAngle >= Math.PI - angleThreshold || lineAngle < -Math.PI + angleThreshold) {
    return "SwipeLeft";
  } else if (lineAngle >= -Math.PI * 0.5 - angleThreshold && lineAngle < -Math.PI * 0.5 + angleThreshold) {
    return "SwipeUp";
  }

  return null;
}

function detectCircleGesture(points: DOMPoint[]): Gesture | null {
  const minCircleRadius = 25;
  const maxCircleRadiusRatio = 3;

  // If the gesture wasn't a line, detect circles. First, estimate the center of the circle.
  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxX = Math.max(...points.map((p) => p.x));
  const maxY = Math.max(...points.map((p) => p.y));
  const circleCenterX = (minX + maxX) * 0.5;
  const circleCenterY = (minY + maxY) * 0.5;

  let actualMinRadius = Number.MAX_VALUE;
  let actualMaxRadius = Number.MIN_VALUE;
  let lastAngle: number | null = null;
  let totalAngleDelta = 0;
  let gesture: Gesture | null = null;
  for (const point of points) {
    const pointDx = point.x - circleCenterX;
    const pointDy = point.y - circleCenterY;
    if (pointDx === 0 && pointDy === 0) {
      return null;
    }

    const radius = Math.sqrt(pointDx * pointDx + pointDy * pointDy);
    actualMinRadius = Math.min(actualMinRadius, radius);
    actualMaxRadius = Math.max(actualMaxRadius, radius);

    const angle = Math.atan2(pointDy, pointDx);
    if (lastAngle !== null) {
      let angleDelta = angle - lastAngle;
      if (angleDelta < -Math.PI) {
        angleDelta += Math.PI * 2;
      } else if (angleDelta >= Math.PI) {
        angleDelta -= Math.PI * 2;
      }

      if (angleDelta !== 0) {
        const newGesture: Gesture = angleDelta > 0 ? "SpinClockwise" : "SpinCounterClockwise";
        if (gesture === null) {
          gesture = newGesture;
        } else if (gesture !== newGesture) {
          return null;
        }
      }

      totalAngleDelta += angleDelta;
    }

    lastAngle = angle;
  }

  if (Math.abs(totalAngleDelta) < Math.PI * 1.5 || actualMinRadius < minCircleRadius || actualMaxRadius > actualMinRadius * maxCircleRadiusRatio) {
    return null;
  }

  return gesture;
}

function detectGesture(trackedGesture: TrackedGesture): Gesture | null {
  return detectTapGesture(trackedGesture.points) ?? detectLineGesture(trackedGesture.points) ?? detectCircleGesture(trackedGesture.points);
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface GestureScreenBottomControlsProps {
}

export function GestureScreenBottomControls(props: React.PropsWithChildren<GestureScreenBottomControlsProps>): React.JSX.Element {
  return (
    <div className="bottom-controls">
      {props.children}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface GestureScreenGestureAreaContentProps {
}

export function GestureScreenGestureAreaContent(props: React.PropsWithChildren<GestureScreenGestureAreaContentProps>): React.JSX.Element {
  return (
    <div className="gesture-area-content">
      {props.children}
    </div>
  );
}

interface GestureScreenProps {
  overlay?: boolean;
  onDetectGesture: (gesture: Gesture) => void;
  message: string;
}

export function GestureScreen(props: React.PropsWithChildren<GestureScreenProps>): React.JSX.Element {
  const children = React.Children.toArray(props.children);
  const bottomControlsChild = children.find(
    (child) => React.isValidElement(child) && typeof child.type === "function" && child.type === GestureScreenBottomControls);
  const gestureAreaContent = children.find(
    (child) => React.isValidElement(child) && typeof child.type === "function" && child.type === GestureScreenGestureAreaContent);

  const activeGesture = React.useRef<TrackedGesture | null>(null);
  const [gestureLine, setGestureLine] = React.useState<string | null>(null);

  function updateGestureLine(): void {
    if (activeGesture.current === null) {
      setGestureLine(null);
      return;
    }

    const line = activeGesture.current.points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
      .join(" ");
    setGestureLine(line);
  }

  const handlePointerDown = useEvent(
    (event: React.PointerEvent) => {
      if (activeGesture.current !== null) {
        return;
      }

      activeGesture.current = {
        pointerId: event.pointerId,
        points: [new DOMPoint(event.clientX, event.clientY)],
      };

      updateGestureLine();
    });

  const handlePointerUp = useEvent(
    (event: React.PointerEvent) => {
      if (activeGesture.current !== null && event.pointerId === activeGesture.current.pointerId) {
        const gesture = detectGesture(activeGesture.current);
        activeGesture.current = null;
        updateGestureLine();

        if (gesture !== null) {
          props.onDetectGesture(gesture);
        }
      }
    });

  const handlePointerCancel = useEvent(
    (event: React.PointerEvent) => {
      if (activeGesture.current !== null && event.pointerId === activeGesture.current.pointerId) {
        activeGesture.current = null;
        updateGestureLine();
      }
    });

  const handlePointerMove = useEvent(
    (event: React.PointerEvent) => {
      if (activeGesture.current !== null && event.pointerId === activeGesture.current.pointerId) {
        activeGesture.current.points.push(new DOMPoint(event.clientX, event.clientY));
        updateGestureLine();
      }
    });

  useWakeLock();

  // !!! the old practice screens still need to use overlay mode. Remove this when they've been updated.
  const elements = (
    <div className="gesture-screen">
      <div
        className={classNames("gesture-detection-area", props.overlay === true && "overlay")}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerMove={handlePointerMove}
      >
        <div className="message">{props.message}</div>
        <svg>
          {gestureLine !== null && <path d={gestureLine} />}
        </svg>
        {gestureAreaContent}
      </div>
      {bottomControlsChild}
    </div>
  );

  return props.overlay === true ? createPortal(elements, document.body) : elements;
}

export interface GestureDetectorData {
  handleDetectGesture: (gesture: Gesture) => void;
  handleStopGestureDetection: () => void;
  gesturePromise: ImmutableRefObject<Promise<Gesture | null>>;
  gestureCount: ImmutableRefObject<number>;
}

export function useGestureDetector(): GestureDetectorData {
  const repeatableActionData = useRepeatableAction<Gesture>();
  return {
    handleDetectGesture: repeatableActionData.handleAction,
    handleStopGestureDetection: repeatableActionData.handleStopAction,
    gesturePromise: repeatableActionData.actionPromise,
    gestureCount: repeatableActionData.actionCount,
  };
}