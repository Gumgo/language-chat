import { assert } from "utilities/errors";

export interface QueryableItem {
  searchableText: string[];
  tags: string[];
  creationDate: Date;
  srsStrength: number | null; // If SRS has not been started, this should be null
}

function isWhitespace(character: string): boolean {
  return /\s/.test(character);
}

function indexOfWhitespace(text: string): number {
  for (let i = 0; i < text.length; i++) {
    if (isWhitespace(text[i])) {
      return i;
    }
  }

  return -1;
}

export function runQuery(items: QueryableItem[], query: string, filterDate: Date): number[] {
  // Split the query into parts but don't use split() so that we can detect quotes
  interface QueryPart {
    text: string;
    quoted: boolean;
  }

  const queryParts: QueryPart[] = [];

  let remainingQuery = query.trim();
  while (remainingQuery.length > 0) {
    if (remainingQuery.startsWith("\"")) {
      const endQuoteIndex = remainingQuery.indexOf("\"", 1);

      // The end quote must come at the end of the string or be followed by whitespace
      if (endQuoteIndex >= 0 && (endQuoteIndex === remainingQuery.length - 1 || isWhitespace(remainingQuery[endQuoteIndex + 1]))) {
        if (endQuoteIndex > 1) {
          queryParts.push({ text: remainingQuery.substring(1, endQuoteIndex), quoted: true });
        }

        remainingQuery = remainingQuery.substring(endQuoteIndex + 1).trimStart();
        continue;
      }
    }

    const nextWhitespaceIndex = indexOfWhitespace(remainingQuery);
    if (nextWhitespaceIndex >= 0) {
      queryParts.push({ text: remainingQuery.substring(0, nextWhitespaceIndex), quoted: false });
      remainingQuery = remainingQuery.substring(nextWhitespaceIndex + 1).trimStart();
    } else {
      queryParts.push({ text: remainingQuery, quoted: false });
      remainingQuery = "";
    }
  }

  if (queryParts.length === 0) {
    return items.map((_, i) => i);
  }

  const words: string[] = [];

  const includeTags: string[] = [];
  const excludeTags: string[] = [];

  const includeNewerThan: number[] = [];
  const includeOlderThan: number[] = [];
  const excludeNewerThan: number[] = [];
  const excludeOlderThan: number[] = [];

  const includeSrs: boolean[] = [];
  const excludeSrs: boolean[] = [];
  const includeSrsStrongerThan: number[] = [];
  const includeSrsWeakerThan: number[] = [];
  const excludeSrsStrongerThan: number[] = [];
  const excludeSrsWeakerThan: number[] = [];

  class Parser {
    private text: string;

    public constructor(text: string) {
      this.text = text;
    }

    public get remaining(): string {
      return this.text;
    }

    public consumeIfStartsWith(str: string): boolean {
      if (this.text.startsWith(str)) {
        this.text = this.text.substring(str.length);
        return true;
      }

      return false;
    }

    public parseRemainingAsNumber(): number | null {
      const result = parseFloat(this.text);
      return isNaN(result) ? null : result;
    }
  }

  for (const part of queryParts) {
    if (part.quoted) {
      words.push(part.text);
      continue;
    }

    const parser = new Parser(part.text);

    let filterType: "Inclusive" | "Exclusive";
    if (parser.consumeIfStartsWith("+")) {
      filterType = "Inclusive";
    } else if (parser.consumeIfStartsWith("-")) {
      filterType = "Exclusive";
    } else {
      words.push(part.text);
      continue;
    }

    let filterCategory: "Age" | "Srs" | "NoSrs";
    if (parser.consumeIfStartsWith("age")) {
      filterCategory = "Age";
    } else if (parser.consumeIfStartsWith("srs")) {
      filterCategory = "Srs";
    } else if (parser.consumeIfStartsWith("nosrs")) {
      filterCategory = "NoSrs";
    } else {
      (filterType === "Inclusive" ? includeTags : excludeTags).push(parser.remaining);
      continue;
    }

    let filterDirection: "Greater" | "Less" | null = null;
    if (parser.consumeIfStartsWith(">")) {
      filterDirection = "Greater";
    } else if (parser.consumeIfStartsWith("<")) {
      filterDirection = "Less";
    }

    let filterValue: number | null = null;
    if (filterDirection !== null) {
      filterValue = parser.parseRemainingAsNumber();
      if (filterValue === null) {
        continue;
      }
    }

    if (filterCategory === "Age") {
      if (filterDirection === "Greater") {
        assert(filterValue !== null);
        (filterType === "Inclusive" ? includeOlderThan : excludeOlderThan).push(filterValue);
      } else if (filterDirection === "Less") {
        assert(filterValue !== null);
        (filterType === "Inclusive" ? includeNewerThan : excludeNewerThan).push(filterValue);
      }
    } else if (filterCategory === "Srs") {
      if (filterDirection === "Greater") {
        assert(filterValue !== null);
        (filterType === "Inclusive" ? includeSrsStrongerThan : excludeSrsStrongerThan).push(filterValue);
      } else if (filterDirection === "Less") {
        assert(filterValue !== null);
        (filterType === "Inclusive" ? includeSrsWeakerThan : excludeSrsWeakerThan).push(filterValue);
      } else {
        (filterType === "Inclusive" ? includeSrs : excludeSrs).push(true);
      }
    } else if (filterDirection === null) {
      // NoSrs
      (filterType === "Inclusive" ? includeSrs : excludeSrs).push(false);
    }
  }

  const anyIncludeFilters = words.length > 0
    || includeTags.length > 0
    || includeNewerThan.length > 0
    || includeOlderThan.length > 0
    || includeSrs.length > 0
    || includeSrsStrongerThan.length > 0
    || includeSrsWeakerThan.length > 0;

  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  return items
    .map((_, i) => i)
    .filter(
      (i) => {
        const item = items[i];
        if (excludeTags.some((tag) => item.tags.includes(tag))
          || excludeNewerThan.some((days) => item.creationDate.getTime() > filterDate.getTime() - days * millisecondsPerDay)
          || excludeOlderThan.some((days) => item.creationDate.getTime() < filterDate.getTime() - days * millisecondsPerDay)
          || excludeSrs.some((hasSrs) => (item.srsStrength !== null) === hasSrs)
          || excludeSrsStrongerThan.some((strength) => item.srsStrength !== null && item.srsStrength > strength)
          || excludeSrsWeakerThan.some((strength) => item.srsStrength !== null && item.srsStrength < strength)) {
          return false;
        }

        if (!anyIncludeFilters) {
          return true;
        }

        if (includeTags.some((tag) => item.tags.includes(tag))
          || includeNewerThan.some((days) => item.creationDate.getTime() > filterDate.getTime() - days * millisecondsPerDay)
          || includeOlderThan.some((days) => item.creationDate.getTime() < filterDate.getTime() - days * millisecondsPerDay)
          || includeSrs.some((hasSrs) => (item.srsStrength !== null) === hasSrs)
          || includeSrsStrongerThan.some((strength) => item.srsStrength !== null && item.srsStrength > strength)
          || includeSrsWeakerThan.some((strength) => item.srsStrength !== null && item.srsStrength < strength)) {
          return true;
        }

        for (const text of item.searchableText) {
          const textLower = text.toLocaleLowerCase();
          if (words.some((word) => textLower.includes(word))) {
            return true;
          }
        }

        return false;
      });
}