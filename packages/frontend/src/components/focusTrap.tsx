import React, { PropsWithChildren, useCallback, useLayoutEffect, useRef } from "react";
import { assert } from "utilities/errors";
import { useEvent } from "utilities/useEvent";

function tryFocus(element: Node): boolean {
  if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
    return false;
  }

  element.focus();
  return document.activeElement === element;
}

function tryFocusBetween(preGuard: Node, postGuard: Node, focusTarget: "First" | "Last"): boolean {
  if (preGuard.nextSibling === postGuard) {
    // There are no additional elements between the pre and post guard
    assert(postGuard.previousSibling === preGuard);
    return false;
  }

  interface StackEntry {
    node: Node;
    visited: boolean;
  }

  const startNode = focusTarget === "First" ? preGuard.nextSibling : postGuard.previousSibling;
  const endNode = focusTarget === "First" ? postGuard : preGuard;
  assert(startNode !== null);

  const stack: StackEntry[] = [{ node: startNode, visited: false }];
  while (stack.length > 0) {
    const entry = stack[stack.length - 1];
    if (!entry.visited) {
      entry.visited = true;

      if (tryFocus(entry.node)) {
        return true;
      }

      const child = focusTarget === "First" ? entry.node.firstChild : entry.node.lastChild;
      if (child !== null) {
        stack.push({ node: child, visited: false });
      }
    } else {
      stack.pop();
      const nextNode = focusTarget === "First" ? entry.node.nextSibling : entry.node.previousSibling;
      if (nextNode !== null && nextNode !== endNode) {
        stack.push({ node: nextNode, visited: false });
      }
    }
  }

  return false;
}

interface ExtendedFocusTrapProps {
  active: boolean;
}

type FocusTrapProps = React.DetailedHTMLProps<React.BaseHTMLAttributes<HTMLDivElement>, HTMLDivElement> & ExtendedFocusTrapProps;

export const FocusTrap = React.forwardRef<HTMLDivElement, PropsWithChildren<FocusTrapProps>>(
  (props, ref): React.JSX.Element => {
    const { active, children, ...divElementProps } = props;

    const rootElement = useRef<HTMLDivElement | null>(null);
    const preGuardElement = useRef<HTMLDivElement | null>(null);
    const postGuardElement = useRef<HTMLDivElement | null>(null);
    const listenerActive = useRef(false);
    const ignoreFocusEvent = useRef(false);

    const setRootElement = useCallback(
      (element: HTMLDivElement | null) => {
        rootElement.current = element;
        if (ref !== null) {
          if (typeof ref === "function") {
            ref(element);
          } else {
            ref.current = element;
          }
        }
      },
      []);

    const handleFocus = useEvent(
      (event: FocusEvent) => {
        if (ignoreFocusEvent.current || rootElement.current === null || preGuardElement.current === null || postGuardElement.current === null) {
          return;
        }

        try {
          ignoreFocusEvent.current = true;

          let removeFocus = false;
          if (event.target === preGuardElement.current) {
            // If we hit the pre-guard, wrap focus around to the last element
            removeFocus = !tryFocusBetween(preGuardElement.current, postGuardElement.current, "Last");
          } else if (event.target === postGuardElement.current) {
            // If we hit the post-guard, wrap focus around to the first element
            removeFocus = !tryFocusBetween(preGuardElement.current, postGuardElement.current, "First");
          } else if (event.target instanceof Node && !rootElement.current.contains(event.target)) {
            // If we managed to focus on something outside of the guard elements, bring focus back
            removeFocus = !tryFocusBetween(preGuardElement.current, postGuardElement.current, "First");
          }

          if (removeFocus && (event.target instanceof HTMLElement || event.target instanceof SVGElement)) {
            event.target.blur();
          }
        } finally {
          ignoreFocusEvent.current = false;
        }
      });

    useLayoutEffect(
      () => {
        if (active && !listenerActive.current) {
          document.addEventListener("focus", handleFocus, true);
          listenerActive.current = true;
        } else if (!active && listenerActive.current) {
          document.removeEventListener("focus", handleFocus, true);
          listenerActive.current = false;
        }
      },
      [active]);

    // Use an additional layout effect to force-remove the listener on unmount
    useLayoutEffect(
      () => () => {
        if (listenerActive.current) {
          document.removeEventListener("focus", handleFocus);
          listenerActive.current = false;
        }
      },
      []);

    return (
      <div ref={setRootElement} {...divElementProps}>
        <div ref={preGuardElement} className="focus-trap-guard" tabIndex={0} />
        {children}
        <div ref={postGuardElement} className="focus-trap-guard" tabIndex={0} />
      </div>
    );
  });

FocusTrap.displayName = "FocusTrap";