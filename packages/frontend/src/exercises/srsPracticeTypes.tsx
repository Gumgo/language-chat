import { Model } from "api";
import { GrammarRuleEntry, VocabularyEntry } from "dataState";

export type SrsPracticeMode =
  | "Srs"
  | "Random";

export const srsPracticeModes: SrsPracticeMode[] = ["Srs", "Random"];

export interface SrsPracticeSettings {
  model: Model;
  speechSpeed: number;

  // How to practice words
  wordPracticeMode: SrsPracticeMode;

  // List of SRS words including both unlocked and new
  srsWords: VocabularyEntry[];

  // List of all words that can be used as filler
  allWords: VocabularyEntry[];

  // How to practice grammar rules
  grammarRulePracticeMode: SrsPracticeMode;

  // List of SRS grammar rules including both unlocked and new
  srsGrammarRules: GrammarRuleEntry[];

  // List of all grammar rules that can be used as filler
  allGrammarRules: GrammarRuleEntry[];
}