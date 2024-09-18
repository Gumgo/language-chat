import { IconDefinition } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import React from "react";
import { Link, LinkProps } from "react-router-dom";
import { buildCompleteMappingGetter, classNames } from "utilities/utilities";

interface ButtonContentProps {
  text?: string;
  icon?: IconDefinition | null;
  hidden?: boolean;
}

function ButtonContent(props: ButtonContentProps): React.JSX.Element {
  return (
    <div className={classNames("button-content", props.hidden === true && "hidden")}>
      {props.icon !== undefined && props.icon !== null && <FontAwesomeIcon icon={props.icon} />}
      {props.text !== undefined && <span>{props.text}</span>}
    </div>
  );
}

export type ButtonAppearance =
  | "Standard"
  | "IconOnly"
  | "Custom";

export type ButtonColor =
  | "Primary"
  | "Gray"
  | "Custom";

const buttonAppearances: ButtonAppearance[] = [
  "Standard",
  "IconOnly",
  "Custom",
];

const buttonColors: ButtonColor[] = [
  "Primary",
  "Gray",
  "Custom",
];

const getButtonAppearanceClass = buildCompleteMappingGetter<ButtonAppearance, string | null>(
  "button appearance classes",
  buttonAppearances,
  [
    ["Standard", "button-standard"],
    ["IconOnly", "button-icon-only"],
    ["Custom", null],
  ]);

const getButtonColorClass = buildCompleteMappingGetter<ButtonColor, string | null>(
  "button color classes",
  buttonColors,
  [
    ["Primary", "primary"],
    ["Gray", "gray"],
    ["Custom", null],
  ]);

interface ExtendedButtonProps {
  type: "submit" | "reset" | "button"; // Require this to be specified
  appearance: ButtonAppearance;
  color: ButtonColor;
  pressed?: boolean;

  text?: string;
  icon?: IconDefinition | null;

  tooltip?: string;
}

type ButtonProps = React.DetailedHTMLProps<React.ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement> & ExtendedButtonProps;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (props, ref): React.JSX.Element => {
    const { className, type, appearance, color, pressed, text, icon, tooltip, ...buttonElementProps } = props;

    const anyChildren = React.Children.count(props.children) > 0;
    const anyPredefinedContent = text !== undefined || (icon !== undefined && icon !== null);
    if (anyChildren && anyPredefinedContent) {
      throw new Error("Buttons should either have predefined content or children but not both");
    }

    const appearanceClass = getButtonAppearanceClass(appearance);
    const colorClass = getButtonColorClass(color);

    return (
      <button
        ref={ref}
        className={classNames(appearanceClass, colorClass, pressed === true && "pressed", className)}
        // We require a button type in ExtendedButtonProps so this warning is benign
        // eslint-disable-next-line react/button-has-type
        type={type}
        title={tooltip}
        {...buttonElementProps}
      >
        {
          anyChildren
            ? props.children
            : (
              <ButtonContent
                text={text}
                icon={icon}
              />
            )
        }
      </button>
    );
  });

Button.displayName = "Button";

interface ExtendedButtonLinkProps {
  appearance: ButtonAppearance;
  color: ButtonColor;
  pressed?: boolean;

  text?: string;
  icon?: IconDefinition | null;

  tooltip?: string;
}

type ButtonLinkProps = LinkProps & React.RefAttributes<HTMLAnchorElement> & ExtendedButtonLinkProps;

export const ButtonLink = React.forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  (props, ref): React.JSX.Element => {
    const { className, type, appearance, color, pressed, text, icon, tooltip, ...buttonElementProps } = props;

    const anyChildren = React.Children.count(props.children) > 0;
    const anyPredefinedContent = text !== undefined || (icon !== undefined && icon !== null);
    if (anyChildren && anyPredefinedContent) {
      throw new Error("Buttons should either have predefined content or children but not both");
    }

    const appearanceClass = getButtonAppearanceClass(appearance);
    const colorClass = getButtonColorClass(color);

    return (
      <Link
        ref={ref}
        className={classNames("button-link", appearanceClass, colorClass, pressed === true && "pressed", className)}
        // We require a button type in ExtendedButtonProps so this warning is benign
        // eslint-disable-next-line react/button-has-type
        type={type}
        data-toggle={tooltip === undefined ? undefined : "tooltip"}
        title={tooltip}
        {...buttonElementProps}
      >
        {
          anyChildren
            ? props.children
            : (
              <ButtonContent
                text={text}
                icon={icon}
              />
            )
        }
      </Link>
    );
  });

ButtonLink.displayName = "ButtonLink";