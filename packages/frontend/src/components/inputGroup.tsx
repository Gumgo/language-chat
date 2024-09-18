import React, { PropsWithChildren, ReactElement, cloneElement, isValidElement } from "react";
import { classNames } from "utilities/utilities";

interface InputGroupProps {
  className?: string;
}

export function InputGroup(props: PropsWithChildren<InputGroupProps>): React.JSX.Element {
  const children = React.Children.toArray(props.children);

  return (
    <div className={classNames("input-group", props.className)}>
      {
        children.flatMap(
          (child, i) => {
            if (!isValidElement(child)) {
              return child;
            }

            const additionalClasses: string[] = ["disable-shadow"];

            if (i > 0) {
              additionalClasses.push("flat-left");
            }

            if (i < children.length - 1) {
              additionalClasses.push("flat-right");
            }

            // Assume any child will at least have these props
            interface ChildProps {
              className?: string;
            }

            const childWithProps = child as ReactElement<ChildProps>;
            const clonedChild = cloneElement(
              childWithProps,
              {
                className: classNames(childWithProps.props.className, ...additionalClasses),
              });

            return [
              clonedChild,
              i !== children.length - 1 && <div key={`input-group-spacer-${i}`} className="spacer" />,
            ];
          })
      }
    </div>
  );
}
