export interface SrsEntry {
  id: string;
  reviews: ReadonlyMap<Date, boolean>;
}

export interface SrsStats {
  strength: number;
  optimalDaysToNextReview: number;
}

const millisecondsPerDay = 1000 * 60 * 60 * 24;

// If you review a word too soon, its strength won't increase at all
const minimumReviewSpacingDays = 0.25;

// When you pass a review after the optimal amount of time, the next spacing period is multiplied by this value
const reviewSpacingMultiplier = 2;

// When you fail a review, the strength of the entry is reduced by currentStrength * failurePenaltyStrengthFraction
const failurePenaltyStrengthFraction = 0.5;

function calculateOptimalDaysToNextReviewForStrength(strength: number): number {
  return minimumReviewSpacingDays * reviewSpacingMultiplier ** Math.max(strength - 1, 0);
}

export function calculateSrsStats(reviews: ReadonlyMap<Date, boolean>, currentDate: Date): SrsStats {
  if (reviews.size === 0) {
    return { strength: 0, optimalDaysToNextReview: 0 };
  }

  const orderedReviews = [...reviews].toSorted((a, b) => a[0].getTime() - b[0].getTime());
  let lastReviewDate = orderedReviews[0][0];
  let currentStrength = orderedReviews[0][1] ? 1 : 0;
  orderedReviews.splice(0, 1);
  for (const [date, passed] of orderedReviews) {
    const daysSinceLastReview = (date.getTime() - lastReviewDate.getTime()) / millisecondsPerDay;
    if (passed) {
      const optimalDaysSinceLastReview = calculateOptimalDaysToNextReviewForStrength(currentStrength);

      // Calculate strength increase. Note that cases are handled in this order so that you still get a strength increase if the optimal waiting time is less
      // than the minimum review spacing.
      let strengthIncrease: number;
      if (daysSinceLastReview >= optimalDaysSinceLastReview) {
        // If you waited long enough, the entry's strength increases by 1. You cannot make it increase faster than this.
        strengthIncrease = 1;
      } else if (daysSinceLastReview <= minimumReviewSpacingDays) {
        // If you reviewed too soon, the entry doesn't get strengthened
        strengthIncrease = 0;
      } else {
        // The entry's strength increase is scaled by how long you waited relative to the optimal amount of time
        strengthIncrease = (daysSinceLastReview - minimumReviewSpacingDays) / (optimalDaysSinceLastReview - minimumReviewSpacingDays);
      }

      currentStrength += strengthIncrease;
    } else {
      currentStrength = Math.max(0, currentStrength - Math.max(currentStrength * failurePenaltyStrengthFraction, 1));
    }

    lastReviewDate = date;
  }

  const daysSinceLastReview = (currentDate.getTime() - lastReviewDate.getTime()) / millisecondsPerDay;
  const optimalDaysToNextReview = calculateOptimalDaysToNextReviewForStrength(currentStrength);
  return { strength: currentStrength, optimalDaysToNextReview: optimalDaysToNextReview - daysSinceLastReview };
}

export function getSrsStrengthColor(strength: number): string {
  const minColor = [1, 0, 0];
  const midColor = [1, 1, 0];
  const maxColor = [0, 1, 0];
  const maxStrength = 10;

  const midStrength = maxStrength / 2;
  let a: number[];
  let b: number[];
  let u: number;
  if (strength < midStrength) {
    u = strength / midStrength;
    a = minColor;
    b = midColor;
  } else {
    u = (strength - midStrength) / (maxStrength - midStrength);
    a = midColor;
    b = maxColor;
  }

  const result = a.map((valueA, i) => valueA * (1 - u) + b[i] * u);
  return `#${result.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
}
