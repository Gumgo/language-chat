import { chat, Model, speech } from "api";
import { Button } from "components/button";
import { Gesture, GestureScreen, GestureScreenBottomControls } from "components/gestureScreen";
import { VocabularyEntry } from "dataState";
import { getUseWordInSentenceProp } from "prompts";
import * as React from "react";
import { createPortal } from "react-dom";
import { assert } from "utilities/errors";
import { generateIsolatedWordSpeechUrl } from "utilities/speechUtilities";
import { useAudioPlayer } from "utilities/useAudioPlayer";
import { useIsMounted } from "utilities/useIsMounted";
import { sleep } from "utilities/utilities";

const useInSentenceTemperature = 1;

export interface ListeningPracticeEntry {
  word: string;
  wordAudioUrl: string;
  sentence: string | null;
  sentenceAudioUrl: string | null;
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

export function ListeningPractice(props: ListeningPracticeProps): React.JSX.Element {
  const isMounted = useIsMounted();

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

        const voice = props.voices[Math.floor(Math.random() * props.voices.length)];
        return generateListeningPracticeEntry(props.language, props.model, voice, props.speechSpeed, vocabularyEntry.word, props.useInSentence);
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

        if (props.sayWordFirst) {
          for (let i = 0; i < props.wordRepeatCount; i++) {
            audioUrls.push(listeningPracticeEntry.wordAudioUrl);
          }
        }

        if (listeningPracticeEntry.sentenceAudioUrl !== null) {
          for (let i = 0; i < props.sentenceRepeatCount; i++) {
            audioUrls.push(listeningPracticeEntry.sentenceAudioUrl);
          }
        }

        if (!props.sayWordFirst) {
          for (let i = 0; i < props.wordRepeatCount; i++) {
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

          await sleep(props.pauseDuration * 1000);

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
      <GestureScreenBottomControls>
        <Button
          type="button"
          appearance="Standard"
          color="Gray"
          text="Stop"
          onClick={props.onStop}
        />
      </GestureScreenBottomControls>
    </GestureScreen>,
    document.body);
}