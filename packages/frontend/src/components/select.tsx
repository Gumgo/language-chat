import * as React from "react";
import { classNames } from "utilities/utilities";

type SelectProps = React.DetailedHTMLProps<React.SelectHTMLAttributes<HTMLSelectElement>, HTMLSelectElement>;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (props, ref): React.JSX.Element => {
    const { className, ...selectElementProps } = props;

    return (
      <div className="select">
        <select
          ref={ref}
          className={classNames("select", className)}
          {...selectElementProps}
        >
          {props.children}
        </select>
      </div>
    );
  });

Select.displayName = "Selector";