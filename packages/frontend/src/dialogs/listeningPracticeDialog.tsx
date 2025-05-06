import { faCirclePlay, faCircleStop } from "@fortawesome/free-solid-svg-icons";
import { chat, ListVoicesApiResponseVoice, Model, modelValues, speech } from "api";
import { Button } from "components/button";
import { Checkbox } from "components/checkbox";
import { showDialog } from "components/dialog";
import { Gesture, GestureScreen } from "components/gestureScreen";
import { Select } from "components/select";
import { VocabularyEntry } from "dataState";
import { getUseWordInSentenceProp } from "prompts";
import * as React from "react";
import { createPortal } from "react-dom";
import { assert, doThrow } from "utilities/errors";
import { generateIsolatedWordSpeechUrl } from "utilities/speechUtilities";
import { useAudioPlayer } from "utilities/useAudioPlayer";
import { useIsMounted } from "utilities/useIsMounted";
import { useLocalStorageState } from "utilities/useLocalStorage";
import { sleep } from "utilities/utilities";

const defaultModel: Model = "gpt-4o";
const speechSpeedValues = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
const repeatCounts = [1, 2, 3, 4, 5];
const pauseDurations = [0.5, 1, 1.5, 2, 2.5, 3];

const useInSentenceTemperature = 1;

interface ListeningPracticeEntry {
  word: string;
  wordAudioUrl: string;
  sentence: string | null;
  sentenceAudioUrl: string | null;
}

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

async function generateListeningPracticeEntry(
  language: string,
  model: Model,
  voice: string,
  speed: number,
  word: string,
  useInSentence: boolean): Promise<ListeningPracticeEntry> {
  const wordAudioUrlPromise = generateIsolatedWordSpeechUrl(language, voice, speed, word);
  let sentence: string | null = null;
  let sentenceAudioUrlPromise: Promise<string> | null = null;
  const promises = [wordAudioUrlPromise];
  if (useInSentence) {
    sentenceAudioUrlPromise = (async () => {
      const prompt = getUseWordInSentenceProp(language, word);
      sentence = (await chat({ messages: [{ sender: "System", content: prompt }], model, temperature: useInSentenceTemperature })).message;
      return (await speech({ language, message: sentence, speed, voice, ssml: false })).audioUrl;
    })();
    promises.push(sentenceAudioUrlPromise);
  }

  await Promise.all(promises);
  return {
    word,
    wordAudioUrl: await wordAudioUrlPromise,
    sentence,
    sentenceAudioUrl: sentenceAudioUrlPromise === null ? null : await sentenceAudioUrlPromise,
  };
}

interface ListeningPracticeProps {
  language: string;
  model: Model;
  voices: string[];
  speechSpeed: number;
  sayWordFirst: boolean;
  useInSentence: boolean;
  wordRepeatCount: number;
  sentenceRepeatCount: number;
  pauseDuration: number;
  vocabularyEntries: VocabularyEntry[];
  onReview: (entry: ListeningPracticeEntry) => void;
  onStop: () => void;
}

function ListeningPractice(props: ListeningPracticeProps): React.JSX.Element {
  const isMounted = useIsMounted();
  const model = React.useRef(props.model);
  const voices = React.useRef(props.voices);
  const speechSpeed = React.useRef(props.speechSpeed);
  const sayWordFirst = React.useRef(props.sayWordFirst);
  const useInSentence = React.useRef(props.useInSentence);
  const wordRepeatCount = React.useRef(props.wordRepeatCount);
  const sentenceRepeatCount = React.useRef(props.sentenceRepeatCount);
  const pauseDuration = React.useRef(props.pauseDuration);

  React.useCallback(() => { model.current = props.model; }, [props.model]);
  React.useCallback(() => { voices.current = props.voices; }, [props.voices]);
  React.useCallback(() => { speechSpeed.current = props.speechSpeed; }, [props.speechSpeed]);
  React.useCallback(() => { sayWordFirst.current = props.sayWordFirst; }, [props.sayWordFirst]);
  React.useCallback(() => { useInSentence.current = props.useInSentence; }, [props.useInSentence]);
  React.useCallback(() => { wordRepeatCount.current = props.wordRepeatCount; }, [props.wordRepeatCount]);
  React.useCallback(() => { sentenceRepeatCount.current = props.sentenceRepeatCount; }, [props.sentenceRepeatCount]);
  React.useCallback(() => { pauseDuration.current = props.pauseDuration; }, [props.pauseDuration]);

  const audioPlayer = useAudioPlayer<string>((v) => new Promise((resolve) => resolve(v)), (v) => v);
  const onStopAudio = React.useRef<(() => void) | null>(null);

  const activeListeningPracticeEntry = React.useRef<ListeningPracticeEntry | null>(null);
  const [isPaused, setIsPaused] = React.useState(false);
  const pausePromise = React.useRef<Promise<void> | null>(null);
  const resolvePausePromise = React.useRef<(() => void) | null>(null);
  const [isReviewed, setIsReviewed] = React.useState(false);

  const [error, setError] = React.useState(false);

  React.useEffect(
    () => {
      if (audioPlayer.playingAudioIdentifier === null && onStopAudio.current !== null) {
        const onStopAudioLocal = onStopAudio.current;
        onStopAudio.current = null;
        onStopAudioLocal();
      }
    },
    [audioPlayer.playingAudioIdentifier]);

  async function run(): Promise<void> {
    try {
      const readyVocabularyEntries = [...props.vocabularyEntries];
      const pendingVocabularyEntries: VocabularyEntry[] = [];

      function generateNextListeningPracticeEntry(): Promise<ListeningPracticeEntry> {
        const index = Math.floor(Math.random() * readyVocabularyEntries.length);
        const vocabularyEntry = readyVocabularyEntries.splice(index, 1)[0];
        pendingVocabularyEntries.push(vocabularyEntry);

        // Allow vocabulary entries to repeat once we've gone halfway through the list
        if (readyVocabularyEntries.length < pendingVocabularyEntries.length) {
          const nextReadyVocabularyEntry = pendingVocabularyEntries.shift();
          assert(nextReadyVocabularyEntry !== undefined);
          readyVocabularyEntries.push(nextReadyVocabularyEntry);
        }

        const voice = voices.current[Math.floor(Math.random() * voices.current.length)];
        return generateListeningPracticeEntry(props.language, model.current, voice, speechSpeed.current, vocabularyEntry.word, useInSentence.current);
      }

      let nextListeningPracticeEntryPromise = generateNextListeningPracticeEntry();
      while (true) {
        let listeningPracticeEntry: ListeningPracticeEntry;
        try {
          listeningPracticeEntry = await nextListeningPracticeEntryPromise;
        } catch {
          setError(true);
          return;
        }

        if (!isMounted.current) {
          return;
        }

        setIsReviewed(false);
        activeListeningPracticeEntry.current = listeningPracticeEntry;

        // Start generating the next listening entry while this one plays
        nextListeningPracticeEntryPromise = generateNextListeningPracticeEntry();

        const audioUrls: string[] = [];

        if (sayWordFirst.current) {
          for (let i = 0; i < wordRepeatCount.current; i++) {
            audioUrls.push(listeningPracticeEntry.wordAudioUrl);
          }
        }

        if (listeningPracticeEntry.sentenceAudioUrl !== null) {
          for (let i = 0; i < sentenceRepeatCount.current; i++) {
            audioUrls.push(listeningPracticeEntry.sentenceAudioUrl);
          }
        }

        if (!sayWordFirst.current) {
          for (let i = 0; i < wordRepeatCount.current; i++) {
            audioUrls.push(listeningPracticeEntry.wordAudioUrl);
          }
        }

        for (const audioUrl of audioUrls) {
          await new Promise<void>(
            (resolve) => {
              onStopAudio.current = resolve;
              audioPlayer.playAudio(audioUrl);
            });

          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (!isMounted.current) {
            return;
          }

          await sleep(pauseDuration.current * 1000);

          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (!isMounted.current) {
            return;
          }

          if (pausePromise.current !== null) {
            await pausePromise.current;
          }

          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (!isMounted.current) {
            return;
          }
        }
      }
    } finally {
      if (isMounted.current) {
        audioPlayer.stopAudio();
      }
    }
  }

  function handleDetectGesture(gesture: Gesture): void {
    if (gesture === "SpinClockwise" || gesture === "SpinCounterClockwise") {
      if (!isReviewed && activeListeningPracticeEntry.current !== null) {
        props.onReview(activeListeningPracticeEntry.current);
        setIsReviewed(true);
      }
    } else if (gesture === "Tap") {
      if (pausePromise.current !== null) {
        assert(resolvePausePromise.current !== null);
        resolvePausePromise.current();
        pausePromise.current = null;
        resolvePausePromise.current = null;
        setIsPaused(false);
      } else {
        assert(resolvePausePromise.current === null);
        pausePromise.current = new Promise<void>((resolve) => { resolvePausePromise.current = resolve; });
        setIsPaused(true);
      }
    }
  }

  React.useEffect(
    () => void run(),
    []);

  const displayMessage = React.useMemo(
    () => {
      const messageParts = [
        error ? "Error" : null,
        isPaused ? "Paused" : null,
        isReviewed ? "Review added" : null,
      ];

      return messageParts.filter((v) => v !== null).join("\n");
    },
    [error, isPaused, isReviewed]);

  return createPortal(
    <GestureScreen onDetectGesture={handleDetectGesture} message={displayMessage}>
      <Button
        type="button"
        appearance="Standard"
        color="Gray"
        text="Stop"
        onClick={props.onStop}
      />
    </GestureScreen>,
    document.body);
}

export async function showListeningPracticeDialog(
  language: string,
  voices: Map<string, ListVoicesApiResponseVoice[]>,
  vocabularyEntries: VocabularyEntry[],
): Promise<void> {
  await showDialog(
    (dialogProps) => {
      const languageVoices = voices.get(language) ?? doThrow(new Error(`Voices for language ${language} not provided`));

      const [model, setModel] = useLocalStorageState("listeningPracticeModel", (v) => v as Model, defaultModel);
      const [selectedVoices, setSelectedVoices] = useLocalStorageState(`listeningPracticeVoices-${language}`, (v) => v.split(","), []);
      const [speechSpeed, setSpeechSpeed] = useLocalStorageState("listeningPracticeSpeechSpeed", (v) => parseInt(v), 100);

      const [sayWordFirst, setSayWordFirst] = useLocalStorageState("listeningPracticeSayWordFirst", (v) => v.trim().toLowerCase() === "true", true);
      const [useInSentence, setUseInSentence] = useLocalStorageState("listeningPracticeUseInSentence", (v) => v.trim().toLowerCase() === "true", true);
      const [wordRepeatCount, setWordRepeatCount] = useLocalStorageState("listeningPracticeWordRepeatCount", (v) => parseInt(v), 1);
      const [sentenceRepeatCount, setSentenceRepeatCount] = useLocalStorageState("listeningPracticeSentenceRepeatCount", (v) => parseInt(v), 1);
      const [pauseDuration, setPauseDuration] = useLocalStorageState("listeningPracticePauseDuration", (v) => parseFloat(v), 2);

      const [playing, setPlaying] = React.useState(false);
      const reviews = React.useRef<ListeningPracticeEntry[]>([]);

      React.useLayoutEffect(
        () => {
          if (selectedVoices.length === 0) {
            setSelectedVoices([languageVoices[0].name]);
          }
        },
        []);

      function setVoiceSelected(voice: string, selected: boolean): void {
        const newSelectedVoices = selectedVoices.filter((v) => v !== voice);
        if (selected) {
          newSelectedVoices.push(voice);
        }

        setSelectedVoices(newSelectedVoices);
      }

      function handleClickPlayStopAudio(): void {
        if (!playing) {
          setPlaying(true);
        }
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
          <div className="listening-practice-settings">
            <div className="label">Model</div>
            <Select value={model} onChange={(e) => setModel(e.target.value as Model)}>
              {modelValues.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
            {
              languageVoices.map(
                (voice) => (
                  <React.Fragment key={voice.name}>
                    <div />
                    <label>
                      <Checkbox
                        checked={selectedVoices.includes(voice.name)}
                        onChange={(v) => setVoiceSelected(voice.name, v)}
                        disabled={selectedVoices.includes(voice.name) && selectedVoices.length === 1} // Don't allow disabling of the last voice
                      />
                      {voice.name}
                    </label>
                  </React.Fragment>
                ))
            }
            <div className="label">Speech speed</div>
            <Select value={speechSpeed} onChange={(e) => setSpeechSpeed(parseInt(e.target.value))}>
              {speechSpeedValues.map((v) => <option key={v} value={v}>{`${v}%`}</option>)}
            </Select>
            <div />
            <label>
              <Checkbox checked={sayWordFirst} onChange={setSayWordFirst} />
              Say word first
            </label>
            <div />
            <label>
              <Checkbox checked={useInSentence} onChange={setUseInSentence} />
              Use in sentence
            </label>
            <div className="label">Repeat word</div>
            <Select value={wordRepeatCount} onChange={(e) => setWordRepeatCount(parseInt(e.target.value))}>
              {repeatCounts.map((v) => <option key={v} value={v}>{v} {v === 1 ? "time" : "times"}</option>)}
            </Select>
            <div className="label">Repeat sentence</div>
            <Select value={sentenceRepeatCount} onChange={(e) => setSentenceRepeatCount(parseInt(e.target.value))}>
              {repeatCounts.map((v) => <option key={v} value={v}>{v} {v === 1 ? "time" : "times"}</option>)}
            </Select>
            <div className="label">Pause duration</div>
            <Select value={pauseDuration} onChange={(e) => setPauseDuration(parseFloat(e.target.value))}>
              {pauseDurations.map((v) => <option key={v} value={v}>{v} sec</option>)}
            </Select>
            <div className="controls">
              <Button
                className="start-button"
                type="button"
                appearance="IconOnly"
                color="Primary"
                icon={playing ? faCircleStop : faCirclePlay}
                tooltip={playing ? "Stop audio" : "Play audio"}
                onClick={handleClickPlayStopAudio}
              />
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
          {
            playing && (
              <ListeningPractice
                language={language}
                model={model}
                voices={selectedVoices}
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