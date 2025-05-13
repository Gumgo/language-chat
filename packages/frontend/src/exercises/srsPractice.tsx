import { ListVoicesApiResponseVoice, speech } from "api";
import { Button } from "components/button";
import { GestureScreen, GestureScreenBottomControls, GestureScreenGestureAreaContent, useGestureDetector } from "components/gestureScreen";
import { DataState, GrammarRuleEntry, VocabularyEntry } from "dataState";
import { SrsPracticeSettings } from "exercises/srsPracticeTypes";
import { GrammarRuleSentenceGenerator, Sentence } from "exercises/grammarRuleSentenceGenerator";
import * as React from "react";
import { activeSpeechService } from "speechService";
import { assert, doThrow } from "utilities/errors";
import { logError, logInfo } from "utilities/logger";
import { shuffle } from "utilities/shuffle";
import { useUrlAudioPlayer } from "utilities/useAudioPlayer";
import { useIsMounted } from "utilities/useIsMounted";
import { useRefLazy } from "utilities/useRefLazy";
import { useRepeatableAction } from "utilities/useRepeatableAction";
import { useStateRef } from "utilities/useStateRef";
import { classNames } from "utilities/utilities";

const practiceWordCount = 20;
const fillerWordCount = 200;

class FillerChooser {
  private readonly items: string[];

  public constructor(items: string[]) {
    // Make a copy of the list so we can modify the order
    this.items = [...items];
  }

  public choose(count: number, itemsToAvoid: string[]): string[] {
    const itemsToAvoidSet = new Set(itemsToAvoid);
    const results: string[] = [];
    let attemptCount = 0;
    while (results.length < count && attemptCount < this.items.length) {
      const index = Math.floor(Math.random() * (this.items.length - attemptCount));
      const item = this.items[index];

      const swapIndex = this.items.length - attemptCount - 1;
      [this.items[index], this.items[swapIndex]] = [this.items[swapIndex], this.items[index]];

      if (!itemsToAvoidSet.has(item)) {
        results.push(item);
      }

      attemptCount++;
    }

    return results;
  }
}

interface GrammarRulePracticeProps {
  language: string;
  voices: ListVoicesApiResponseVoice[];
  settings: SrsPracticeSettings;
  dataState: DataState;
  onStop: () => void;
}

export function SrsPractice(props: GrammarRulePracticeProps): React.JSX.Element {
  const isMounted = useIsMounted();

  const [speechSpeedState, speechSpeedRef, setSpeechSpeed] = useStateRef(props.settings.speechSpeed);

  const remainingSrsWords = useRefLazy(() => [...props.settings.srsWords]);
  const remainingSrsGrammarRules = useRefLazy(() => [...props.settings.srsGrammarRules]);

  const [remainingSrsWordCount, setRemainingSrsWordCount] = React.useState(remainingSrsWords.current.length);
  const [remainingSrsGrammarRuleCount, setRemainingSrsGrammarRuleCount] = React.useState(remainingSrsGrammarRules.current.length);

  const fillerWordChooser = useRefLazy(() => new FillerChooser(props.settings.allWords.map((v) => v.word)));

  const [locking, setLocking] = React.useState(false);
  const [lockedWordState, lockedWordRef, setLockedWord] = useStateRef<VocabularyEntry | null>(null);
  const [lockedGrammarRuleState, lockedGrammarRuleRef, setLockedGrammarRule] = useStateRef<GrammarRuleEntry | null>(null);

  const srsDate = useRefLazy(() => new Date());

  const [displayMessage, setDisplayMessage] = React.useState("");
  const audioPlayer = useUrlAudioPlayer();

  const gestureDetectorData = useGestureDetector();

  const [revealedGrammarRule, setRevealedGrammarRule] = React.useState<GrammarRuleEntry | null>(null);
  const [revealedGrammarRuleIsSrs, setRevealedGrammarRuleIsSrs] = React.useState(false);
  const [revealedSentence, setRevealedSentence] = React.useState<Sentence | null>(null);
  const submitActionData = useRepeatableAction();

  const [grammarRuleSrsResultState, grammarRuleSrsResultRef, setGrammarRuleSrsResult] = useStateRef<boolean | null>(null);
  const [vocabularySrsResultsState, vocabularySrsResultsRef, setVocabularySrsResults] = useStateRef<Map<string, boolean>>(new Map());

  interface GenerateNextSentenceResultData {
    sentence: Sentence;
    grammarRule: GrammarRuleEntry;
    isGrammarRuleSrs: boolean;
    lockedWord: VocabularyEntry | null;
    lockedGrammarRule: GrammarRuleEntry | null;
  }

  interface GenerateNextSentenceResult {
    result: "Success" | "NoMoreItems" | "BadGrammarRule" | "IncompatibleWords" | "BadGrammarRuleUsage" | "BadMeaning" | "Stop";
    errorGrammarRule?: GrammarRuleEntry; // Used to report grammar rule errors when the below data is not available
    data?: GenerateNextSentenceResultData;
  }

  async function generateNextSentence(
    currentRemainingSrsWords: VocabularyEntry[],
    currentRemainingSrsGrammarRules: GrammarRuleEntry[],
    currentLockedWord: VocabularyEntry | null,
    currentLockedGrammarRule: GrammarRuleEntry | null,
  ): Promise<GenerateNextSentenceResult> {
    if ((props.settings.wordPracticeMode === "Srs" || props.settings.grammarRulePracticeMode === "Srs")
      && currentRemainingSrsWords.length === 0
      && currentRemainingSrsGrammarRules.length === 0
      && currentLockedWord === null
      && currentLockedGrammarRule === null) {
      return { result: "NoMoreItems" };
    }

    let grammarRule: GrammarRuleEntry;
    let isGrammarRuleSrs: boolean;
    if (currentLockedGrammarRule !== null) {
      isGrammarRuleSrs = false;
      grammarRule = currentLockedGrammarRule;
    } else if (currentRemainingSrsGrammarRules.length > 0 && currentLockedWord === null) {
      // Choose an SRS grammar rule
      isGrammarRuleSrs = true;
      const grammarRuleIndex = Math.floor(Math.random() * currentRemainingSrsGrammarRules.length);
      grammarRule = currentRemainingSrsGrammarRules[grammarRuleIndex];
    } else if (props.settings.allGrammarRules.length > 0) {
      // Just choose a random grammar rule if no SRS items are available or if we're using a locked word
      isGrammarRuleSrs = false;
      const grammarRuleIndex = Math.floor(Math.random() * props.settings.allGrammarRules.length);
      grammarRule = props.settings.allGrammarRules[grammarRuleIndex];
    } else {
      return { result: "NoMoreItems" };
    }

    // Prioritize SRS words and then choose filler words otherwise
    let practiceWords: string[];
    if (currentLockedGrammarRule !== null) {
      // Don't do SRS words if we're locking a grammar rule, just let the user endlessly practice without consequence
      practiceWords = [];
    } else if (currentLockedWord !== null) {
      // Always select this one word (below, we'll switch it over to being LockedWord so it doesn't count against SRS)
      practiceWords = [currentLockedWord.word];
    } else {
      // Choose some random possible SRS words
      practiceWords = shuffle(currentRemainingSrsWords).map((v) => v.word).slice(0, practiceWordCount); // This is inefficient but convenient
    }

    const fillerWords = fillerWordChooser.current.choose(fillerWordCount, practiceWords);

    const sentenceGenerator = new GrammarRuleSentenceGenerator(props.language, props.settings.model, grammarRule, practiceWords, fillerWords);

    const generateSentenceResult = await sentenceGenerator.generateSentence();
    if (generateSentenceResult !== "Success") {
      return { result: generateSentenceResult, errorGrammarRule: grammarRule };
    }

    if (!isMounted.current) {
      return { result: "Stop" };
    }

    if (!await sentenceGenerator.reviewGrammarRuleUsage()) {
      return { result: "BadGrammarRuleUsage", errorGrammarRule: grammarRule };
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!isMounted.current) {
      return { result: "Stop" };
    }

    if (!await sentenceGenerator.reviewMeaning()) {
      return { result: "BadMeaning", errorGrammarRule: grammarRule };
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

    if (currentLockedWord !== null) {
      // If we have a word locked, that word was prioritized as a PracticeWord so that it would get chosen, but it shouldn't count against SRS
      for (const part of sentence.languageSentenceParts) {
        if (part.type === "PracticeWord") {
          part.type = "LockedWord";
        }
      }
    }

    return {
      result: "Success",
      data: {
        sentence,
        grammarRule,
        isGrammarRuleSrs,
        lockedWord: currentLockedWord,
        lockedGrammarRule: currentLockedGrammarRule,
      },
    };
  }

  async function generateNextSentenceWithRetries(
    currentRemainingSrsWords: VocabularyEntry[],
    currentRemainingSrsGrammarRules: GrammarRuleEntry[],
    currentLockedWord: VocabularyEntry | null,
    currentLockedGrammarRule: GrammarRuleEntry | null,
  ): Promise<GenerateNextSentenceResult> {
    const maxFailedCount = 5;
    let failedCount = 0;
    while (true) {
      if (!isMounted.current) {
        return { result: "Stop" };
      }

      const result = await generateNextSentence(currentRemainingSrsWords, currentRemainingSrsGrammarRules, currentLockedWord, currentLockedGrammarRule);
      switch (result.result) {
      case "Success":
      case "NoMoreItems":
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

  async function runSingle(generateSentenceResult: GenerateNextSentenceResultData): Promise<boolean> {
    const sentence = generateSentenceResult.sentence;
    const grammarRule = generateSentenceResult.grammarRule;

    const languageSentenceForSpeech = sentence.languageSentenceParts.map((v) => v.content).join("");
    const voice = props.voices[Math.floor(Math.random() * props.voices.length)];

    setDisplayMessage("Generating...");

    let currentSpeechSpeed = speechSpeedRef.current;
    let speechResponse = await speech(
      {
        language: props.language,
        service: activeSpeechService,
        voice: voice.name,
        speed: currentSpeechSpeed,
        message: languageSentenceForSpeech,
        ssml: false,
      });

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
          setRevealedGrammarRule(grammarRule);
          setRevealedGrammarRuleIsSrs(generateSentenceResult.isGrammarRuleSrs);
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
            speechResponse = await speech(
              {
                language: props.language,
                service: activeSpeechService,
                voice: voice.name,
                speed: currentSpeechSpeed,
                message: languageSentenceForSpeech,
                ssml: false,
              });
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

    setRevealedGrammarRule(null);
    setRevealedGrammarRuleIsSrs(false);
    setRevealedSentence(null);

    for (const part of sentence.languageSentenceParts) {
      if (part.type === "PracticeWord") {
        const wordIndex = remainingSrsWords.current.findIndex((v) => v.word === part.unmodifiedWord);
        remainingSrsWords.current.splice(wordIndex, 1);
      }
    }

    for (const [word, passed] of [...vocabularySrsResultsRef.current]) {
      await props.dataState.addVocabularyEntrySrsReview(props.language, word, srsDate.current, passed);
    }

    if (generateSentenceResult.isGrammarRuleSrs) {
      remainingSrsGrammarRules.current.splice(remainingSrsGrammarRules.current.indexOf(grammarRule), 1);

      if (grammarRuleSrsResultRef.current !== null) {
        await props.dataState.addGrammarRuleEntrySrsReview(props.language, grammarRule.id, srsDate.current, grammarRuleSrsResultRef.current);
      }
    }

    setRemainingSrsWordCount(remainingSrsWords.current.length);
    setRemainingSrsGrammarRuleCount(remainingSrsGrammarRules.current.length);

    setVocabularySrsResults(new Map());
    setGrammarRuleSrsResult(null);

    return true;
  }

  async function run(): Promise<void> {
    let generatePromise = generateNextSentenceWithRetries(
      [...remainingSrsWords.current],
      [...remainingSrsGrammarRules.current],
      lockedWordRef.current,
      lockedGrammarRuleRef.current);
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
          assert(result.data !== undefined);

          {
            // Start generating the next sentence so it can run in the background. Since we're starting generation before we've gotten the result, assume that
            // SRS items were removed from the queue.
            const data = result.data;
            const srsWords = new Set(result.data.sentence.languageSentenceParts.filter((v) => v.type === "PracticeWord").map((v) => v.unmodifiedWord));
            const newRemainingSrsWords = remainingSrsWords.current.filter((word) => !srsWords.has(word.word));
            const newRemainingGrammarRules = data.isGrammarRuleSrs
              ? remainingSrsGrammarRules.current.filter((rule) => rule !== data.grammarRule)
              : [...remainingSrsGrammarRules.current];
            generatePromise = generateNextSentenceWithRetries(
              newRemainingSrsWords,
              newRemainingGrammarRules,
              lockedWordRef.current,
              lockedGrammarRuleRef.current);
          }

          if (result.data.lockedWord !== lockedWordRef.current || result.data.lockedGrammarRule !== lockedGrammarRuleRef.current) {
            // The locked word changed so regenerate a new sentence.
            // $TODO can we get this to trigger sooner? Right now whenever you lock/unlock a word, generation won't begin until you actually move onto the next
            // entry.
            break;
          }

          if (!await runSingle(result.data)) {
            return;
          }

          break;

        case "NoMoreItems":
          setDisplayMessage("No more items to practice");
          return;

        case "BadGrammarRule":
          assert(result.errorGrammarRule !== undefined);
          setDisplayMessage(`Invalid grammar rule: ${result.errorGrammarRule.name}`);
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

  function handleClickLockButton(): void {
    if (lockedWordState !== null || lockedGrammarRuleState !== null) {
      setLockedWord(null);
      setLockedGrammarRule(null);
    } else {
      setLocking(!locking);
    }
  }

  function handleStop(): void {
    gestureDetectorData.handleStopGestureDetection();
    props.onStop();
  }

  const grammarRuleClassNames: string[] = [];
  if (!revealedGrammarRuleIsSrs) {
    grammarRuleClassNames.push("filler");
  } else if (grammarRuleSrsResultState === null) {
    grammarRuleClassNames.push("unresolved");
  } else {
    grammarRuleClassNames.push(grammarRuleSrsResultState ? "passed" : "failed");
  }

  if (lockedGrammarRuleState !== null && lockedGrammarRuleState === revealedGrammarRule) {
    grammarRuleClassNames.push("locked");
  }

  function handleClickGrammarRule(): void {
    if (locking) {
      setLocking(false);
      setLockedWord(null);
      setLockedGrammarRule(revealedGrammarRule);
    } else if (revealedGrammarRuleIsSrs) {
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
          (props.settings.wordPracticeMode === "Srs" || props.settings.grammarRulePracticeMode === "Srs") && (
            <div className="srs-practice-counter">
              Remaining word reviews: {remainingSrsWordCount}
              <br />
              Remaining grammar rule reviews: {remainingSrsGrammarRuleCount}
            </div>
          )
        }
        {
          revealedSentence !== null && (
            <div className="srs-practice-revealed-content">
              <span className={classNames("grammar-rule-name", "highlighted-item", ...grammarRuleClassNames)} onClick={handleClickGrammarRule}>
                {revealedGrammarRule?.name}
              </span>
              <div className="language-sentence">
                {
                  revealedSentence.languageSentenceParts.map(
                    (v, i) => {
                      if (v.type !== "Text") {
                        const unmodifiedWord = v.unmodifiedWord;
                        assert(unmodifiedWord !== undefined);
                        const srsResult = vocabularySrsResultsState.get(unmodifiedWord);
                        const wordClassNames: string[] = [];
                        if (v.type === "FillerWord" || v.type === "LockedWord") {
                          wordClassNames.push("filler");
                        } else if (srsResult === undefined) {
                          wordClassNames.push("unresolved");
                        } else {
                          wordClassNames.push(srsResult ? "passed" : "failed");
                        }

                        if (lockedWordState !== null && lockedWordState.word === v.unmodifiedWord) {
                          wordClassNames.push("locked");
                        }

                        function handleClick(): void {
                          assert(unmodifiedWord !== undefined);
                          if (locking) {
                            const vocabularyEntry = props.settings.srsWords.find((entry) => entry.word === unmodifiedWord)
                              ?? props.settings.allWords.find((entry) => entry.word === unmodifiedWord)
                              ?? doThrow(new Error("Vocabulary entry not found"));
                            setLocking(false);
                            setLockedWord(vocabularyEntry);
                            setLockedGrammarRule(null);
                          } else if (v.type === "PracticeWord") {
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
                        }

                        return (
                          <span
                            key={i}
                            className={classNames("highlighted-item", ...wordClassNames)}
                            onClick={handleClick}
                            title={v.unmodifiedWord}
                          >
                            {v.content}
                          </span>
                        );
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
        <div className="srs-practice-speech-speed">
          Speed: {speechSpeedState}%
        </div>
        <Button
          type="button"
          appearance="Standard"
          color="Gray"
          text={lockedWordState !== null || lockedGrammarRuleState !== null ? "Unlock" : (locking ? "Cancel" : "Lock")}
          onClick={handleClickLockButton}
        />
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