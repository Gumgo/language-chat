import { chat, ChatMessage, ListVoicesApiResponseVoice, Model } from "api";
import { showErrorDialog } from "components/dialog";
import { Conversation, DataState, Message, MessageSender, Mistake } from "dataState";
import { getConversationPrompt, getCorrectMistakesPrompt, getSummaryPrompt } from "prompts";
import * as React from "react";
import { assert, doThrow } from "utilities/errors";
import { logError, logWarning } from "utilities/logger";
import { useIsMounted } from "utilities/useIsMounted";
import { useLocalStorageState } from "utilities/useLocalStorage";
import { useStateRef } from "utilities/useStateRef";

const messageCountSummaryThreshold = 50;
const tokenCountSummaryThreshold = 30000;

export type MistakeExplanationLanguage = "English" | "Language";

export interface ConversationSettings {
  model: Model;
  voice: string;
  speechSpeed: number;
  autoPlayResponses: boolean;
  hideResponseText: boolean;
  mistakeExplanationLanguage: MistakeExplanationLanguage;
}

const defaultModel: Model = "gpt-4o";

export function useConversationSettings(
  language: string,
  voices: Map<string, ListVoicesApiResponseVoice[]>,
): [ConversationSettings, (settings: ConversationSettings) => void] {
  const languageVoices = voices.get(language) ?? doThrow(new Error(`Voices for language ${language} not provided`));
  const defaultVoice = languageVoices.length > 0 ? languageVoices[0].name : "";
  const [model, setModel] = useLocalStorageState<Model>("model", (v) => v as Model, defaultModel);
  const [voice, setVoice] = useLocalStorageState<string>(`voice-${language}`, (v) => v, defaultVoice);
  const [speechSpeed, setSpeechSpeed] = useLocalStorageState<number>("speechSpeed", (v) => parseInt(v), 100);
  const [autoPlayResponses, setAutoPlayResponses] = useLocalStorageState<boolean>("autoPlayResponses", (v) => v.trim().toLowerCase() === "true", false);
  const [hideResponseText, setHideResponseText] = useLocalStorageState<boolean>("hideResponseText", (v) => v.trim().toLowerCase() === "true", false);
  const [mistakeExplanationLanguage, setMistakeExplanationLanguage] = useLocalStorageState<MistakeExplanationLanguage>(
    "mistakeExplanationLanguage",
    (v) => v as MistakeExplanationLanguage,
    "English");

  const conversationSettings = React.useMemo<ConversationSettings>(
    () => ({ model, voice, speechSpeed, autoPlayResponses, hideResponseText, mistakeExplanationLanguage }),
    [model, voice, speechSpeed, autoPlayResponses, hideResponseText, mistakeExplanationLanguage]);

  const setConversationSettings = React.useCallback(
    (settings: ConversationSettings) => {
      setModel(settings.model);
      setVoice(settings.voice);
      setSpeechSpeed(settings.speechSpeed);
      setAutoPlayResponses(settings.autoPlayResponses);
      setHideResponseText(settings.hideResponseText);
      setMistakeExplanationLanguage(settings.mistakeExplanationLanguage);
    },
    []);

  return [conversationSettings, setConversationSettings];
}

// $TODO could make this configurable
const temperature = 0.5;
const correctMistakesPreviousMessageCount = 4;

function parseMistakes(message: string): Mistake[] {
  const noMistakesToken = "$NO_MISTAKES$";
  const mistakeToken = "$MISTAKE$";
  const severityToken = "$SEVERITY$";
  const englishExplanationToken = "$EXPL_ENGLISH$";
  const languageExplanationToken = "$EXPL_LANGUAGE$";

  const mistakes: Mistake[] = [];

  let errors = false;
  let remainingMessage = message.trim() === noMistakesToken ? "" : message;
  while (remainingMessage.length > 0) {
    const mistakeIndex = remainingMessage.indexOf(mistakeToken);
    if (mistakeIndex < 0) {
      errors = true;
      break;
    }

    const severityIndex = remainingMessage.indexOf(severityToken, mistakeIndex + mistakeToken.length);
    if (severityIndex < 0) {
      errors = true;
      break;
    }

    const englishExplanationIndex = remainingMessage.indexOf(englishExplanationToken, severityIndex + severityToken.length);
    if (englishExplanationIndex < 0) {
      errors = true;
      break;
    }

    const languageExplanationIndex = remainingMessage.indexOf(languageExplanationToken, englishExplanationIndex + englishExplanationToken.length);
    if (languageExplanationIndex < 0) {
      errors = true;
      break;
    }

    let nextMistakeIndex = remainingMessage.indexOf(mistakeToken, languageExplanationIndex + languageExplanationToken.length);
    if (nextMistakeIndex < 0) {
      nextMistakeIndex = remainingMessage.length;
    }

    const description = remainingMessage.substring(mistakeIndex + mistakeToken.length, severityIndex).trim();
    const severityString = remainingMessage.substring(severityIndex + severityToken.length, englishExplanationIndex).trim();
    const englishExplanation = remainingMessage.substring(englishExplanationIndex + englishExplanationToken.length, languageExplanationIndex).trim();
    const languageExplanation = remainingMessage.substring(languageExplanationIndex + languageExplanationToken.length, nextMistakeIndex).trim();
    remainingMessage = remainingMessage.substring(nextMistakeIndex);

    const severity = parseInt(severityString, 10);
    if (isNaN(severity) || severity < 1 || severity > 10) {
      errors = true;
      continue;
    }

    if (description.length === 0 || englishExplanation.length === 0 || languageExplanation.length === 0) {
      errors = true;
      continue;
    }

    mistakes.push({ description, severity, englishExplanation, languageExplanation });
  }

  if (errors) {
    logWarning(`Mistake response contained errors:\n\n${message}`);
  }

  return mistakes;
}

export type ConversationState = "Initializing" | "WaitingForAssistant" | "WaitingForUser" | "Error";

export function useConversation(
  dataState: DataState,
  language: string,
  conversationSettings: ConversationSettings,
  conversationId: string,
  conversation: Conversation,
  initialMessages: Message[],
): [ConversationState, Message[], (message: string) => boolean] {
  const [messagesState, messagesRef, setMessages] = useStateRef(initialMessages);
  const [conversationStateState, conversationStateRef, setConversationState] = useStateRef<ConversationState>("Initializing");

  function setConversationStateIfNotError(newConversationState: ConversationState): boolean {
    if (conversationStateRef.current === "Error") {
      return false;
    }

    setConversationState(newConversationState);
    return true;
  }

  const isMounted = useIsMounted();

  function setError(error: Error): void {
    if (isMounted.current) {
      logError(`Conversation error: ${error.message}`);
      setConversationState("Error");
      void showErrorDialog("Error", "An error occurred, please exit the conversation and try again.");
    }
  }

  function setConflictError(): void {
    if (isMounted.current) {
      setConversationState("Error");
      void showErrorDialog("Conflict", "This conversation has been modified in another window or tab, please refresh the page and try again.");
    }
  }

  async function addMessage(sender: MessageSender, content: string, tokenCount: number | null): Promise<string | null> {
    const messageId = await dataState.addConversationMessage(
      language,
      conversationId,
      messagesRef.current.length === 0 ? "" : messagesRef.current[messagesRef.current.length - 1].id,
      sender,
      content,
      tokenCount);

    if (!isMounted.current) {
      return null;
    }

    if (messageId === null) {
      setConflictError();
    } else {
      setMessages(
        [
          ...messagesRef.current,
          {
            id: messageId,
            date: new Date(),
            sender,
            content,
            tokenCount,
            mistakesProcessed: sender !== "User",
            mistakes: [],
            summary: null,
          },
        ]);
    }

    return messageId;
  }

  async function setMessageTokenCount(messageId: string, tokenCount: number): Promise<boolean> {
    const didSet = await dataState.setConversationMessageTokenCount(language, conversationId, messageId, tokenCount);

    if (!isMounted.current) {
      return false;
    }

    if (!didSet) {
      setConflictError();
    } else {
      setMessages(messagesRef.current.map((message) => (message.id === messageId ? { ...message, tokenCount } : message)));
    }

    return didSet;
  }

  async function setMessageSummary(messageId: string, summary: string): Promise<boolean> {
    const didSet = await dataState.setConversationMessageSummary(language, conversationId, messageId, summary);

    if (!isMounted.current) {
      return false;
    }

    if (!didSet) {
      setConflictError();
    } else {
      setMessages(messagesRef.current.map((message) => (message.id === messageId ? { ...message, summary } : message)));
    }

    return didSet;
  }

  async function prepareMessages(): Promise<ChatMessage[] | null> {
    if (messagesRef.current.length <= 1) {
      return messagesRef.current.map((message) => ({ sender: message.sender, content: message.content }));
    }

    // Determine the set of messages we should send off for chat completion
    let currentSummary: string | null;
    let prompt: string;
    let firstMessageIndex = messagesRef.current.findLastIndex((message) => message.summary !== null);
    if (firstMessageIndex < 0) {
      firstMessageIndex = 1;
      currentSummary = null;
      prompt = messagesRef.current[0].content;
    } else {
      currentSummary = messagesRef.current[firstMessageIndex].summary;
      prompt = getConversationPrompt(
        {
          language,
          conversationTopic: conversation.conversationTopic,
          studyTopics: conversation.studyTopics,
          studyWords: conversation.studyWords,
          summary: currentSummary,
        });
    }

    const messages = messagesRef.current.slice(firstMessageIndex);

    // If there are too many messages or too many tokens, we need to create a new summary (note that the most recent message's token count won't be filled in
    // yet but that's not a huge deal). Note: the token count of the initial prompt does not include the summary but that's not a huge deal
    const tokenCount = (messagesRef.current[0].tokenCount ?? 0) + messages.reduce((prev, message) => prev + (message.tokenCount ?? 0), 0);

    const summaryMessageCount = messages.length >> 1;
    if ((messages.length < messageCountSummaryThreshold && tokenCount < tokenCountSummaryThreshold) || messages[summaryMessageCount].summary !== null) {
      return [
        { sender: "System", content: prompt },
        ...messages.map((message) => ({ sender: message.sender, content: message.content })),
      ];
    }

    // We need to generate a summary of the oldest half of the conversation
    const summaryPrompt = getSummaryPrompt(
      {
        language,
        previousSummary: currentSummary,
        recentMessages: messages.slice(0, summaryMessageCount),
      });

    const response = await chat(
      {
        model: conversationSettings.model,
        messages: [{ sender: "System", content: summaryPrompt }],
        temperature: 0,
      });

    if (!await setMessageSummary(messages[summaryMessageCount].id, response.message)) {
      return null;
    }

    prompt = getConversationPrompt(
      {
        language,
        conversationTopic: conversation.conversationTopic,
        studyTopics: conversation.studyTopics,
        studyWords: conversation.studyWords,
        summary: response.message,
      });

    return [
      { sender: "System", content: prompt },
      ...messages.slice(summaryMessageCount).map((message) => ({ sender: message.sender, content: message.content })),
    ];
  }

  async function setMessageMistakes(messageId: string, mistakes: Mistake[]): Promise<boolean> {
    const didSet = await dataState.setMessageMistakes(language, conversationId, messageId, mistakes);

    if (!isMounted.current) {
      return false;
    }

    if (!didSet) {
      setConflictError();
    } else {
      setMessages(messagesRef.current.map((message) => (message.id === messageId ? { ...message, mistakesProcessed: true, mistakes } : message)));
    }

    return didSet;
  }

  async function correctMistakes(messageId: string): Promise<void> {
    const messageIndex = messagesRef.current.findIndex((message) => message.id === messageId);
    assert(messageIndex >= 0);

    const message = messagesRef.current[messageIndex];
    assert(message.sender === "User");

    let previousMessages = messagesRef.current.slice(0, messageIndex).filter((m) => m.sender !== "System");
    previousMessages = previousMessages.slice(Math.max(previousMessages.length - correctMistakesPreviousMessageCount, 0));

    try {
      const response = await chat(
        {
          model: conversationSettings.model,
          messages: [
            { sender: "System", content: getCorrectMistakesPrompt({ language, previousMessages }) },
            { sender: "User", content: message.content },
          ],
          temperature: 0,
        });

      const mistakes = parseMistakes(response.message);

      await setMessageMistakes(messageId, mistakes);
    } catch (error) {
      setError(error as Error);
    }
  }

  async function performNextAction(): Promise<void> {
    if (messagesRef.current.length === 0) {
      const prompt = getConversationPrompt(
        {
          language: language,
          conversationTopic: conversation.conversationTopic,
          studyTopics: conversation.studyTopics,
          studyWords: conversation.studyWords,
          summary: null,
        });

      if (!setConversationStateIfNotError("WaitingForAssistant")) {
        return;
      }

      try {
        if (await addMessage("System", prompt, null) === null) {
          return;
        }
      } catch (error) {
        setError(error as Error);
        return;
      }
    }

    assert(messagesRef.current.length > 0);

    const lastSender = messagesRef.current[messagesRef.current.length - 1].sender;
    if (lastSender === "System" || lastSender === "User") {
      if (!setConversationStateIfNotError("WaitingForAssistant")) {
        return;
      }

      try {
        const messages = await prepareMessages();
        if (messages === null) {
          return;
        }

        const response = await chat({ model: conversationSettings.model, messages, temperature });

        // Set any missing token counts from past messages
        for (const [index, tokenCount] of response.inputTokenCounts.entries()) {
          const messageIndex = index === 0
            ? 0
            : messagesRef.current.length - response.inputTokenCounts.length + index;
          const message = messagesRef.current[messageIndex];
          if (message.tokenCount === null && !await setMessageTokenCount(message.id, tokenCount)) {
            return;
          }
        }

        if (await addMessage("Assistant", response.message, response.outputTokenCount) === null) {
          return;
        }
      } catch (error) {
        setError(error as Error);
        return;
      }
    }

    setConversationStateIfNotError("WaitingForUser");
  }

  async function sendMessageAsync(message: string): Promise<void> {
    try {
      const messageId = await addMessage("User", message, null);
      if (messageId === null) {
        return;
      }

      void correctMistakes(messageId);
    } catch (error) {
      setError(error as Error);
      return;
    }

    await performNextAction();
  }

  const sendMessage = React.useCallback(
    (message: string) => {
      if (conversationStateRef.current !== "WaitingForUser") {
        return false;
      }

      if (!setConversationStateIfNotError("WaitingForAssistant")) {
        return false;
      }

      void sendMessageAsync(message);
      return true;
    },
    []);

  React.useEffect(
    () => {
      void performNextAction();

      // Correct mistakes in any messages which for which this has not yet happened
      for (const message of messagesRef.current) {
        if (message.sender === "User" && !message.mistakesProcessed) {
          void correctMistakes(message.id);
        }
      }
    },
    []);

  return [conversationStateState, messagesState, sendMessage];
}