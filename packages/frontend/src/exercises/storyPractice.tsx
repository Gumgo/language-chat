import { chat, ChatMessage, getSpeechTimepoints, ListVoicesApiResponseVoice, Model, speech, VoiceGender } from "api";
import { Button } from "components/button";
import { GestureScreen, GestureScreenBottomControls, useGestureDetector } from "components/gestureScreen";
import { VocabularyEntry } from "dataState";
import { StoryDifficulty, StoryMode } from "exercises/storyPracticeTypes";
import { getStoryPracticePrompts } from "prompts";
import * as React from "react";
import { doThrow } from "utilities/errors";
import { logError } from "utilities/logger";
import { generateIsolatedWordSpeechUrl, trimAudioPlaybackUrl } from "utilities/speechUtilities";
import { useAudioPlayer } from "utilities/useAudioPlayer";
import { iterateWithIndex, sleep } from "utilities/utilities";

interface StoryPracticeProps {
  language: string;
  model: Model;
  voices: ListVoicesApiResponseVoice[];
  englishVoices: ListVoicesApiResponseVoice[];
  speechSpeed: number;
  words: VocabularyEntry[];
  focusWords: VocabularyEntry[];
  storyMode: StoryMode;
  difficulty: StoryDifficulty;
  onStop: () => void;
}

export function StoryPractice(props: StoryPracticeProps): React.JSX.Element {
  const [displayMessage, setDisplayMessage] = React.useState("");
  const audioPlayer = useAudioPlayer<string>((v) => new Promise<string>((resolve) => resolve(v)), (v) => v);
  const onStopAudio = React.useRef<(() => void) | null>(null);

  React.useEffect(
    () => {
      if (audioPlayer.playingAudioIdentifier === null && onStopAudio.current !== null) {
        const onStopAudioLocal = onStopAudio.current;
        onStopAudio.current = null;
        onStopAudioLocal();
      }
    },
    [audioPlayer.playingAudioIdentifier]);

  const gestureDetectorData = useGestureDetector();

  async function run(): Promise<void> {
    const splitterToken = "|||";
    const explanationStartToken = "[[[";
    const explanationEndToken = "]]]";
    const character1VoiceNameToken = "$CHARACTER1";
    const character2VoiceNameToken = "$CHARACTER2";
    const breakTimeSeconds = 0.5;
    const paddingTimeSeconds = 0.1;

    const maleVoiceNames = props.voices.filter((v) => v.gender === "Male");
    const femaleVoiceNames = props.voices.filter((v) => v.gender === "Female");
    const englishMaleVoiceNames = props.englishVoices.filter((v) => v.gender === "Male");
    const englishFemaleVoiceNames = props.englishVoices.filter((v) => v.gender === "Female");

    function chooseVoice(gender: VoiceGender, options?: { english?: boolean }): string {
      const voiceNames = gender === "Male"
        ? (options?.english === true ? englishMaleVoiceNames : maleVoiceNames)
        : (options?.english === true ? englishFemaleVoiceNames : femaleVoiceNames);
      if (voiceNames.length === 0) {
        throw new Error("Not enough voices");
      }

      const voiceIndex = Math.floor(Math.random() * voiceNames.length);
      return voiceNames.splice(voiceIndex, 1)[0].name;
    }

    setDisplayMessage("Generating story...");

    // First, choose an overall story narrator voice
    const narratorGender: VoiceGender = Math.random() >= 0.5 ? "Male" : "Female";
    const narratorVoiceName = chooseVoice(narratorGender);
    const narratorEnglishVoiceName = chooseVoice(narratorGender, { english: true });

    // First, we need to generate the story
    const prompts = getStoryPracticePrompts(
      props.language,
      props.words.map((v) => v.word),
      props.focusWords.map((v) => v.word),
      props.storyMode,
      props.difficulty);

    const messages: ChatMessage[] = [];
    async function sendMessage(chatMessage: string, temperature: number): Promise<string> {
      messages.push({ sender: "User", content: chatMessage });
      const response = await chat({ model: props.model, messages, temperature });
      messages.push({ sender: "Assistant", content: response.message });
      return response.message;
    }

    await sendMessage(prompts.generateStoryPrompt, 1);
    if (prompts.modifyStoryPrompt !== null) {
      await sendMessage(prompts.modifyStoryPrompt, 0);
    }
    await sendMessage(prompts.ssmlPrompt, 0);
    await sendMessage(prompts.splitPrompt, 0);
    const rawStoryContent = await sendMessage(prompts.reviewPrompt, 0);
    const rawAdditionalComponents = await sendMessage(prompts.additionalComponentsPrompt, 0);

    // First, parse the additional components
    const remainingAdditionalComponents = rawAdditionalComponents.split("\n");
    function getNextAdditionalComponent(prefix: string): string {
      if (remainingAdditionalComponents.length === 0) {
        throw new Error("Invalid AI output, not enough additional component lines");
      }
      const line = remainingAdditionalComponents.splice(0, 1)[0];
      if (!line.startsWith(prefix)) {
        throw new Error(`Invalid AI output, no line starting with '${prefix}'`);
      }

      return line.substring(prefix.length).trim();
    }

    interface DialogCharacter {
      voiceName: string;
      englishVoiceName: string;
      introduction: string;
    }

    interface NewWord {
      word: string;
      meaning: string;
    }

    const title = getNextAdditionalComponent("$TITLE");
    const titleTranslation = getNextAdditionalComponent("$TITLE_TRANSLATION");
    const dialogCharacters: DialogCharacter[] = [];
    if (props.storyMode === "Dialog") {
      for (let i = 1; i <= 2; i++) {
        const gender = getNextAdditionalComponent(`$CHARACTER${i}_GENDER`);
        const introduction = getNextAdditionalComponent(`$CHARACTER${i}_INTRODUCTION`);

        const voiceGender: VoiceGender = gender === "MALE"
          ? "Male"
          : (gender === "FEMALE" ? "Female" : doThrow(new Error(`Invalid AI output, invalid dialog character gender '${gender}'`)));
        const voiceName = chooseVoice(voiceGender);
        const englishVoiceName = chooseVoice(voiceGender, { english: true });
        dialogCharacters.push({ voiceName, englishVoiceName, introduction });
      }
    }

    const newWords: NewWord[] = [];
    while (remainingAdditionalComponents.length > 0) {
      const newWordLine = getNextAdditionalComponent("$NEW_WORD");
      const parts = newWordLine.split(splitterToken);
      if (parts.length !== 2) {
        throw new Error("Invalid AI output, malformed new word line");
      }

      newWords.push({ word: parts[0].trim(), meaning: parts[1].trim() });
    }

    interface SentencePart {
      text: string;
      explanation: string;
    }

    interface Sentence {
      text: string;
      parts: SentencePart[];
      explanationVoiceName: string;
    }

    // Break up the story content into sentences
    const sentences: Sentence[] = [];
    const lines = rawStoryContent.split("\n").map((v) => v.trim()).filter((v) => v.length > 0);

    for (let rawSentence of lines) {
      let explanationVoiceName: string;
      if (props.storyMode === "Dialog") {
        const isCharacter1 = rawSentence.includes(character1VoiceNameToken);
        const isCharacter2 = rawSentence.includes(character2VoiceNameToken);
        if (isCharacter1 && !isCharacter2) {
          rawSentence = rawSentence.replaceAll(character1VoiceNameToken, dialogCharacters[0].voiceName);
          explanationVoiceName = dialogCharacters[0].englishVoiceName;
        } else if (!isCharacter1 && isCharacter2) {
          rawSentence = rawSentence.replaceAll(character2VoiceNameToken, dialogCharacters[1].voiceName);
          explanationVoiceName = dialogCharacters[1].englishVoiceName;
        } else {
          throw new Error("Invalid AI output, missing or ambiguous dialog character");
        }
      } else {
        explanationVoiceName = narratorEnglishVoiceName;
      }

      let sentence: string = "";
      const sentenceParts: SentencePart[] = [];
      let explanationStartIndex = rawSentence.indexOf(explanationStartToken);
      if (explanationStartIndex < 0) {
        throw new Error("Invalid AI output, sentence contains no explanations");
      }

      while (explanationStartIndex >= 0) {
        const explanationEndIndex = rawSentence.indexOf(explanationEndToken, explanationStartIndex);
        if (explanationEndIndex < 0) {
          throw new Error("Invalid AI output, malformed chunk explanation");
        }

        const explanation = rawSentence.substring(explanationStartIndex + explanationStartToken.length, explanationEndIndex);
        const nextExplanationStartIndex = rawSentence.indexOf(explanationStartToken, explanationEndIndex);
        let sentencePart = rawSentence.substring(
          explanationEndIndex + explanationEndToken.length,
          nextExplanationStartIndex >= 0 ? nextExplanationStartIndex : undefined);

        // The very first chunk may contain text before the corresponding explanation
        if (sentenceParts.length === 0) {
          sentencePart = `${rawSentence.substring(0, explanationStartIndex)}${sentencePart}`;
        }

        sentence = `${sentence}${sentencePart}`;
        sentenceParts.push({ text: sentencePart, explanation });
        explanationStartIndex = nextExplanationStartIndex;
      }

      sentences.push({ text: sentence, parts: sentenceParts, explanationVoiceName });
    }

    // Generate full story text and split story text
    const fullStoryContentParts: string[] = ["<speak>"];
    const splitStoryContentParts: string[] = ["<speak>"];
    for (const { sentence, sentenceIndex } of sentences.map((s, si) => ({ sentence: s, sentenceIndex: si }))) {
      if (sentenceIndex > 0) {
        fullStoryContentParts.push(` <mark name="sentence_${sentenceIndex}" /><break time="${breakTimeSeconds}s" />`);
        splitStoryContentParts.push(` <mark name="sentence_${sentenceIndex}" /><break time="${breakTimeSeconds}s" />`);
      }

      fullStoryContentParts.push(sentence.text);

      for (const [part, partIndex] of iterateWithIndex(sentence.parts)) {
        if (partIndex > 0) {
          splitStoryContentParts.push(` <mark name="sentence_${sentenceIndex}_part_${partIndex}" /><break time="${breakTimeSeconds}s" />`);
        }

        splitStoryContentParts.push(part.text);
      }
    }

    fullStoryContentParts.push("</speak>");
    splitStoryContentParts.push("</speak>");

    setDisplayMessage("Generating audio...");

    // Next, generate all the required audio
    interface SentencePartAudio {
      text: string;
      explanation: string;
    }

    interface SentenceAudio {
      text: string;
      parts: SentencePartAudio[];
    }

    interface NewWordAudio {
      word: string;
      meaning: string;
    }

    interface StoryAudio {
      title: string;
      titleTranslation: string;
      newWordsHeader: string;
      newWords: NewWordAudio[];
      characterIntroductions: string[];
      sentences: SentenceAudio[];
    }

    async function languageSpeechUrl(voice: string, message: string, ssml: boolean): Promise<string> {
      return (await speech({ language: props.language, voice, speed: props.speechSpeed, message, ssml })).audioUrl;
    }

    async function englishSpeechUrl(voice: string, message: string): Promise<string> {
      return (await speech({ language: "English", voice, speed: 100, message, ssml: false })).audioUrl;
    }

    const storyAudio: StoryAudio = {
      title: await languageSpeechUrl(narratorVoiceName, title, false),
      titleTranslation: await englishSpeechUrl(narratorEnglishVoiceName, titleTranslation),
      newWordsHeader: await englishSpeechUrl(narratorEnglishVoiceName, "New words"),
      newWords: [],
      characterIntroductions: [],
      sentences: [],
    };

    for (const newWord of newWords) {
      storyAudio.newWords.push(
        {
          word: await generateIsolatedWordSpeechUrl(props.language, narratorVoiceName, props.speechSpeed, newWord.word),
          meaning: await englishSpeechUrl(narratorEnglishVoiceName, newWord.meaning),
        });
    }

    if (props.storyMode === "Dialog") {
      for (const dialogCharacter of dialogCharacters) {
        storyAudio.characterIntroductions.push(await languageSpeechUrl(dialogCharacter.voiceName, dialogCharacter.introduction, false));
      }
    }

    // The story content is one audio file with breaks where we allow pausing
    const fullStorySpeechResponse = await speech(
      {
        language: props.language,
        voice: narratorVoiceName,
        speed: props.speechSpeed,
        message: fullStoryContentParts.join(""),
        ssml: true,
      });

    const fullStoryTimepoints = await getSpeechTimepoints(fullStorySpeechResponse);

    const splitStorySpeechResponse = await speech(
      {
        language: props.language,
        voice: narratorVoiceName,
        speed: props.speechSpeed,
        message: splitStoryContentParts.join(""),
        ssml: true,
      });

    const splitStoryTimepoints = await getSpeechTimepoints(splitStorySpeechResponse);

    // This function finds the start or end time of a sentence or a sentence part
    function getTimepoint(sentenceIndex: number, partIndex: number | null, side: "Start" | "End"): number | null {
      let markName: string;
      const skipPart = partIndex === null
        || (partIndex === 0 && side === "Start")
        || (partIndex === sentences[sentenceIndex].parts.length - 1 && side === "End");
      if (skipPart) {
        if ((sentenceIndex === 0 && side === "Start") || (sentenceIndex === sentences.length - 1 && side === "End")) {
          return null;
        }

        markName = `sentence_${sentenceIndex + (side === "Start" ? 0 : 1)}`;
      } else {
        markName = `sentence_${sentenceIndex}_part_${partIndex + (side === "Start" ? 0 : 1)}`;
      }

      const timepoints = partIndex === null ? fullStoryTimepoints : splitStoryTimepoints;
      const timepoint = timepoints.timepoints.find((v) => v.markName === markName) ?? doThrow(new Error("Timepoint not found"));
      return side === "Start"
        ? timepoint.timeSeconds + breakTimeSeconds - paddingTimeSeconds
        : timepoint.timeSeconds + paddingTimeSeconds;
    }

    for (const [sentence, sentenceIndex] of iterateWithIndex(sentences)) {
      const sentenceStartTimepoint = getTimepoint(sentenceIndex, null, "Start");
      const sentenceEndTimepoint = getTimepoint(sentenceIndex, null, "End");
      const sentenceAudioUrl = trimAudioPlaybackUrl(fullStorySpeechResponse.audioUrl, sentenceStartTimepoint, sentenceEndTimepoint);
      const sentenceAudio: SentenceAudio = {
        text: sentenceAudioUrl,
        parts: [],
      };

      for (const [part, partIndex] of iterateWithIndex(sentence.parts)) {
        const partStartTimepoint = getTimepoint(sentenceIndex, partIndex, "Start");
        const partEndTimepoint = getTimepoint(sentenceIndex, partIndex, "End");
        const partAudioUrl = trimAudioPlaybackUrl(splitStorySpeechResponse.audioUrl, partStartTimepoint, partEndTimepoint);
        const explanationAudioUrl = await englishSpeechUrl(sentence.explanationVoiceName, part.explanation);
        sentenceAudio.parts.push(
          {
            text: partAudioUrl,
            explanation: explanationAudioUrl,
          });
      }

      storyAudio.sentences.push(sentenceAudio);
    }

    // Now that we've generated everything we can set up and run the story. To do this, generate a graph of connected nodes where the user can use gestures to
    // move between nodes.
    interface AudioNode {
      content: (string | number)[]; // List of audio URLs and pause durations
      label: string;
      previous?: AudioNode;
      next?: AudioNode;
      moreAssistance?: AudioNode;
      lessAssistance?: AudioNode;
    }

    const titleAudioNode: AudioNode = {
      content: [storyAudio.title, 1],
      label: "Title",
    };

    const titleTranslationAudioNode: AudioNode = {
      content: [storyAudio.titleTranslation, 1],
      label: "Title",
      lessAssistance: titleAudioNode,
    };

    titleAudioNode.moreAssistance = titleTranslationAudioNode;
    titleTranslationAudioNode.lessAssistance = titleAudioNode;

    let previousAudioNodes: AudioNode[] = [titleAudioNode, titleTranslationAudioNode];

    if (storyAudio.newWords.length > 0) {
      const newWordsAudioNode: AudioNode = {
        content: [storyAudio.newWordsHeader, 1],
        label: `New words (${storyAudio.newWords.length})`,
        previous: previousAudioNodes[0],
      };

      for (const node of previousAudioNodes) {
        node.next = newWordsAudioNode;
      }
      previousAudioNodes = [newWordsAudioNode];

      for (const [newWord, newWordIndex] of iterateWithIndex(storyAudio.newWords)) {
        const newWordAudioNode: AudioNode = {
          content: [newWord.meaning, 1, newWord.word, 1],
          label: `New word (${newWordIndex + 1}/${storyAudio.newWords.length})`,
          previous: previousAudioNodes[0],
        };

        for (const node of previousAudioNodes) {
          node.next = newWordAudioNode;
        }
        previousAudioNodes = [newWordAudioNode];
      }
    }

    for (const characterIntroduction of storyAudio.characterIntroductions) {
      const introductionAudioNode: AudioNode = {
        content: [characterIntroduction, 1],
        label: "Characters",
        previous: previousAudioNodes[0],
      };

      for (const node of previousAudioNodes) {
        node.next = introductionAudioNode;
      }
      previousAudioNodes = [introductionAudioNode];
    }

    for (const [sentence, sentenceIndex] of iterateWithIndex(storyAudio.sentences)) {
      const fullSentenceAudioNode: AudioNode = {
        content: [sentence.text, 0.5],
        label: `Story (${sentenceIndex + 1}/${storyAudio.sentences.length})`,
        previous: previousAudioNodes[0],
      };

      const partAudioNodes: AudioNode[] = sentence.parts.map(
        (part, partIndex) => (
          {
            content: [part.text, 0.5],
            label: `Story (${sentenceIndex + 1}.${partIndex + 1}/${storyAudio.sentences.length}.${sentence.parts.length})`,
            lessAssistance: fullSentenceAudioNode,
          }));
      const explanationAudioNodes: AudioNode[] = sentence.parts.map(
        (part, partIndex) => (
          {
            content: [part.explanation, 0.5],
            label: `Story (${sentenceIndex + 1}.${partIndex + 1}/${storyAudio.sentences.length}.${sentence.parts.length})`,
          }));

      fullSentenceAudioNode.moreAssistance = partAudioNodes[0];
      for (let i = 0; i < sentence.parts.length; i++) {
        partAudioNodes[i].moreAssistance = explanationAudioNodes[i];
        explanationAudioNodes[i].lessAssistance = partAudioNodes[i];

        if (i > 0) {
          partAudioNodes[i].previous = partAudioNodes[i - 1];
          explanationAudioNodes[i].previous = explanationAudioNodes[i - 1];
        }

        if (i < sentence.parts.length - 1) {
          partAudioNodes[i].next = partAudioNodes[i + 1];
          explanationAudioNodes[i].next = explanationAudioNodes[i + 1];
        }
      }

      partAudioNodes[0].previous = previousAudioNodes[0];
      explanationAudioNodes[0].previous = previousAudioNodes[0];

      for (const node of previousAudioNodes) {
        node.next = fullSentenceAudioNode;
      }
      previousAudioNodes = [fullSentenceAudioNode, partAudioNodes[partAudioNodes.length - 1], explanationAudioNodes[explanationAudioNodes.length - 1]];
    }

    function playAudio(audioUrl: string): Promise<void> {
      return new Promise<void>(
        (resolve) => {
          onStopAudio.current = resolve;
          audioPlayer.playAudio(audioUrl);
        });
    }

    let currentAudioNode = titleAudioNode;
    let done = false;
    while (!done) {
      let actionComplete = false;
      let actionTerminated = false;
      async function action(): Promise<void> {
        for (const contentItem of currentAudioNode.content) {
          if (typeof contentItem === "string") {
            await playAudio(contentItem);
          } else {
            await sleep(contentItem);
          }

          if (actionTerminated) {
            return;
          }
        }
      }

      const actionPromise = (async () => { await action(); actionComplete = true; })();
      let gesturePromise = gestureDetectorData.gesturePromise.current;

      while (true) {
        setDisplayMessage(currentAudioNode.label);

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!actionComplete) {
          await Promise.any([actionPromise, gesturePromise]);
        }

        // Wait for the next gesture
        const gesture = await gesturePromise;
        let newAudioNode: AudioNode | null = null;
        if (gesture === null) {
          actionTerminated = true;
          audioPlayer.stopAudio();
          done = true;
          break;
        } else if (gesture === "SwipeRight" && currentAudioNode.next !== undefined) {
          newAudioNode = currentAudioNode.next;
        } else if (gesture === "SwipeLeft" && currentAudioNode.previous !== undefined) {
          newAudioNode = currentAudioNode.previous;
        } else if (gesture === "SwipeDown" && currentAudioNode.moreAssistance !== undefined) {
          newAudioNode = currentAudioNode.moreAssistance;
        } else if (gesture === "SwipeUp" && currentAudioNode.lessAssistance !== undefined) {
          newAudioNode = currentAudioNode.lessAssistance;
        } else if (gesture === "SpinClockwise" || gesture === "SpinCounterClockwise") {
          newAudioNode = currentAudioNode; // Repeat this node
        }

        if (newAudioNode !== null) {
          // This gesture changed our state so stop audio and terminate the waiting loop
          actionTerminated = true;
          audioPlayer.stopAudio();

          // eslint-disable-next-line require-atomic-updates
          currentAudioNode = newAudioNode;
          break;
        }

        // The gesture was ignored, loop to wait for a different gesture
        gesturePromise = gestureDetectorData.gesturePromise.current;
      }
    }
  }

  function handleStop(): void {
    gestureDetectorData.handleStopGestureDetection();
    props.onStop();
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
      <GestureScreenBottomControls>
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