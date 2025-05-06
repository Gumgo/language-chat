import { ListVoicesApiResponseVoice, Model, modelValues } from "api";
import { Button } from "components/button";
import { showDialog } from "components/dialog";
import { Select } from "components/select";
import { TextInput } from "components/textInput";
import { VocabularyEntry } from "dataState";
import { StoryPractice } from "exercises/storyPractice";
import { storyDifficulties, StoryDifficulty, StoryMode, storyModes } from "exercises/storyPracticeTypes";
import * as React from "react";
import { doThrow } from "utilities/errors";
import { useLocalStorageState } from "utilities/useLocalStorage";

const defaultModel: Model = "gpt-4o";
const speechSpeedValues = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
const defaultWordsQuery = "";
const defaultFocusWordsQuery = "+>14d";

// !!! make the ability to save and re-play stories
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
          <div className="story-practice-settings">
            <div className="label">Model</div>
            <Select value={model} onChange={(e) => setModel(e.target.value as Model)}>
              {modelValues.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
            <div className="label">Speech speed</div>
            <Select value={speechSpeed} onChange={(e) => setSpeechSpeed(parseInt(e.target.value))}>
              {speechSpeedValues.map((v) => <option key={v} value={v}>{`${v}%`}</option>)}
            </Select>
            <div className="label">Words query</div>
            <TextInput value={wordsQuery} onChangeValue={setWordsQuery} />
            <div />
            <div>{vocabularyEntries.length} {vocabularyEntries.length === 1 ? "result" : "results"}</div>
            <div className="label">Focus words query</div>
            <TextInput value={focusWordsQuery} onChangeValue={setFocusWordsQuery} />
            <div />
            <div>{focusVocabularyEntries.length} {focusVocabularyEntries.length === 1 ? "result" : "results"}</div>
            <div className="label">Mode</div>
            <Select value={storyMode} onChange={(e) => setStoryMode(e.target.value as StoryMode)}>
              {storyModes.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
            <div className="label">Difficulty</div>
            <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value as StoryDifficulty)}>
              {storyDifficulties.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </div>
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