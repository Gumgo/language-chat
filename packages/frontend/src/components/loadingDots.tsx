import * as React from "react";
import { classNames } from "utilities/utilities";

interface LoadingDotsProps {
  className?: string;
  color?: "Light" | "Dark";
}

export function LoadingDots(props: LoadingDotsProps): React.JSX.Element {
  return (
    <div className={classNames("loading-dots", props.color === "Dark" && "dark", props.className)}>
      {[...new Array(3).keys()].map((i) => <div className="dot" key={i} />)}
    </div>
  );
}