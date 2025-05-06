import { faBook, faCopy, faEarListen } from "@fortawesome/free-solid-svg-icons";
import { Button } from "components/button";
import { showDialog } from "components/dialog";
import * as React from "react";

export type VocabularyAction =
  | "CopySelectedWords"
  | "ListeningPractice"
  | "StoryPractice";

export async function showVocabularyActionsDialog(selectedVocabularyWordCount: number): Promise<VocabularyAction | null> {
  const result = await showDialog(
    (dialogProps) => {
      return (
        <div className="options-dialog-container">
          <h3>Vocabulary actions</h3>
          <div className="vocabulary-actions">
            <Button
              type="button"
              appearance="IconOnly"
              color="Primary"
              icon={faCopy}
              tooltip="Copy selected words"
              onClick={() => dialogProps.onClose("CopySelectedWords")}
            />
            <Button
              type="button"
              appearance="IconOnly"
              color="Primary"
              icon={faEarListen}
              tooltip="Listening practice"
              disabled={selectedVocabularyWordCount === 0}
              onClick={() => dialogProps.onClose("ListeningPractice")}
            />
            <Button
              type="button"
              appearance="IconOnly"
              color="Primary"
              icon={faBook}
              tooltip="Story practice"
              onClick={() => dialogProps.onClose("StoryPractice")}
            />
          </div>
          <div className="buttons">
            <Button
              type="button"
              appearance="Standard"
              color="Gray"
              text="Close"
              onClick={() => dialogProps.onClose(null)}
            />
          </div>
        </div>
      );
    },
    undefined,
    { width: "Small" });

  return result as VocabularyAction | null;
}