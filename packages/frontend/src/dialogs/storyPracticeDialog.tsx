import { ListVoicesApiResponseVoice, Model } from "api";
import { Button } from "components/button";
import { showDialog } from "components/dialog";
import { VocabularyEntry } from "dataState";
import { StoryPractice } from "exercises/storyPractice";
import { storyDifficulties, StoryDifficulty, StoryMode, storyModes } from "exercises/storyPracticeTypes";
import * as React from "react";
import { doThrow } from "utilities/errors";
import { useLocalStorageState } from "utilities/useLocalStorage";
import { DialogSettingsGrid, EnumDialogSetting, ModelSelect, SpeechSpeedSelect, WordsQuery } from "dialogs/commonDialogComponents";

const defaultModel: Model = "gpt-4o";
const defaultWordsQuery = "";
const defaultFocusWordsQuery = "+age>14";

// $TODO make the ability to save and re-play stories
export async function showStoryPracticeDialog(
  language: string,
  voices: Map<string, ListVoicesApiResponseVoice[]>,
  runQuery: (query: string) => VocabularyEntry[],
): Promise<void> {
  await showDialog(
    (dialogProps) => {
      // Note: all supported voices are used because some stories (dialogs) may require multiple characters
      const englishVoices = voices.get("English") ?? doThrow(new Error(`Voices for language English not provided`));
      const languageVoices = voices.get(language) ?? doThrow(new Error(`Voices for language ${language} not provided`));

      const [model, setModel] = useLocalStorageState("storyPracticeModel", (v) => v as Model, defaultModel);
      const [speechSpeed, setSpeechSpeed] = useLocalStorageState("storyPracticeSpeechSpeed", (v) => parseInt(v), 100);

      const [wordsQuery, setWordsQuery] = useLocalStorageState("storyPracticeWordsQuery", (v) => v, defaultWordsQuery);
      const [focusWordsQuery, setFocusWordsQuery] = useLocalStorageState("storyPracticeFocusWordsQuery", (v) => v, defaultFocusWordsQuery);

      const [storyMode, setStoryMode] = useLocalStorageState("storyPracticeMode", (v) => v as StoryMode, "Story");
      const [difficulty, setDifficulty] = useLocalStorageState("storyPracticeDifficulty", (v) => v as StoryDifficulty, "Normal");

      const vocabularyEntries = React.useMemo(() => runQuery(wordsQuery), [wordsQuery]);
      const focusVocabularyEntries = React.useMemo(() => runQuery(focusWordsQuery), [focusWordsQuery]);

      const [playing, setPlaying] = React.useState(false);

      return (
        <div className="options-dialog-container">
          <h3>Listening practice</h3>
          <DialogSettingsGrid>
            <ModelSelect model={model} setModel={setModel} />
            <SpeechSpeedSelect speechSpeed={speechSpeed} setSpeechSpeed={setSpeechSpeed} />
            <WordsQuery title="Words query" wordsQuery={wordsQuery} setWordsQuery={setWordsQuery} resultCount={vocabularyEntries.length} />
            <WordsQuery title="Focus words query" wordsQuery={focusWordsQuery} setWordsQuery={setFocusWordsQuery} resultCount={focusVocabularyEntries.length} />
            <EnumDialogSetting<StoryMode> title="Mode" values={storyModes} value={storyMode} setValue={setStoryMode} />
            <EnumDialogSetting<StoryDifficulty> title="Difficulty" values={storyDifficulties} value={difficulty} setValue={setDifficulty} />
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
              <StoryPractice
                language={language}
                model={model}
                voices={languageVoices}
                englishVoices={englishVoices}
                speechSpeed={speechSpeed}
                words={vocabularyEntries}
                focusWords={focusVocabularyEntries}
                storyMode={storyMode}
                difficulty={difficulty}
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