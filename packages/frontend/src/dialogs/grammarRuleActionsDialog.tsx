import { faChartSimple } from "@fortawesome/free-solid-svg-icons";
import { Button } from "components/button";
import { showDialog } from "components/dialog";
import * as React from "react";

export type GrammarRuleAction =
  | "SrsStats";

export async function showGrammarRuleActionsDialog(): Promise<GrammarRuleAction | null> {
  const result = await showDialog(
    (dialogProps) => {
      return (
        <div className="options-dialog-container">
          <h3>Grammar rule actions</h3>
          <div className="grammar-rule-actions">
            <Button
              type="button"
              appearance="IconOnly"
              color="Primary"
              icon={faChartSimple}
              tooltip="SRS stats"
              onClick={() => dialogProps.onClose("SrsStats")}
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

  return result as GrammarRuleAction | null;
}