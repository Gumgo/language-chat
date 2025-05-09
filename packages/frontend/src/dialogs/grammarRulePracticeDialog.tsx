import { ListVoicesApiResponseVoice, Model } from "api";
import { Button } from "components/button";
import { showDialog } from "components/dialog";
import { DataState, GrammarRuleEntry, VocabularyEntry } from "dataState";
import { DialogSettingsGrid, EnumDialogSetting, ModelSelect, SpeechSpeedSelect, WordsQuery } from "dialogs/commonDialogComponents";
import { GrammarRulePractice } from "exercises/grammarRulePractice";
import { GrammarRulePracticeMode, grammarRulePracticeModes } from "exercises/grammarRulePracticeTypes";
import * as React from "react";
import { doThrow } from "utilities/errors";
import { useLocalStorageState } from "utilities/useLocalStorage";

const defaultModel: Model = "gpt-4o";
const defaultWordsQuery = "";

export async function showGrammarRulePracticeDialog(
  language: string,
  voices: Map<string, ListVoicesApiResponseVoice[]>,
  grammarRuleEntries: GrammarRuleEntry[],
  dataState: DataState,
  runQuery: (query: string) => VocabularyEntry[],
): Promise<void> {
  await showDialog(
    (dialogProps) => {
      const languageVoices = voices.get(language)?.map((v) => v.name) ?? doThrow(new Error(`Voices for language ${language} not provided`));

      const [model, setModel] = useLocalStorageState("grammarRulePracticeModel", (v) => v as Model, defaultModel);
      const [speechSpeed, setSpeechSpeed] = useLocalStorageState("grammarRulePracticeSpeechSpeed", (v) => parseInt(v), 100);
      const [wordsQuery, setWordsQuery] = useLocalStorageState("grammarRulePracticeWordsQuery", (v) => v, defaultWordsQuery);
      const [grammarRuleMode, setGrammarRuleMod] = useLocalStorageState(
        "grammarRulePracticeGrammarRuleMode",
        (v) => v as GrammarRulePracticeMode,
        "SrsPractice");
      const [wordMode, setWordMode] = useLocalStorageState("grammarRulePracticeWordMode", (v) => v as GrammarRulePracticeMode, "SrsPractice");

      const vocabularyEntries = React.useMemo(() => runQuery(wordsQuery), [wordsQuery]);

      const [playing, setPlaying] = React.useState(false);

      return (
        <div className="options-dialog-container">
          <h3>Grammar rule practice</h3>
          <DialogSettingsGrid>
            <ModelSelect model={model} setModel={setModel} />
            <SpeechSpeedSelect speechSpeed={speechSpeed} setSpeechSpeed={setSpeechSpeed} />
            <WordsQuery title="Words query" wordsQuery={wordsQuery} setWordsQuery={setWordsQuery} resultCount={vocabularyEntries.length} />
            <EnumDialogSetting<GrammarRulePracticeMode>
              title="Grammar rule mode"
              values={grammarRulePracticeModes}
              value={grammarRuleMode}
              setValue={setGrammarRuleMod}
            />
            <EnumDialogSetting<GrammarRulePracticeMode>
              title="Word mode"
              values={grammarRulePracticeModes}
              value={wordMode}
              setValue={setWordMode}
            />
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
              onClick={() => setPlaying(true)}
            />
          </div>
          {
            playing && (
              <GrammarRulePractice
                language={language}
                model={model}
                voices={languageVoices}
                speechSpeed={speechSpeed}
                grammarRules={grammarRuleEntries}
                words={vocabularyEntries}
                grammarRulePracticeMode={grammarRuleMode}
                wordPracticeMode={wordMode}
                dataState={dataState}
                onStop={() => setPlaying(false)}
              />
            )
          }
        </div>
      );
    },
    undefined,
    { width: "Small" });
}