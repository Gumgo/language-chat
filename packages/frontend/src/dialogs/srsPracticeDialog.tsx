import { Model } from "api";
import { Button } from "components/button";
import { showDialog, showErrorDialog } from "components/dialog";
import { DataState, GrammarRuleEntry, VocabularyEntry } from "dataState";
import { CheckboxDialogSetting, DialogSettingsGrid, EnumDialogSetting, IntegerDialogSetting, ModelSelect, SpeechSpeedSelect, WordsQuery } from "dialogs/commonDialogComponents";
import { SrsPracticeMode, srsPracticeModes, SrsPracticeSettings } from "exercises/srsPracticeTypes";
import * as React from "react";
import { logError } from "utilities/logger";
import { runQuery } from "utilities/query";
import { calculateSrsStats } from "utilities/srs";
import { useIsMounted } from "utilities/useIsMounted";
import { LocalStorageCategory } from "utilities/useLocalStorage";
import { parseBoolean } from "utilities/utilities";

const defaultModel: Model = "gpt-4.1";
const defaultWordsQuery = "";
const defaultGrammarRulesQuery = "";

export async function showSrsPracticeDialog(
  language: string,
  dataState: DataState,
): Promise<SrsPracticeSettings | null> {
  return await showDialog(
    (dialogProps) => {
      const cat = new LocalStorageCategory("srsPractice");
      const [model, setModel] = cat.useLocalStorageState("model", (v) => v as Model, defaultModel);
      const [speechSpeed, setSpeechSpeed] = cat.useLocalStorageState("speechSpeed", parseInt, 100);

      const [wordsQuery, setWordsQuery] = cat.useLocalStorageState("wordsQuery", (v) => v, defaultWordsQuery);
      const [wordPracticeMode, setWordPracticeMode] = cat.useLocalStorageState("wordPracticeMode", (v) => v as SrsPracticeMode, "Srs");
      const [newWordCount, setNewWordCount] = cat.useLocalStorageState("newWordCount", parseInt, 0);
      const [onlyUnlockedWords, setOnlyUnlockedWords] = cat.useLocalStorageState("onlyUnlockedWords", parseBoolean, false);

      const [grammarRulesQuery, setGrammarRulesQuery] = cat.useLocalStorageState("grammarRulesQuery", (v) => v, defaultGrammarRulesQuery);
      const [grammarRulePracticeMode, setGrammarRulePracticeMode] = cat.useLocalStorageState("grammarRulePracticeMode", (v) => v as SrsPracticeMode, "Srs");
      const [newGrammarRuleCount, setNewGrammarRuleCount] = cat.useLocalStorageState("newGrammarRuleCount", parseInt, 0);
      const [onlyUnlockedGrammarRules, setOnlyUnlockedGrammarRules] = cat.useLocalStorageState("onlyUnlockedGrammarRules", parseBoolean, true);

      const [date, setDate] = React.useState(() => new Date());
      const [vocabularyEntries, setVocabularyEntries] = React.useState<VocabularyEntry[]>([]);
      const [grammarRuleEntries, setGrammarRuleEntries] = React.useState<GrammarRuleEntry[]>([]);

      const filteredVocabularyEntries = React.useMemo(
        () => {
          const resultIndices = runQuery(
            vocabularyEntries.map(
              (v) => (
                {
                  searchableText: [v.word, v.translation],
                  tags: v.tags,
                  creationDate: v.creationDate,
                  srsStrength: calculateSrsStats(v.listeningSrsReviews, date).strength,
                })),
            wordsQuery,
            date);
          return resultIndices.map((i) => vocabularyEntries[i]);
        },
        [wordsQuery, date, vocabularyEntries]);

      const filteredGrammarRuleEntries = React.useMemo(
        () => {
          const resultIndices = runQuery(
            grammarRuleEntries.map(
              (v) => (
                {
                  searchableText: [v.name],
                  tags: [],
                  creationDate: v.creationDate,
                  srsStrength: calculateSrsStats(v.listeningSrsReviews, date).strength,
                })),
            grammarRulesQuery,
            date);
          return resultIndices.map((i) => grammarRuleEntries[i]);
        },
        [grammarRulesQuery, date, grammarRuleEntries]);

      const isMounted = useIsMounted();

      async function fetchData(): Promise<void> {
        let vocabularyEntriesInner: VocabularyEntry[] | null = null;
        try {
          vocabularyEntriesInner = await dataState.getVocabularyEntries(language);
        } catch (error) {
          logError(error);
          void showErrorDialog("Error", "Failed to list vocabulary entries.");
        }

        let grammarRuleEntriesInner: GrammarRuleEntry[] | null = null;
        try {
          grammarRuleEntriesInner = await dataState.getGrammarRuleEntries(language);
        } catch (error) {
          logError(error);
          void showErrorDialog("Error", "Failed to list grammar rule entries.");
        }

        if (!isMounted.current || vocabularyEntriesInner === null || grammarRuleEntriesInner === null) {
          return;
        }

        setDate(new Date());
        setVocabularyEntries(vocabularyEntriesInner);
        setGrammarRuleEntries(grammarRuleEntriesInner);
      }

      React.useEffect(() => void fetchData(), []);

      interface SrsReviewStats {
        wordReviewCount: number;
        newWordCount: number;
        grammarRuleReviewCount: number;
        newGrammarRuleCount: number;
      }

      const srsReviewStats = React.useMemo(
        () => {
          const result: SrsReviewStats = { wordReviewCount: 0, newWordCount: 0, grammarRuleReviewCount: 0, newGrammarRuleCount: 0 };

          if (wordPracticeMode === "Srs") {
            for (const entry of filteredVocabularyEntries) {
              if (entry.listeningSrsReviews.size === 0) {
                if (result.newWordCount < newWordCount) {
                  result.newWordCount++;
                }
              } else if (calculateSrsStats(entry.listeningSrsReviews, date).optimalDaysToNextReview <= 0) {
                result.wordReviewCount++;
              }
            }
          }

          if (grammarRulePracticeMode === "Srs") {
            for (const entry of filteredGrammarRuleEntries) {
              if (entry.listeningSrsReviews.size === 0) {
                if (result.newGrammarRuleCount < newGrammarRuleCount) {
                  result.newGrammarRuleCount++;
                }
              } else if (calculateSrsStats(entry.listeningSrsReviews, date).optimalDaysToNextReview <= 0) {
                result.grammarRuleReviewCount++;
              }
            }
          }

          return result;
        },
        [date, filteredVocabularyEntries, wordPracticeMode, newWordCount, filteredGrammarRuleEntries, grammarRulePracticeMode, newGrammarRuleCount]);

      function generateSrsEntries<T extends { creationDate: Date; listeningSrsReviews: Map<Date, boolean> }>(
        practiceMode: SrsPracticeMode,
        entries: T[], newEntryCount: number,
      ): T[] {
        if (practiceMode !== "Srs") {
          return [];
        }

        const srsEntries: T[] = [];
        const possibleNewEntries: T[] = [];
        for (const entry of entries) {
          if (entry.listeningSrsReviews.size === 0) {
            possibleNewEntries.push(entry);
          } else if (calculateSrsStats(entry.listeningSrsReviews, date).optimalDaysToNextReview <= 0) {
            srsEntries.push(entry);
          }
        }

        // Introduce new entries by their creation date
        possibleNewEntries.sort((a, b) => a.creationDate.getTime() - b.creationDate.getTime());
        srsEntries.push(...possibleNewEntries.slice(0, newEntryCount));
        return srsEntries;
      }

      function handleClickStart(): void {
        const settings: SrsPracticeSettings = {
          model,
          speechSpeed,
          wordPracticeMode,
          allWords: onlyUnlockedWords ? filteredVocabularyEntries.filter((v) => v.listeningSrsReviews.size > 0) : filteredVocabularyEntries,
          srsWords: generateSrsEntries(wordPracticeMode, filteredVocabularyEntries, newWordCount),
          grammarRulePracticeMode,
          allGrammarRules: onlyUnlockedGrammarRules ? filteredGrammarRuleEntries.filter((v) => v.listeningSrsReviews.size > 0) : filteredGrammarRuleEntries,
          srsGrammarRules: generateSrsEntries(grammarRulePracticeMode, filteredGrammarRuleEntries, newGrammarRuleCount),
        };

        dialogProps.onClose(settings);
      }

      return (
        <div className="options-dialog-container">
          <h3>SRS practice</h3>
          <DialogSettingsGrid>
            <ModelSelect model={model} setModel={setModel} />
            <SpeechSpeedSelect speechSpeed={speechSpeed} setSpeechSpeed={setSpeechSpeed} />
            <WordsQuery title="Words query" wordsQuery={wordsQuery} setWordsQuery={setWordsQuery} resultCount={filteredVocabularyEntries.length} />
            <EnumDialogSetting<SrsPracticeMode> title="Word mode" values={srsPracticeModes} value={wordPracticeMode} setValue={setWordPracticeMode} />
            <IntegerDialogSetting title="New word count" min={0} max={100} value={newWordCount} setValue={setNewWordCount} />
            <CheckboxDialogSetting title="Only unlocked words" value={onlyUnlockedWords} setValue={setOnlyUnlockedWords} />
            <WordsQuery
              title="Grammar rules query"
              wordsQuery={grammarRulesQuery}
              setWordsQuery={setGrammarRulesQuery}
              resultCount={filteredGrammarRuleEntries.length}
            />
            <EnumDialogSetting<SrsPracticeMode>
              title="Grammar rule mode"
              values={srsPracticeModes}
              value={grammarRulePracticeMode}
              setValue={setGrammarRulePracticeMode}
            />
            <IntegerDialogSetting title="New grammar rule count" min={0} max={100} value={newGrammarRuleCount} setValue={setNewGrammarRuleCount} />
            <CheckboxDialogSetting title="Only unlocked grammar rules" value={onlyUnlockedGrammarRules} setValue={setOnlyUnlockedGrammarRules} />
            <div />
            <div>Word review count: {srsReviewStats.wordReviewCount}</div>
            <div />
            <div>New word count: {srsReviewStats.newWordCount}</div>
            <div />
            <div>Grammar rule review count: {srsReviewStats.grammarRuleReviewCount}</div>
            <div />
            <div>New grammar rule count: {srsReviewStats.newGrammarRuleCount}</div>
          </DialogSettingsGrid>
          <div className="buttons">
            <Button
              type="button"
              appearance="Standard"
              color="Gray"
              text="Close"
              onClick={() => dialogProps.onClose(null)}
            />
            <Button
              type="button"
              appearance="Standard"
              color="Primary"
              text="Start"
              onClick={handleClickStart}
            />
          </div>
        </div>
      );
    },
    undefined,
    { width: "Small" }) as SrsPracticeSettings | null;
}