import { ListVoicesApiResponseVoice, speech, SpeechApiResponse } from "api";
import { Button } from "components/button";
import { GestureScreen, GestureScreenBottomControls, GestureScreenGestureAreaContent, useGestureDetector } from "components/gestureScreen";
import { DataState, GrammarRuleEntry, VocabularyEntry } from "dataState";
import { SrsPracticeSettings } from "exercises/srsPracticeTypes";
import { generateGrammarRuleSentence, GenerateGrammarRuleSentenceResult, SentencePart } from "exercises/grammarRuleSentenceGenerator";
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

const isolatedWordsBreakTime = "300ms";

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

class SpeechClip {
  private readonly language: string;
  private readonly text: string;
  private readonly ssml: boolean;
  private currentVoice: string;
  private currentSpeechSpeed: number;
  private lastSetVoice: string;
  private lastSetSpeechSpeed: number;
  private speechResponse: SpeechApiResponse | null = null;

  public constructor(language: string, text: string, ssml: boolean, voice: string, speechSpeed: number) {
    this.language = language;
    this.text = text;
    this.ssml = ssml;
    this.currentVoice = voice;
    this.currentSpeechSpeed = speechSpeed;
    this.lastSetVoice = voice;
    this.lastSetSpeechSpeed = speechSpeed;
  }

  public set voice(voice: string) {
    this.lastSetVoice = voice;
  }

  public set speechSpeed(speechSpeed: number) {
    this.lastSetSpeechSpeed = speechSpeed;
  }

  public async get(): Promise<SpeechApiResponse> {
    if (this.speechResponse === null
      || this.currentVoice !== this.lastSetVoice
      || this.currentSpeechSpeed !== this.lastSetSpeechSpeed) {
      this.currentVoice = this.lastSetVoice;
      this.currentSpeechSpeed = this.lastSetSpeechSpeed;
      this.speechResponse = await speech(
        {
          language: this.language,
          service: activeSpeechService,
          voice: this.currentVoice,
          speed: this.currentSpeechSpeed,
          message: this.text,
          ssml: this.ssml,
        });
    }

    return this.speechResponse;
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

  interface GenerateNextSentenceResultData {
    sentence: string;
    englishSentence: string;
    sentenceParts: SentencePart[];
    sentenceWithIsolatedWords: string;
    grammarRule: GrammarRuleEntry;
    isGrammarRuleSrs: boolean;
    lockedWord: VocabularyEntry | null;
    lockedGrammarRule: GrammarRuleEntry | null;
  }

  interface GenerateNextSentenceResult {
    result: GenerateGrammarRuleSentenceResult;
    errorGrammarRule?: GrammarRuleEntry; // Used to report grammar rule errors when the below data is not available
    data?: GenerateNextSentenceResultData;
  }

  const [revealedData, setRevealedData] = React.useState<GenerateNextSentenceResultData | null>(null);
  const submitActionData = useRepeatableAction();

  const [grammarRuleSrsResultState, grammarRuleSrsResultRef, setGrammarRuleSrsResult] = useStateRef<boolean | null>(null);
  const [vocabularySrsResultsState, vocabularySrsResultsRef, setVocabularySrsResults] = useStateRef<Map<string, boolean>>(new Map());

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

    const [result, resultData] = await generateGrammarRuleSentence(
      props.language,
      props.settings.model,
      grammarRule,
      practiceWords,
      fillerWords,
      () => !isMounted.current);

    if (result !== "Success") {
      return { result, errorGrammarRule: grammarRule };
    }

    assert(resultData !== null);

    if (currentLockedWord !== null) {
      // If we have a word locked, that word was prioritized as a PracticeWord so that it would get chosen, but it shouldn't count against SRS
      for (const part of resultData.sentenceParts) {
        if (part.type === "PracticeWord") {
          part.type = "LockedWord";
        }
      }
    }

    return {
      result: "Success",
      data: {
        sentence: resultData.sentence,
        englishSentence: resultData.englishSentence,
        sentenceParts: resultData.sentenceParts,
        sentenceWithIsolatedWords: resultData.sentenceWithIsolatedWords,
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
        return { result: "Cancelled" };
      }

      const result = await generateNextSentence(currentRemainingSrsWords, currentRemainingSrsGrammarRules, currentLockedWord, currentLockedGrammarRule);
      switch (result.result) {
      case "Success":
      case "Cancelled":
      case "NoMoreItems":
      case "BadGrammarRule":
        return result;

      case "IncompatibleWords":
      case "BadGrammar":
      case "BadGrammarRuleUsage":
      case "BadMeaning":
        // Try again with new words
        logInfo(`Trying again due to: ${result.result}`);
        failedCount++;
        if (failedCount === maxFailedCount) {
          return result;
        }

        break;

      case "FinalizeRawSentenceFailed":
      case "FormatSentenceFailed":
      case "IsolateWordsFailed":
      case "UnexpectedError":
        return result;
      }
    }
  }

  async function runSingle(generateSentenceResult: GenerateNextSentenceResultData): Promise<boolean> {
    let voiceIndex = Math.floor(Math.random() * props.voices.length);
    let voice = props.voices[voiceIndex];

    const sentenceWithIsolatedWords = generateSentenceResult.sentenceWithIsolatedWords.replaceAll("|", `<break time="${isolatedWordsBreakTime}" />`);
    const speechClip = new SpeechClip(props.language, generateSentenceResult.sentence, false, voice.name, speechSpeedRef.current);
    const isolatedWordsSpeechClip = new SpeechClip(props.language, sentenceWithIsolatedWords, true, voice.name, speechSpeedRef.current);

    {
      setDisplayMessage("Generating...");
      const speechResponse = await speechClip.get();
      setDisplayMessage("");
      audioPlayer.playAudio(speechResponse.audioUrl);
    }

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
          setRevealedData(generateSentenceResult);
          break;

        case "SwipeLeft":
        case "SwipeRight":
          // Switch to a random voice which is different from the current voice (unless there's only one voice)
          if (props.voices.length > 1) {
            const newVoiceIndex = Math.floor(Math.random() * (props.voices.length - 1));
            voiceIndex = newVoiceIndex < voiceIndex
              ? newVoiceIndex
              : newVoiceIndex + 1;
            voice = props.voices[voiceIndex];
          }

          break;

        case "SwipeUp":
          setSpeechSpeed(Math.min(speechSpeedRef.current + 5, 100));
          break;

        case "SwipeDown":
          setSpeechSpeed(Math.max(speechSpeedRef.current - 5, 50));
          break;

        case "SpinClockwise":
        {
          speechClip.voice = voice.name;
          speechClip.speechSpeed = speechSpeedRef.current;

          setDisplayMessage("Generating...");
          const speechResponse = await speechClip.get();
          setDisplayMessage("");

          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (!isMounted.current) {
            return false;
          }

          // Replay the audio clip
          audioPlayer.stopAudio();
          audioPlayer.playAudio(speechResponse.audioUrl);
          break;
        }

        case "SpinCounterClockwise":
        {
          isolatedWordsSpeechClip.voice = voice.name;
          isolatedWordsSpeechClip.speechSpeed = speechSpeedRef.current;

          setDisplayMessage("Generating...");
          const speechResponse = await isolatedWordsSpeechClip.get();
          setDisplayMessage("");

          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (!isMounted.current) {
            return false;
          }

          // Replay the audio clip
          audioPlayer.stopAudio();
          audioPlayer.playAudio(speechResponse.audioUrl);
          break;
        }
        }
      } else if (submitActionData.actionCount.current > submitCount) {
        done = true;
      }
    }

    setRevealedData(null);

    for (const part of generateSentenceResult.sentenceParts) {
      if (part.type === "PracticeWord") {
        const wordIndex = remainingSrsWords.current.findIndex((v) => v.word === part.unmodifiedWord);
        remainingSrsWords.current.splice(wordIndex, 1);
      }
    }

    for (const [word, passed] of [...vocabularySrsResultsRef.current]) {
      await props.dataState.addVocabularyEntrySrsReview(props.language, word, srsDate.current, passed);
    }

    if (generateSentenceResult.isGrammarRuleSrs) {
      remainingSrsGrammarRules.current.splice(remainingSrsGrammarRules.current.indexOf(generateSentenceResult.grammarRule), 1);

      if (grammarRuleSrsResultRef.current !== null) {
        await props.dataState.addGrammarRuleEntrySrsReview(
          props.language,
          generateSentenceResult.grammarRule.id,
          srsDate.current,
          grammarRuleSrsResultRef.current);
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
            const srsWords = new Set(result.data.sentenceParts.filter((v) => v.type === "PracticeWord").map((v) => v.unmodifiedWord));
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

        case "Cancelled":
          return;

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

        case "BadGrammar":
          setDisplayMessage("Failed to generate sentence with proper grammar");
          return;

        case "BadGrammarRuleUsage":
          setDisplayMessage("Failed to generate sentence with proper grammar rule usage");
          return;

        case "BadMeaning":
          setDisplayMessage("Failed to generate meaningful sentence");
          return;

        case "FinalizeRawSentenceFailed":
          setDisplayMessage("Failed to finalize raw sentence");
          return;

        case "FormatSentenceFailed":
          setDisplayMessage("Failed to format sentence");
          return;

        case "IsolateWordsFailed":
          setDisplayMessage("Failed to isolate words");
          return;

        case "UnexpectedError":
          setDisplayMessage("Unexpected error");
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
  if (!(revealedData?.isGrammarRuleSrs ?? false)) {
    grammarRuleClassNames.push("filler");
  } else if (grammarRuleSrsResultState === null) {
    grammarRuleClassNames.push("unresolved");
  } else {
    grammarRuleClassNames.push(grammarRuleSrsResultState ? "passed" : "failed");
  }

  if (lockedGrammarRuleState !== null && revealedData !== null && lockedGrammarRuleState === revealedData.grammarRule) {
    grammarRuleClassNames.push("locked");
  }

  function handleClickGrammarRule(): void {
    if (revealedData === null) {
      return;
    }

    if (locking) {
      setLocking(false);
      setLockedWord(null);
      setLockedGrammarRule(revealedData.grammarRule);
    } else if (revealedData.isGrammarRuleSrs) {
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
          revealedData !== null && (
            <div className="srs-practice-revealed-content">
              <span className={classNames("grammar-rule-name", "highlighted-item", ...grammarRuleClassNames)} onClick={handleClickGrammarRule}>
                {revealedData.grammarRule.name}
              </span>
              <div className="language-sentence">
                {
                  revealedData.sentenceParts.map(
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
              <div className="english-sentence">{revealedData.englishSentence}</div>
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