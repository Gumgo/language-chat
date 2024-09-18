import { IconDefinition } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import React, { CSSProperties, PropsWithChildren, useCallback, useEffect, useRef, useState } from "react";
import { useEvent } from "utilities/useEvent";
import { classNames } from "utilities/utilities";

type TextInputValue = string | ReadonlyArray<string> | number | undefined;

interface ExtendedTextInputProps {
  trimWhitespace?: boolean;
  onChangeValue?: (value: string) => void;
  onPressEnter?: () => void;
}

export type TextInputProps = React.DetailedHTMLProps<React.InputHTMLAttributes<HTMLInputElement>, HTMLInputElement> & ExtendedTextInputProps;

export const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(
  (props, ref): React.JSX.Element => {
    const { className, trimWhitespace, onChangeValue, onPressEnter, ...inputElementProps } = props;
    const trimWhitespaceBoolean = trimWhitespace ?? true;

    function fixupValue(value: TextInputValue): string {
      return typeof value === "string"
        ? trimWhitespaceBoolean ? value.trim() : value
        : "";
    }

    const fixedUpValue = fixupValue(props.value);

    const inputElement = useRef<HTMLInputElement | null>(null);
    const [displayedValue, setDisplayedValue] = useState<TextInputValue>(props.value);
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
        if (props.type === "email" && trimWhitespaceBoolean && inputElement.current !== null) {
          // Hack: the email type pre-trims its value, meaning you never receive a value with whitespace, so the displayed vs. cached comparison won't work.
          // Additionally, setting an email input's value to the element's current value has no effect if only the leading/trailing whitespace changed. To get
          // around this, we have to clear and set the value on the HTML element itself.
          inputElement.current.value = "";
          inputElement.current.value = cachedFixedUpValue.current;
        }

        if (displayedValue !== cachedFixedUpValue.current) {
          setDisplayedValue(cachedFixedUpValue.current);
        }

        if (props.onBlur !== undefined) {
          props.onBlur(e);
        }
      });

    let pattern = props.pattern;
    if (props.required === true && pattern === undefined && trimWhitespaceBoolean) {
      pattern = ".*\\S+.*";
    }

    return (
      <input
        {...inputElementProps}
        ref={setInputElementRef}
        className={classNames("input", className)}
        value={props.value !== undefined ? displayedValue : undefined}
        pattern={pattern}
        onChange={handleChange}
        onBlur={handleBlur}
      />
    );
  });

TextInput.displayName = "TextInput";

interface InputWithIconProps {
  className?: string;
  style?: CSSProperties;
  icon: IconDefinition;
}

export function InputWithIcon(props: PropsWithChildren<InputWithIconProps>): React.JSX.Element {
  return (
    <div className={classNames("input-with-icon", props.className)}>
      {props.children}
      <FontAwesomeIcon className="icon" icon={props.icon} fontSize="current" />
    </div>
  );
}