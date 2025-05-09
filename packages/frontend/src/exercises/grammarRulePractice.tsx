import { Model, speech } from "api";
import { Button } from "components/button";
import { GestureScreen, GestureScreenBottomControls, GestureScreenGestureAreaContent, useGestureDetector } from "components/gestureScreen";
import { DataState, GrammarRuleEntry, VocabularyEntry } from "dataState";
import { GrammarRulePracticeMode } from "exercises/grammarRulePracticeTypes";
import { GrammarRuleSentenceGenerator, Sentence } from "exercises/grammarRuleSentenceGenerator";
import * as React from "react";
import { assert } from "utilities/errors";
import { logError, logInfo } from "utilities/logger";
import { shuffle } from "utilities/shuffle";
import { calculateSrsStats } from "utilities/srs";
import { useUrlAudioPlayer } from "utilities/useAudioPlayer";
import { useIsMounted } from "utilities/useIsMounted";
import { useRefLazy } from "utilities/useRefLazy";
import { useRepeatableAction } from "utilities/useRepeatableAction";
import { useStateRef } from "utilities/useStateRef";
import { classNames } from "utilities/utilities";

const practiceWordCount = 20;
const fillerWordCount = 200;

class FillerWordChooser {
  private readonly vocabularyEntries: VocabularyEntry[];

  public constructor(vocabularyEntries: VocabularyEntry[]) {
    // Make a copy of the list so we can modify the order
    this.vocabularyEntries = [...vocabularyEntries];
  }

  public chooseFillerWords(count: number, wordsToAvoid: string[]): string[] {
    const wordsToAvoidSet = new Set(wordsToAvoid);
    const results: string[] = [];
    let attemptCount = 0;
    while (results.length < count && attemptCount < this.vocabularyEntries.length) {
      const index = Math.floor(Math.random() * (this.vocabularyEntries.length - attemptCount));
      const entry = this.vocabularyEntries[index];

      const swapIndex = this.vocabularyEntries.length - attemptCount - 1;
      const temp = this.vocabularyEntries[swapIndex];
      this.vocabularyEntries[swapIndex] = this.vocabularyEntries[index];
      this.vocabularyEntries[index] = temp;

      if (!wordsToAvoidSet.has(entry.word)) {
        results.push(entry.word);
      }

      attemptCount++;
    }

    return results;
  }
}

interface GrammarRulePracticeProps {
  language: string;
  model: Model;
  voices: string[];
  speechSpeed: number;
  grammarRules: GrammarRuleEntry[];
  words: VocabularyEntry[];
  grammarRulePracticeMode: GrammarRulePracticeMode;
  wordPracticeMode: GrammarRulePracticeMode;
  dataState: DataState;
  onStop: () => void;
}

export function GrammarRulePractice(props: GrammarRulePracticeProps): React.JSX.Element {
  const isMounted = useIsMounted();

  const [speechSpeedState, speechSpeedRef, setSpeechSpeed] = useStateRef(props.speechSpeed);

  const srsDate = useRefLazy(() => new Date());
  const remainingGrammarRules = useRefLazy(
    () => {
      if (props.grammarRulePracticeMode === "SrsPractice") {
        return props.grammarRules.filter(
          (v) => v.listeningSrsReviews.size > 0 && calculateSrsStats(v.listeningSrsReviews, srsDate.current).optimalDaysToNextReview <= 0);
      } else if (props.grammarRulePracticeMode === "SrsNew") {
        return props.grammarRules.filter((v) => v.listeningSrsReviews.size === 0);
      } else {
        return props.grammarRules;
      }
    });

  const remainingPracticeWords = useRefLazy(
    () => {
      if (props.wordPracticeMode === "SrsPractice") {
        return props.words.filter(
          (v) => v.listeningSrsReviews.size > 0 && calculateSrsStats(v.listeningSrsReviews, srsDate.current).optimalDaysToNextReview <= 0);
      } else if (props.wordPracticeMode === "SrsNew") {
        return props.words.filter((v) => v.listeningSrsReviews.size === 0);
      } else {
        return props.words;
      }
    });

  const fillerWordChooser = useRefLazy(() => new FillerWordChooser(props.words));

  const [displayMessage, setDisplayMessage] = React.useState("");
  const audioPlayer = useUrlAudioPlayer();

  const gestureDetectorData = useGestureDetector();

  const [grammarRuleName, setGrammarRuleName] = React.useState("");
  const [revealedSentence, setRevealedSentence] = React.useState<Sentence | null>(null);
  const submitActionData = useRepeatableAction();

  const [grammarRuleSrsResultState, grammarRuleSrsResultRef, setGrammarRuleSrsResult] = useStateRef<boolean | null>(null);
  const [vocabularySrsResultsState, vocabularySrsResultsRef, setVocabularySrsResults] = useStateRef<Map<string, boolean>>(new Map());

  interface GenerateNextSentenceResult {
    result: "Success" | "NoMoreGrammarRules" | "BadGrammarRule" | "IncompatibleWords" | "BadGrammarRuleUsage" | "BadMeaning" | "Stop";
    sentence?: Sentence;
    grammarRule?: GrammarRuleEntry;
  }

  async function generateNextSentence(): Promise<GenerateNextSentenceResult> {
    if (remainingGrammarRules.current.length === 0) {
      return { result: "NoMoreGrammarRules" };
    }

    const grammarRuleIndex = Math.floor(Math.random() * remainingGrammarRules.current.length);
    const grammarRule = remainingGrammarRules.current[grammarRuleIndex];

    const practiceWords = shuffle(remainingPracticeWords.current).map((v) => v.word); // This is inefficient but convenient
    if (practiceWords.length > practiceWordCount) {
      practiceWords.length = practiceWordCount;
    }

    const fillerWords = fillerWordChooser.current.chooseFillerWords(fillerWordCount, practiceWords);

    const sentenceGenerator = new GrammarRuleSentenceGenerator(props.language, props.model, grammarRule, practiceWords, fillerWords);

    const generateSentenceResult = await sentenceGenerator.generateSentence();
    if (generateSentenceResult !== "Success") {
      return { result: generateSentenceResult, grammarRule };
    }

    if (!isMounted.current) {
      return { result: "Stop" };
    }

    if (!await sentenceGenerator.reviewGrammarRuleUsage()) {
      return { result: "BadGrammarRuleUsage", grammarRule };
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!isMounted.current) {
      return { result: "Stop" };
    }

    if (!await sentenceGenerator.reviewMeaning()) {
      return { result: "BadMeaning", grammarRule };
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!isMounted.current) {
      return { result: "Stop" };
    }

    await sentenceGenerator.formatSentence();

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!isMounted.current) {
      return { result: "Stop" };
    }

    let sentence: Sentence | null = null;
    for (let attempt = 0; attempt < 3 && sentence === null; attempt++) {
      sentence = await sentenceGenerator.validateSentence();

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!isMounted.current) {
        return { result: "Stop" };
      }
    }

    if (sentence === null) {
      throw new Error("Generated sentence formatting failed");
    }

    if (props.grammarRulePracticeMode !== "RandomPractice") {
      remainingGrammarRules.current.splice(grammarRuleIndex, 1);
    }

    if (props.wordPracticeMode !== "RandomPractice") {
      for (const part of sentence.languageSentenceParts) {
        const wordIndex = remainingPracticeWords.current.findIndex((v) => v.word === part.unmodifiedWord);
        remainingPracticeWords.current.splice(wordIndex, 1);
      }
    }

    return { result: "Success", sentence, grammarRule };
  }

  async function generateNextSentenceWithRetries(): Promise<GenerateNextSentenceResult> {
    const maxFailedCount = 5;
    let failedCount = 0;
    while (true) {
      if (!isMounted.current) {
        return { result: "Stop" };
      }

      const result = await generateNextSentence();
      switch (result.result) {
      case "Success":
      case "NoMoreGrammarRules":
      case "BadGrammarRule":
      case "Stop":
        return result;

      case "IncompatibleWords":
      case "BadGrammarRuleUsage":
      case "BadMeaning":
        // Try again with new words
        logInfo(`Trying again due to: ${result.result}`);
        failedCount++;
        if (failedCount === maxFailedCount) {
          return result;
        }

        break;
      }
    }
  }

  async function runSingle(generateSentenceResult: GenerateNextSentenceResult): Promise<boolean> {
    const sentence = generateSentenceResult.sentence;
    assert(sentence !== undefined);

    const grammarRule = generateSentenceResult.grammarRule;
    assert(grammarRule !== undefined);

    const languageSentenceForSpeech = sentence.languageSentenceParts.map((v) => v.content).join("");
    const voice = props.voices[Math.floor(Math.random() * props.voices.length)];

    setDisplayMessage("Generating...");

    let currentSpeechSpeed = speechSpeedRef.current;
    let speechResponse = await speech({ language: props.language, voice, speed: currentSpeechSpeed, message: languageSentenceForSpeech, ssml: false });

    setDisplayMessage("");

    audioPlayer.playAudio(speechResponse.audioUrl);

    let done = false;
    while (!done) {
      const gestureCount = gestureDetectorData.gestureCount.current;
      const submitCount = submitActionData.actionCount.current;
      const gesturePromise = gestureDetectorData.gesturePromise.current; // Make a local copy so we can await it below. Otherwise, we'll await a new promise.
      await Promise.any([gesturePromise, submitActionData.actionPromise.current]);
      if (gestureDetectorData.gestureCount.current > gestureCount) {
        const gesture = await gesturePromise;
        switch (gesture) {
        case null:
          return false;

        case "Tap":
          setGrammarRuleName(grammarRule.name);
          setRevealedSentence(sentence);
          break;

        case "SwipeLeft":
        case "SwipeRight":
          // Nothing to do
          break;

        case "SwipeUp":
          setSpeechSpeed(Math.min(speechSpeedRef.current + 5, 100));
          break;

        case "SwipeDown":
          setSpeechSpeed(Math.max(speechSpeedRef.current - 5, 50));
          break;

        case "SpinClockwise":
        case "SpinCounterClockwise":
          if (currentSpeechSpeed !== speechSpeedRef.current) {
            setDisplayMessage("Generating...");
            currentSpeechSpeed = speechSpeedRef.current;
            speechResponse = await speech({ language: props.language, voice, speed: currentSpeechSpeed, message: languageSentenceForSpeech, ssml: false });
            setDisplayMessage("");

            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (!isMounted.current) {
              return false;
            }
          }

          // Replay the audio clip
          audioPlayer.stopAudio();
          audioPlayer.playAudio(speechResponse.audioUrl);
          break;
        }
      } else if (submitActionData.actionCount.current > submitCount) {
        done = true;
      }
    }

    setGrammarRuleName("");
    setRevealedSentence(null);

    if (props.grammarRulePracticeMode !== "RandomPractice") {
      if (grammarRuleSrsResultRef.current !== null) {
        await props.dataState.addGrammarRuleEntrySrsReview(props.language, grammarRule.id, srsDate.current, grammarRuleSrsResultRef.current);
      }
    }

    if (props.wordPracticeMode !== "RandomPractice") {
      for (const [word, passed] of [...vocabularySrsResultsRef.current]) {
        await props.dataState.addVocabularyEntrySrsReview(props.language, word, srsDate.current, passed);
      }
    }

    setVocabularySrsResults(new Map());
    setGrammarRuleSrsResult(null);

    return true;
  }

  async function run(): Promise<void> {
    let generatePromise = generateNextSentenceWithRetries();
    while (true) {
      if (!isMounted.current) {
        return;
      }

      try {
        setDisplayMessage("Generating...");
        const result = await generatePromise;
        setDisplayMessage("");

        switch (result.result) {
        case "Success":
          // Start generating the next sentence so it can run in the background
          generatePromise = generateNextSentenceWithRetries();
          if (!await runSingle(result)) {
            return;
          }

          break;

        case "NoMoreGrammarRules":
          setDisplayMessage("No more grammar rules to practice");
          return;

        case "BadGrammarRule":
          assert(result.grammarRule !== undefined);
          setDisplayMessage(`Invalid grammar rule: ${result.grammarRule.name}`);
          return;

        case "IncompatibleWords":
          setDisplayMessage("Failed to choose compatible words");
          return;

        case "BadGrammarRuleUsage":
          setDisplayMessage("Failed to generate sentence with proper grammar rule usage");
          return;

        case "BadMeaning":
          setDisplayMessage("Failed to generate meaningful sentence");
          return;

        case "Stop":
          return;
        }
      } catch (error) {
        logError(error);
        setDisplayMessage("Error");
        return;
      }
    }
  }

  function handleClickSubmit(): void {
    submitActionData.handleAction(null);
  }

  function handleStop(): void {
    gestureDetectorData.handleStopGestureDetection();
    props.onStop();
  }

  let grammarRuleNameClassName: string | null = null;
  if (grammarRuleSrsResultState === true) {
    grammarRuleNameClassName = "passed";
  } else if (grammarRuleSrsResultState === false) {
    grammarRuleNameClassName = "failed";
  }

  function handleClickGrammarRuleName(): void {
    switch (grammarRuleSrsResultState) {
    case null:
      setGrammarRuleSrsResult(false);
      break;

    case false:
      setGrammarRuleSrsResult(true);
      break;

    case true:
      setGrammarRuleSrsResult(null);
      break;
    }
  }

  React.useEffect(
    () => {
      async function runInner(): Promise<void> {
        try {
          await run();
        } catch (error) {
          logError((error as Error).message);
          setDisplayMessage("Error");
        }
      }

      void runInner();
    },
    []);

  return (
    <GestureScreen onDetectGesture={gestureDetectorData.handleDetectGesture} message={displayMessage}>
      <GestureScreenGestureAreaContent>
        {
          revealedSentence !== null && (
            <div className="grammar-rule-practice-revealed-content">
              <span className={classNames("grammar-rule-name", "srs-item", grammarRuleNameClassName)} onClick={handleClickGrammarRuleName}>
                {grammarRuleName}
              </span>
              <div className="language-sentence">
                {
                  revealedSentence.languageSentenceParts.map(
                    (v, i) => {
                      if (v.type === "PracticeWord") {
                        const unmodifiedWord = v.unmodifiedWord;
                        assert(unmodifiedWord !== undefined);
                        const srsResult = vocabularySrsResultsState.get(unmodifiedWord);
                        const className = srsResult === undefined
                          ? undefined
                          : (srsResult ? "passed" : "failed");

                        function handleClick(): void {
                          assert(unmodifiedWord !== undefined);
                          const newVocabularySrsResults = new Map(vocabularySrsResultsState);
                          switch (srsResult) {
                          case undefined:
                            newVocabularySrsResults.set(unmodifiedWord, false);
                            break;

                          case false:
                            newVocabularySrsResults.set(unmodifiedWord, true);
                            break;

                          case true:
                            newVocabularySrsResults.delete(unmodifiedWord);
                            break;
                          }

                          setVocabularySrsResults(newVocabularySrsResults);
                        }

                        return <span key={i} className={classNames("srs-item", className)} onClick={handleClick} title={v.unmodifiedWord}>{v.content}</span>;
                      } else {
                        return <span key={i}>{v.content}</span>;
                      }
                    })
                }
              </div>
              <hr />
              <div className="english-sentence">{revealedSentence.englishSentence}</div>
              <Button type="button" appearance="Standard" color="Primary" className="submit-button" onClick={handleClickSubmit}>Submit</Button>
            </div>
          )
        }
      </GestureScreenGestureAreaContent>
      <GestureScreenBottomControls>
        <div className="grammar-rule-practice-speech-speed">
          Speed: {speechSpeedState}%
        </div>
        <Button
          type="button"
          appearance="Standard"
          color="Gray"
          text="Stop"
          onClick={handleStop}
        />
      </GestureScreenBottomControls>
    </GestureScreen>
  );
}