import { faCirclePlay, faCircleStop } from "@fortawesome/free-solid-svg-icons";
import { ListVoicesApiResponseVoice, Model } from "api";
import { Button } from "components/button";
import { showDialog } from "components/dialog";
import { VocabularyEntry } from "dataState";
import { CheckboxDialogSetting, DialogSettingsGrid, ModelSelect, NumberDialogSetting, SpeechSpeedSelect } from "dialogs/commonDialogComponents";
import { ListeningPractice, ListeningPracticeEntry } from "exercises/listeningPractice";
import * as React from "react";
import { doThrow } from "utilities/errors";
import { useAudioPlayer } from "utilities/useAudioPlayer";
import { useLocalStorageState } from "utilities/useLocalStorage";

const defaultModel: Model = "gpt-4o";
const repeatCounts = [1, 2, 3, 4, 5];
const pauseDurations = [0.5, 1, 1.5, 2, 2.5, 3];

async function showReviewsDialog(reviews: ListeningPracticeEntry[], vocabularyEntry: VocabularyEntry[]): Promise<void> {
  await showDialog(
    (dialogProps) => {
      const audioPlayer = useAudioPlayer<string>((v) => new Promise((resolve) => resolve(v)), (v) => v);

      function handleClickPlayStopAudio(url: string): void {
        if (audioPlayer.playingAudioIdentifier === url) {
          audioPlayer.stopAudio();
        } else {
          audioPlayer.playAudio(url);
        }
      }

      return (
        <div className="options-dialog-container">
          <h3>Reviews</h3>
          <div className="listening-practice-reviews">
            <div className="content">
              {
                reviews.map(
                  (review, i) => (
                    <div key={i} className="review">
                      <div className="word">
                        <span>{review.word}</span>
                        <Button
                          className="play-audio-button"
                          type="button"
                          appearance="IconOnly"
                          color="Primary"
                          icon={audioPlayer.playingAudioIdentifier === review.wordAudioUrl ? faCircleStop : faCirclePlay}
                          tooltip={audioPlayer.playingAudioIdentifier === review.wordAudioUrl ? "Stop audio" : "Play audio"}
                          onClick={() => handleClickPlayStopAudio(review.wordAudioUrl)}
                        />
                      </div>
                      <div className="translation">{vocabularyEntry.find((entry) => entry.word === review.word)?.translation}</div>
                      {
                        review.sentence !== null && review.sentenceAudioUrl !== null && (
                          <div className="sentence">
                            <span>{review.sentence}</span>
                            <Button
                              className="play-audio-button"
                              type="button"
                              appearance="IconOnly"
                              color="Primary"
                              icon={audioPlayer.playingAudioIdentifier === review.sentenceAudioUrl ? faCircleStop : faCirclePlay}
                              tooltip={audioPlayer.playingAudioIdentifier === review.sentenceAudioUrl ? "Stop audio" : "Play audio"}
                              onClick={() => handleClickPlayStopAudio(review.sentenceAudioUrl ?? "")}
                            />
                          </div>
                        )
                      }
                    </div>
                  ))
              }
            </div>
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
    { width: "Normal" });
}

export async function showListeningPracticeDialog(
  language: string,
  voices: Map<string, ListVoicesApiResponseVoice[]>,
  vocabularyEntries: VocabularyEntry[],
): Promise<void> {
  await showDialog(
    (dialogProps) => {
      const languageVoices = voices.get(language)?.map((v) => v.name) ?? doThrow(new Error(`Voices for language ${language} not provided`));

      const [model, setModel] = useLocalStorageState("listeningPracticeModel", (v) => v as Model, defaultModel);
      const [speechSpeed, setSpeechSpeed] = useLocalStorageState("listeningPracticeSpeechSpeed", (v) => parseInt(v), 100);

      const [sayWordFirst, setSayWordFirst] = useLocalStorageState("listeningPracticeSayWordFirst", (v) => v.trim().toLowerCase() === "true", true);
      const [useInSentence, setUseInSentence] = useLocalStorageState("listeningPracticeUseInSentence", (v) => v.trim().toLowerCase() === "true", true);
      const [wordRepeatCount, setWordRepeatCount] = useLocalStorageState("listeningPracticeWordRepeatCount", (v) => parseInt(v), 1);
      const [sentenceRepeatCount, setSentenceRepeatCount] = useLocalStorageState("listeningPracticeSentenceRepeatCount", (v) => parseInt(v), 1);
      const [pauseDuration, setPauseDuration] = useLocalStorageState("listeningPracticePauseDuration", (v) => parseFloat(v), 2);

      const [playing, setPlaying] = React.useState(false);
      const reviews = React.useRef<ListeningPracticeEntry[]>([]);

      function handleClickStart(): void {
        setPlaying(true);
      }

      function handleReview(entry: ListeningPracticeEntry): void {
        reviews.current.push(entry);
      }

      function handleStop(): void {
        setPlaying(false);
        if (reviews.current.length > 0) {
          void showReviewsDialog(reviews.current, vocabularyEntries);
          reviews.current = [];
        }
      }

      return (
        <div className="options-dialog-container">
          <h3>Listening practice</h3>
          <DialogSettingsGrid>
            <ModelSelect model={model} setModel={setModel} />
            <SpeechSpeedSelect speechSpeed={speechSpeed} setSpeechSpeed={setSpeechSpeed} />
            <CheckboxDialogSetting title="Say word first" value={sayWordFirst} setValue={setSayWordFirst} />
            <CheckboxDialogSetting title="Use in sentence" value={useInSentence} setValue={setUseInSentence} />
            <NumberDialogSetting title="Repeat word" values={repeatCounts} suffixes={["time", "times"]} value={wordRepeatCount} setValue={setWordRepeatCount} />
            <NumberDialogSetting
              title="Repeat sentence"
              values={repeatCounts}
              suffixes={["time", "times"]}
              value={sentenceRepeatCount}
              setValue={setSentenceRepeatCount}
            />
            <NumberDialogSetting title="Pause duration" values={pauseDurations} suffixes={["sec", "sec"]} value={pauseDuration} setValue={setPauseDuration} />
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
          {
            playing && (
              <ListeningPractice
                language={language}
                model={model}
                voices={languageVoices}
                speechSpeed={speechSpeed}
                sayWordFirst={sayWordFirst}
                useInSentence={useInSentence}
                wordRepeatCount={wordRepeatCount}
                sentenceRepeatCount={sentenceRepeatCount}
                pauseDuration={pauseDuration}
                vocabularyEntries={vocabularyEntries}
                onReview={handleReview}
                onStop={handleStop}
              />
            )
          }
        </div>
      );
    },
    undefined,
    { width: "Small" });
}