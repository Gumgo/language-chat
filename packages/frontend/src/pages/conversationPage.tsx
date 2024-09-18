import { faCircleArrowLeft, faCircleArrowUp, faCircleExclamation, faCirclePlay, faCircleStop, faEye, faGear, faSpinner } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { ListVoicesApiResponseVoice, speech } from "api";
import { Button, ButtonLink } from "components/button";
import { LoadingDots } from "components/loadingDots";
import { TextArea } from "components/textArea";
import { ConversationSettings, MistakeExplanationLanguage, useConversation, useConversationSettings } from "conversation";
import { Conversation, DataState, Message } from "dataState";
import { showConversationSettingsDialog } from "dialogs/conversationSettingsDialog";
import { getIetfLanguageTag } from "language";
import * as React from "react";
import { useParams } from "react-router-dom";
import { assert, doThrow } from "utilities/errors";
import { logError } from "utilities/logger";
import { AudioState, useAudioPlayer } from "utilities/useAudioPlayer";
import { useEvent } from "utilities/useEvent";
import { useIsMounted } from "utilities/useIsMounted";
import { classNames } from "utilities/utilities";

interface ConversationBubbleProps {
  message: Message | null;
  mistakeExplanationLanguage: MistakeExplanationLanguage;

  revealed: boolean;
  audioState: AudioState;
  audioPlaying: boolean;

  onClickReveal: () => void;
  onClickPlayAudio: () => void;
  onClickStopAudio: () => void;
}

function ConversationBubble(props: ConversationBubbleProps): React.JSX.Element {
  if (props.message === null) {
    // If no message was provided, this represents the assistant writing a message
    return (
      <div className="conversation-bubble assistant">
        <LoadingDots color="Dark" />
      </div>
    );
  }

  assert(props.message.sender === "User" || props.message.sender === "Assistant");

  return (
    <div className={classNames("conversation-bubble", props.message.sender === "User" ? "user" : "assistant")}>
      <div>
        <span
          className={classNames("message-content", !props.revealed && "unrevealed")}
          onClick={props.revealed ? undefined : props.onClickReveal}
          title={props.revealed ? undefined : "Click to reveal text"}
        >
          {props.message.content}
        </span>
      </div>
      <hr />
      {
        props.message.sender === "User"
          ? (
            !props.message.mistakesProcessed
              ? <LoadingDots className="mistakes-title" color="Dark" />
              : (
                <>
                  <h4 className="mistakes-title">
                    {props.message.mistakes.length === 0 ? "No mistakes" : "Mistakes:"}
                  </h4>
                  <div className="mistakes">
                    {
                      props.message.mistakes.map(
                        (mistake, i) => (
                          <React.Fragment key={i}>
                            <div>
                              <div className="description">{mistake.description}</div>
                              <div>{props.mistakeExplanationLanguage === "English" ? mistake.englishExplanation : mistake.languageExplanation}</div>
                            </div>
                            <div className={`severity-${mistake.severity}`} title="Mistake severity">
                              {`${mistake.severity}/5`}
                            </div>
                          </React.Fragment>
                        ))
                    }
                  </div>
                </>
              )
          )
          : (
            <div className="text-and-audio-controls">
              {
                !props.revealed && (
                  <Button
                    type="button"
                    appearance="IconOnly"
                    color="Primary"
                    icon={faEye}
                    tooltip="Reveal text"
                    onClick={props.onClickReveal}
                  />
                )
              }
              <div className="audio-controls">
                <Button
                  type="button"
                  className={classNames(props.audioPlaying && props.audioState === "Generating" && "generating", props.audioState === "Error" && "hidden")}
                  appearance="IconOnly"
                  color="Primary"
                  icon={props.audioPlaying ? (props.audioState === "Generating" ? faSpinner : faCircleStop) : faCirclePlay}
                  tooltip={props.audioPlaying ? "Stop audio" : "Play audio"}
                  onClick={props.audioPlaying ? props.onClickStopAudio : props.onClickPlayAudio}
                />
                <FontAwesomeIcon
                  className={classNames("error", props.audioState !== "Error" && "hidden")}
                  icon={faCircleExclamation}
                  title="Error generating audio"
                />
              </div>
            </div>
          )
      }
    </div>
  );
}

interface ConversationBubbleEntry {
  message: Message | null;
  revealed: boolean;
}

interface ActiveConversationPageProps {
  dataState: DataState;
  language: string;
  conversationSettings: ConversationSettings;
  conversationId: string;
  conversation: Conversation;
  initialMessages: Message[];
}

function ActiveConversationPage(props: ActiveConversationPageProps): React.JSX.Element {
  interface AudioIdentifier {
    language: string;
    voice: string;
    speed: number;
    messageId: string;
  }

  const scrollContainer = React.useRef<HTMLDivElement | null>(null);

  const [conversationState, messages, sendMessage] = useConversation(
    props.dataState,
    props.language,
    props.conversationSettings,
    props.conversationId,
    props.conversation,
    props.initialMessages);

  const [conversationBubbles, setConversationBubbles] = React.useState<ConversationBubbleEntry[]>([]);

  const generateAudioUrl = useEvent(
    (audioIdentifier: AudioIdentifier) => speech(
      {
        language: audioIdentifier.language,
        voice: audioIdentifier.voice,
        speed: audioIdentifier.speed,
        message: messages.find((v) => v.id === audioIdentifier.messageId)?.content ?? doThrow(new Error("Message not found")),
      }));

  function getAudioIdentifierKey(audioIdentifier: AudioIdentifier): string {
    return [audioIdentifier.language, audioIdentifier.voice, audioIdentifier.speed.toString(), audioIdentifier.messageId].join("|");
  }

  const audioPlayer = useAudioPlayer<AudioIdentifier>(generateAudioUrl, getAudioIdentifierKey);

  const [retainScrollPositionCounter, setRetainScrollPositionCounter] = React.useState(0);
  const isScrolledToBottom = React.useRef(false);

  const retainScrollPosition = React.useCallback(
    () => {
      // Before state updates are applied, determine if we're scrolled to the bottom
      if (scrollContainer.current !== null) {
        const scrollThreshold = 2; // This threshold is used to avoid rounding errors
        isScrolledToBottom.current =
          Math.abs(scrollContainer.current.scrollHeight - scrollContainer.current.clientHeight - scrollContainer.current.scrollTop) <= scrollThreshold;
      }

      setRetainScrollPositionCounter((v) => v + 1);
    },
    []);

  const [conversationLoaded, setConversationLoaded] = React.useState(false);

  React.useLayoutEffect(
    () => {
      const newConversationBubbles = messages
        .filter((message) => message.sender !== "System")
        .map<ConversationBubbleEntry>(
        (message) => {
          assert(message.sender !== "System");
          return { message, revealed: message.sender === "User" ? true : !props.conversationSettings.hideResponseText };
        });

      if (conversationState === "WaitingForAssistant") {
        newConversationBubbles.push({ message: null, revealed: true });
      }

      const revealAllConversationBubbles = !conversationLoaded;
      setConversationBubbles(
        (oldConversationBubbles) => newConversationBubbles.map(
          (newConversationBubble) => {
            if (newConversationBubble.message === null) {
              return newConversationBubble;
            }

            // Always reveal past messages upon loading the conversation
            let previouslyRevealed = revealAllConversationBubbles;
            if (!previouslyRevealed) {
              const messageId = newConversationBubble.message.id;
              const oldConversationBubble = oldConversationBubbles.find((v) => v.message?.id === messageId);
              if (oldConversationBubble?.revealed === true) {
                previouslyRevealed = true;
              }
            }

            return previouslyRevealed ? { ...newConversationBubble, revealed: true } : newConversationBubble;
          }));
      setConversationLoaded(true);
      retainScrollPosition();
    },
    [conversationState, messages]);

  const [nextMessageContent, setNextMessageContent] = React.useState("");

  React.useLayoutEffect(
    () => {
      assert(scrollContainer.current !== null);
      scrollContainer.current.scrollTo({ behavior: "instant", top: scrollContainer.current.scrollHeight });
    },
    []);

  React.useLayoutEffect(
    () => {
      // Whenever conversation bubble content changes, snap to the bottom if we're already scrolled there
      assert(scrollContainer.current !== null);
      if (isScrolledToBottom.current) {
        scrollContainer.current.scrollTo({ behavior: "instant", top: scrollContainer.current.scrollHeight });
      }
    },
    [retainScrollPositionCounter]);

  const canSendMessage = conversationState === "WaitingForUser" && nextMessageContent.trim().length > 0;

  const handleClickSendMessage = useEvent(
    () => {
      if (!canSendMessage) {
        return;
      }

      sendMessage(nextMessageContent.trim());
      setNextMessageContent("");
    });

  const handleKeyDownMessageContent = useEvent(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.code === "Enter" || event.code === "NumpadEnter")
        && !event.ctrlKey
        && !event.shiftKey
        && !event.altKey
        && !event.metaKey) {
        handleClickSendMessage();
        event.preventDefault();
      }
    });

  return (
    <>
      <div className="scroll-container" ref={scrollContainer}>
        <div className="conversation-history">
          {
            conversationBubbles.map(
              (bubble, i) => {
                // If we're playing any variation of this message's audio (i.e. any voice, gender, or speed), consider this message's audio to be playing
                let audioIdentifier: AudioIdentifier | null = null;
                let audioPlaying = false;
                let audioState: AudioState = "Ready";

                if (bubble.message !== null) {
                  audioIdentifier = {
                    language: props.language,
                    voice: props.conversationSettings.voice,
                    speed: props.conversationSettings.speechSpeed,
                    messageId: bubble.message.id,
                  };

                  audioState = audioPlayer.audioStates.get(getAudioIdentifierKey(audioIdentifier)) ?? "Ready";
                  audioPlaying = audioPlayer.playingAudioIdentifier?.messageId === bubble.message.id;
                }

                function handleClickReveal(): void {
                  setConversationBubbles((v) => v.map((b) => (b === bubble ? { ...b, revealed: true } : b)));
                }

                function handleClickPlayAudio(): void {
                  if (audioIdentifier !== null) {
                    audioPlayer.playAudio(audioIdentifier);
                  }
                }

                function handleClickStopAudio(): void {
                  // If we're playing any variation of this message's audio (i.e. any voice, gender, or speed), stop the audio
                  if (audioIdentifier !== null
                    && audioPlayer.playingAudioIdentifier !== null
                    && audioIdentifier.messageId === audioPlayer.playingAudioIdentifier.messageId) {
                    audioPlayer.stopAudio();
                  }
                }

                return (
                  <ConversationBubble
                    key={i}
                    message={bubble.message}
                    mistakeExplanationLanguage={props.conversationSettings.mistakeExplanationLanguage}
                    revealed={bubble.revealed}
                    audioState={audioState}
                    audioPlaying={audioPlaying}
                    onClickReveal={handleClickReveal}
                    onClickPlayAudio={handleClickPlayAudio}
                    onClickStopAudio={handleClickStopAudio}
                  />
                );
              })
          }
        </div>
      </div>
      <div className="controls">
        <TextArea
          className="next-message-content"
          value={nextMessageContent}
          onChangeValue={setNextMessageContent}
          onKeyDown={handleKeyDownMessageContent}
          lang={getIetfLanguageTag(props.language)}
        />
        <div className="actions">
          <Button
            type="button"
            className="action"
            appearance="IconOnly"
            color="Primary"
            icon={faCircleArrowUp}
            onClick={handleClickSendMessage}
            disabled={!canSendMessage}
            tooltip="Send message"
          />
        </div>
      </div>
    </>
  );
}

interface ConversationPageProps {
  dataState: DataState;
  language: string;
  voices: Map<string, ListVoicesApiResponseVoice[]>;
}

export function ConversationPage(props: ConversationPageProps): React.JSX.Element {
  const { conversationId } = useParams();
  const conversationIdOrDefault = conversationId ?? "";

  const isMounted = useIsMounted();

  const [conversationSettings, setConversationSettings] = useConversationSettings(props.language, props.voices);
  const [conversation, setConversation] = React.useState<Conversation | null>(null);
  const [initialMessages, setInitialMessages] = React.useState<Message[] | null>(null);
  const [hasError, setHasError] = React.useState(false);

  async function handleClickSettings(): Promise<void> {
    const newSettings = await showConversationSettingsDialog(props.language, props.voices, conversationSettings);
    if (newSettings !== null && isMounted.current) {
      setConversationSettings(newSettings);
    }
  }

  React.useEffect(
    () => {
      props.dataState
        .getConversation(props.language, conversationIdOrDefault)
        .then(
          (conversationInner) => {
            if (isMounted.current) {
              if (conversationInner === null) {
                setHasError(true);
              } else {
                setConversation(conversationInner);
              }
            }
          })
        .catch(
          (error: unknown) => {
            logError(error);
            if (isMounted.current) {
              setHasError(true);
            }
          });

      props.dataState
        .getConversationMessages(props.language, conversationIdOrDefault)
        .then(
          (messages) => {
            if (isMounted.current) {
              if (messages === null) {
                setHasError(true);
              } else {
                setInitialMessages(messages);
              }
            }
          })
        .catch(
          (error: unknown) => {
            logError(error);
            if (isMounted.current) {
              setHasError(true);
            }
          });
    },
    []);

  return (
    <div className="conversation-page">
      <div className="top-bar">
        <ButtonLink to="/" appearance="IconOnly" color="Gray" icon={faCircleArrowLeft} tooltip="Back" />
        <h2>{conversation?.conversationTopic}</h2>
        <Button type="button" appearance="IconOnly" color="Gray" icon={faGear} tooltip="Settings" onClick={() => void handleClickSettings()} />
      </div>
      {
        hasError
          ? <h2 className="centered">The conversation does not exist</h2>
          : (conversation === null || initialMessages === null)
            ? (
              <div className="centered">
                <LoadingDots />
              </div>
            )
            : (
              <ActiveConversationPage
                dataState={props.dataState}
                language={props.language}
                conversationSettings={conversationSettings}
                conversationId={conversationIdOrDefault}
                conversation={conversation}
                initialMessages={initialMessages}
              />
            )
      }
    </div>
  );
}
