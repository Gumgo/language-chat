import React, { useCallback, useLayoutEffect, useRef } from "react";
import { useEvent } from "utilities/useEvent";

interface CheckboxProps {
  className?: string;
  id?: string;
  checked?: boolean;
  disabled?: boolean;
  onChange?: (value: boolean) => void;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  (props, ref): React.JSX.Element => {
    const handleChange = useEvent((event: React.ChangeEvent<HTMLInputElement>) => props.onChange?.(event.target.checked));

    return (
      <input
        ref={ref}
        className="form-check-input"
        id={props.id}
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={handleChange}
      />
    );
  });

Checkbox.displayName = "Checkbox";

export type TriStateCheckboxValue = "Unchecked" | "Checked" | "Indeterminate";

interface TriStateCheckboxProps {
  className?: string;
  id?: string;
  value?: TriStateCheckboxValue;
  disabled?: boolean;
  onChange?: (value: boolean) => void;
}

export const TriStateCheckbox = React.forwardRef<HTMLInputElement, TriStateCheckboxProps>(
  (props, ref): React.JSX.Element => {
    const element = useRef<HTMLInputElement | null>(null);

    const setElement = useCallback(
      (e: HTMLInputElement | null) => {
        element.current = e;
        if (e !== null) {
          e.indeterminate = props.value === "Indeterminate";
        }

        if (typeof ref === "function") {
          ref(e);
        } else if (ref !== null) {
          ref.current = e;
        }
      },
      [ref]);

    const handleChange = useEvent((event: React.ChangeEvent<HTMLInputElement>) => props.onChange?.(event.target.checked));

    useLayoutEffect(
      () => {
        if (element.current !== null) {
          element.current.indeterminate = props.value === "Indeterminate";
        }
      },
      [props.value]);

    return (
      <input
        ref={setElement}
        className={props.className}
        id={props.id}
        type="checkbox"
        checked={props.value === "Checked"}
        disabled={props.disabled}
        onChange={handleChange}
      />
    );
  });

TriStateCheckbox.displayName = "TriStateCheckbox";