import React, { useCallback, useEffect, useRef, useState } from "react";
import { assert } from "utilities/errors";
import { useEvent } from "utilities/useEvent";
import { clamp, classNames } from "utilities/utilities";

type NumberInputValue = string | ReadonlyArray<string> | number | undefined;

interface ExtendedNumberInputProps {
  value: number;
  onChangeValue?: (value: number) => void;
  onPressEnter?: () => void;
}

export type NumberInputProps = Omit<React.DetailedHTMLProps<React.InputHTMLAttributes<HTMLInputElement>, HTMLInputElement>, "value"> & ExtendedNumberInputProps;

export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  (props, ref): React.JSX.Element => {
    const { className, value, onChangeValue, onPressEnter, type, min, max, ...inputElementProps } = props;
    assert(type === undefined || type === "number");

    const defaultValue = clamp(0, typeof min === "number" ? min : 0, typeof max === "number" ? max : 0);

    function fixupValue(rawValue: NumberInputValue): number {
      let numberValue: number;
      if (typeof rawValue === "string") {
        const valueString = rawValue.trim();
        if (valueString.length === 0) {
          return defaultValue;
        } else {
          numberValue = parseFloat(valueString);
        }
      } else if (typeof rawValue === "number") {
        numberValue = rawValue;
      } else {
        return defaultValue;
      }

      if (typeof min === "number") {
        numberValue = Math.max(numberValue, min);
      }

      if (typeof max === "number") {
        numberValue = Math.min(numberValue, max);
      }

      return numberValue;
    }

    const fixedUpValue = fixupValue(props.value);

    const inputElement = useRef<HTMLInputElement | null>(null);
    const [displayedValue, setDisplayedValue] = useState<NumberInputValue>(value.toString());
    const cachedFixedUpValue = useRef(fixedUpValue);

    const onPressEnterRef = useRef(onPressEnter);
    onPressEnterRef.current = onPressEnter;

    useEffect(
      () => {
        // If the provided props value changed (after fixup), update our value
        if (fixedUpValue !== cachedFixedUpValue.current) {
          cachedFixedUpValue.current = fixedUpValue;
          setDisplayedValue(fixedUpValue);
        }
      },
      [fixedUpValue]);

    const setInputElementRef = useCallback(
      (el: HTMLInputElement | null): void => {
        if (el !== null) {
          el.addEventListener(
            "keydown",
            (event) => {
              if (onPressEnterRef.current === undefined) {
                return;
              }

              if (event.code === "Enter" || event.code === "NumpadEnter") {
                event.preventDefault();
                onPressEnterRef.current();
              }
            });
        }

        inputElement.current = el;
        if (ref !== null) {
          if (typeof ref === "function") {
            ref(el);
          } else {
            ref.current = el;
          }
        }
      },
      []);

    const handleChange = useEvent(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        // Update our displayed value to include any whitespace
        setDisplayedValue(e.target.value);

        // Only send out updates for fixed-up values
        const fixedUpNewValue = fixupValue(e.target.value);
        const didChange = fixedUpNewValue !== cachedFixedUpValue.current;
        if (didChange) {
          onChangeValue?.(fixedUpNewValue);
        }

        cachedFixedUpValue.current = fixedUpNewValue;

        props.onChange?.(e);
      });

    const handleBlur = useEvent(
      (e: React.FocusEvent<HTMLInputElement>) => {
        // Remove displayed whitespace when we lose focus.
        if (displayedValue !== cachedFixedUpValue.current) {
          setDisplayedValue(cachedFixedUpValue.current);
        }

        if (props.onBlur !== undefined) {
          props.onBlur(e);
        }
      });

    return (
      <input
        {...inputElementProps}
        ref={setInputElementRef}
        type="number"
        className={classNames("input", className)}
        min={min}
        max={max}
        value={displayedValue}
        onChange={handleChange}
        onBlur={handleBlur}
      />
    );
  });

NumberInput.displayName = "NumberInput";