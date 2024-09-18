import React, { useCallback, useEffect, useRef, useState } from "react";
import { useEvent } from "utilities/useEvent";
import { classNames } from "utilities/utilities";

type TextAreaValue = string | ReadonlyArray<string> | number | undefined;

interface ExtendedTextAreaProps {
  onChangeValue?: (value: string) => void;
  onPressEnter?: () => void;
}

export type TextAreaProps = React.DetailedHTMLProps<React.TextareaHTMLAttributes<HTMLTextAreaElement>, HTMLTextAreaElement> & ExtendedTextAreaProps;

export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(
  (props, ref): React.JSX.Element => {
    const { className, onChangeValue, onPressEnter, ...textAreaElementProps } = props;

    function fixupValue(value: TextAreaValue): string {
      return typeof value === "string"
        ? value
        : "";
    }

    const fixedUpValue = fixupValue(props.value);

    const textAreaElement = useRef<HTMLTextAreaElement | null>(null);
    const [displayedValue, setDisplayedValue] = useState<TextAreaValue>(props.value);
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

    const setTextAreaElementRef = useCallback(
      (el: HTMLTextAreaElement | null): void => {
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

        textAreaElement.current = el;
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
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        // Update our displayed value
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
      (e: React.FocusEvent<HTMLTextAreaElement>) => {
        if (displayedValue !== cachedFixedUpValue.current) {
          setDisplayedValue(cachedFixedUpValue.current);
        }

        if (props.onBlur !== undefined) {
          props.onBlur(e);
        }
      });

    return (
      <textarea
        {...textAreaElementProps}
        ref={setTextAreaElementRef}
        className={classNames("text-area", className)}
        value={props.value !== undefined ? displayedValue : undefined}
        onChange={handleChange}
        onBlur={handleBlur}
      />
    );
  });

TextArea.displayName = "TextArea";
