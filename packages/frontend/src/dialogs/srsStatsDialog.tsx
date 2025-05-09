import { Button } from "components/button";
import { showDialog } from "components/dialog";
import * as React from "react";
import { calculateSrsStats, getSrsStrengthColor, SrsEntry } from "utilities/srs";

export async function showSrsStatsDialog(srsEntries: SrsEntry[], date: Date): Promise<void> {
  const maxStrengthLabel = 10;
  const strengthCounts = new Map<number, number>();
  let unstartedCount = 0;
  let readyForReviewCount = 0;
  for (const entry of srsEntries) {
    if (entry.reviews.size === 0) {
      unstartedCount++;
    } else {
      const srsStats = calculateSrsStats(entry.reviews, date);
      const strength = Math.min(Math.floor(srsStats.strength), maxStrengthLabel);
      strengthCounts.set(strength, (strengthCounts.get(strength) ?? 0) + 1);
      if (srsStats.optimalDaysToNextReview <= 0) {
        readyForReviewCount++;
      }
    }
  }

  const maxStrength = Math.max(maxStrengthLabel, ...strengthCounts.keys());

  await showDialog(
    (dialogProps) => {
      return (
        <div className="options-dialog-container">
          <h3>SRS stats</h3>
          <div className="srs-stats-dialog">
            <div className="title">Strength</div>
            <div className="title">Count</div>
            <div>-</div>
            <div>{unstartedCount === 0 ? "-" : unstartedCount}</div>
            {
              new Array(maxStrength + 1)
                .keys()
                .map(
                  (strength) => {
                    const count = strengthCounts.get(strength) ?? 0;
                    return [
                      <div key={`strength-${strength}`} className="" style={{ color: getSrsStrengthColor(strength) }}>
                        {strength === maxStrengthLabel ? `${strength}+` : strength}
                      </div>,
                      <div key={`count-${strength}`} className="">{count === 0 ? "-" : count}</div>,
                    ];
                  })
                .toArray()
            }
            <div className="ready-for-review">Ready for review: {readyForReviewCount}</div>
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
}