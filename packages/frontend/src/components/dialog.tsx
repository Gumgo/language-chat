import { Button, ButtonColor } from "components/button";
import { FocusTrap } from "components/focusTrap";
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { assert } from "utilities/errors";
import { useEvent } from "utilities/useEvent";
import { useStateRef } from "utilities/useStateRef";
import { buildCompleteMappingGetter, classNames } from "utilities/utilities";

export type DialogWidth = "Normal" | "Small" | "Unset";

const getDialogWidthClassName = buildCompleteMappingGetter<DialogWidth, string | null>(
  "dialog widths",
  ["Normal", "Small", "Unset"],
  [
    ["Normal", "width-normal"],
    ["Small", "width-small"],
    ["Unset", null],
  ]);

export interface DialogOptions {
  width?: DialogWidth;
}

interface DialogContentProps {
  onClose: (result: unknown) => void;
}

export type DialogContent = (props: DialogContentProps) => JSX.Element;

interface ActiveDialog {
  id: number;
  dialogContent: DialogContent;
  onClose: (result: unknown) => void;
  clickOutsideResult: unknown;
  options: DialogOptions;
  dialogRoot: Element | null;
  disappearing: boolean;
  previouslyFocusedElement: Element | null;
}

type DialogStateListener = (dialogs: ActiveDialog[]) => void;

class DialogManagerInternal {
  private readonly dialogs_: ActiveDialog[] = [];
  private readonly dialogStateListeners: DialogStateListener[] = [];
  private nextId = 0;

  private previouslyFocusedElement: Element | null = null;

  public get dialogs(): ActiveDialog[] {
    return this.dialogs_;
  }

  public addDialogStateListener(dialogStateListener: DialogStateListener): void {
    if (!this.dialogStateListeners.includes(dialogStateListener)) {
      this.dialogStateListeners.push(dialogStateListener);
    }
  }

  public removeDialogStateListener(dialogStateListener: DialogStateListener): void {
    const index = this.dialogStateListeners.findIndex((listener) => listener === dialogStateListener);
    if (index >= 0) {
      this.dialogStateListeners.splice(index, 1);
    }
  }

  public showDialog(dialogContent: DialogContent, onClose: (result: unknown) => void, clickOutsideResult: unknown, options: DialogOptions): void {
    const topDialog = this.dialogs.findLast((v) => !v.disappearing);
    if (topDialog === undefined) {
      this.previouslyFocusedElement = document.activeElement;
    } else if (topDialog.dialogRoot !== null && topDialog.dialogRoot.contains(document.activeElement)) {
      topDialog.previouslyFocusedElement = document.activeElement;
    }

    if (document.activeElement !== null && (document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement)) {
      document.activeElement.blur();
    }

    const dialog: ActiveDialog = {
      id: this.nextId,
      dialogContent,
      onClose,
      clickOutsideResult: clickOutsideResult,
      options,
      dialogRoot: null,
      disappearing: false,
      previouslyFocusedElement: null,
    };

    this.nextId++;
    this.dialogs_.push(dialog);
    this.dialogStateChanged();
  }

  public setDialogRoot(dialogId: number, dialogRoot: Element | null): void {
    const dialog = this.dialogs_.find((d) => d.id === dialogId);
    if (dialog !== undefined) {
      dialog.dialogRoot = dialogRoot;
    }
  }

  public closeDialog(dialogId: number, result: unknown): void {
    const dialog = this.dialogs_.find((d) => d.id === dialogId);
    if (dialog !== undefined) {
      dialog.onClose(result);
      dialog.disappearing = true;
      this.dialogStateChanged();
    }
  }

  public updateFocus(): void {
    const topDialog = this.dialogs_.findLast((v) => !v.disappearing);

    // Give focus to whatever element previously had focus in the top-most dialog
    let previouslyFocusedElement: Element | null;
    if (topDialog === undefined) {
      previouslyFocusedElement = this.previouslyFocusedElement;
      this.previouslyFocusedElement = null;
    } else {
      previouslyFocusedElement = topDialog.previouslyFocusedElement;
      topDialog.previouslyFocusedElement = null;
    }

    if (previouslyFocusedElement !== null
      && previouslyFocusedElement.parentElement !== null
      && (previouslyFocusedElement instanceof HTMLElement || previouslyFocusedElement instanceof SVGElement)) {
      previouslyFocusedElement.focus();
    }
  }

  public removeDialog(dialogId: number): void {
    const dialogIndex = this.dialogs_.findIndex((d) => d.id === dialogId);
    if (dialogIndex >= 0) {
      this.dialogs_.splice(dialogIndex, 1);
      this.dialogStateChanged();
    }
  }

  private dialogStateChanged(): void {
    // We need to make a copy or else state changes won't be detected
    const dialogs = [...this.dialogs_];
    for (const listener of this.dialogStateListeners) {
      listener(dialogs);
    }
  }
}

const dialogManager = new DialogManagerInternal();

interface DialogProps {
  dialogId: number;
  dialogContent: DialogContent;
  clickOutsideResult: unknown;
  options: DialogOptions;
  isTop: boolean;
}

function Dialog(props: DialogProps): React.JSX.Element {
  const DialogContent = props.dialogContent;

  type DialogState = "Invisible" | "Visible" | "Disappearing";

  const eventBlockerElement = useRef<HTMLDivElement | null>(null);
  const dialogElement = useRef<HTMLDivElement | null>(null);
  const [dialogStateState, dialogStateRef, setDialogState] = useStateRef<DialogState>("Invisible");

  const setDialogRoot = useCallback(
    (e: HTMLDivElement | null) => {
      dialogManager.setDialogRoot(props.dialogId, e);
      eventBlockerElement.current = e;
    },
    []);

  // Delay the "appearing" animation by one frame, otherwise the dialog will appear in its final visible state
  useLayoutEffect(
    () => void window.requestAnimationFrame(
      () => {
        if (dialogStateRef.current === "Invisible") {
          setDialogState("Visible");
        }
      }),
    []);

  useLayoutEffect(
    () => {
      if (dialogStateRef.current === "Disappearing") {
        dialogManager.updateFocus();
        dialogElement.current?.addEventListener(
          "transitionend",
          () => dialogManager.removeDialog(props.dialogId));
      }
    },
    [dialogStateState]);

  const handleClose = useEvent(
    (result: unknown) => {
      if (dialogStateRef.current !== "Disappearing") {
        setDialogState("Disappearing");
        dialogManager.closeDialog(props.dialogId, result);
        if (eventBlockerElement.current !== null) {
          // Setting inert will prevent focus on any child elements
          eventBlockerElement.current.inert = true;
        }
      }
    });

  const handleClickOutside = useEvent(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0 || event.target !== eventBlockerElement.current) {
        return;
      }

      if (dialogStateRef.current !== "Disappearing") {
        setDialogState("Disappearing");
        dialogManager.closeDialog(props.dialogId, props.clickOutsideResult);

        // Setting inert will prevent focus on any child elements
        eventBlockerElement.current.inert = true;
      }
    });

  const dialogWidthClassName = getDialogWidthClassName(props.options.width ?? "Normal");

  return (
    <FocusTrap
      ref={setDialogRoot}
      className={classNames("dialog-event-blocker", dialogStateState === "Disappearing" && "inactive")}
      active={props.isTop}
      onClick={props.clickOutsideResult === undefined ? undefined : handleClickOutside}
    >
      <div ref={dialogElement} className={classNames("dialog", dialogWidthClassName, dialogStateState === "Visible" && "visible", !props.isTop && "obscured")}>
        <DialogContent onClose={handleClose} />
      </div>
    </FocusTrap>
  );
}

export function DialogManager(): React.JSX.Element {
  const [dialogs, setDialogs] = useState<ActiveDialog[]>(dialogManager.dialogs);

  useEffect(
    () => {
      dialogManager.addDialogStateListener(setDialogs);
      return () => dialogManager.removeDialogStateListener(setDialogs);
    },
    []);

  const topActiveDialog = dialogs.findLast((d) => !d.disappearing);
  return (
    <div className={classNames("dialog-container", dialogs.some((v) => !v.disappearing) && "visible")}>
      {
        dialogs.map(
          (dialog) => (
            <Dialog
              key={dialog.id}
              dialogId={dialog.id}
              dialogContent={dialog.dialogContent}
              clickOutsideResult={dialog.clickOutsideResult}
              options={dialog.options}
              isTop={dialog === topActiveDialog}
            />
          ))
      }
    </div>
  );
}

export function showDialog(dialogContent: DialogContent, clickOutsideResult?: unknown, options?: DialogOptions): Promise<unknown> {
  return new Promise<unknown>((resolve) => dialogManager.showDialog(dialogContent, resolve, clickOutsideResult, options ?? {}));
}

interface OptionsDialogButton {
  text: string;
  color: ButtonColor;
  defaultFocus?: boolean;
}

export async function showOptionsDialog(
  title: string,
  message: string,
  buttons: OptionsDialogButton[],
  clickOutsideResult?: number,
  options?: DialogOptions): Promise<number> {
  assert(buttons.reduce<number>((p, c) => p + (c.defaultFocus === true ? 1 : 0), 0) <= 1);

  function OptionsDialogContent(props: DialogContentProps): React.JSX.Element {
    const setFocus = useCallback((element: HTMLButtonElement | null) => element?.focus(), []);

    return (
      <div className="options-dialog-container">
        <h3>{title}</h3>
        <div>{message}</div>
        {
          buttons.length > 0 && (
            <div className="buttons">
              {
                buttons.map(
                  (button, i) => (
                    <Button
                      key={i}
                      ref={button.defaultFocus === true ? setFocus : undefined}
                      type="button"
                      appearance="Standard"
                      color={button.color}
                      text={button.text}
                      onClick={() => props.onClose(i)}
                    />
                  ))
              }
            </div>
          )
        }
      </div>
    );
  }

  return await showDialog(OptionsDialogContent, clickOutsideResult, options) as number;
}

export async function showErrorDialog(title: string, message: string): Promise<void> {
  await showOptionsDialog(title, message, [{ text: "OK", color: "Primary", defaultFocus: true }], 0);
}