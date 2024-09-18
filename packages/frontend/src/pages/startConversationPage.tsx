import { faMagicWandSparkles } from "@fortawesome/free-solid-svg-icons";
import { chat, ListVoicesApiResponseVoice } from "api";
import { Button, ButtonLink } from "components/button";
import { showDialog, showErrorDialog } from "components/dialog";
import { LoadingDots } from "components/loadingDots";
import { TextArea } from "components/textArea";
import { TextInput } from "components/textInput";
import { useConversationSettings } from "conversation";
import { DataState } from "dataState";
import { showConversationSettingsDialog } from "dialogs/conversationSettingsDialog";
import { getIetfLanguageTag } from "language";
import { getConversationTopicPrompt } from "prompts";
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { logError } from "utilities/logger";
import { useIsMounted } from "utilities/useIsMounted";

async function showGenerateConversationTopicsDialog(language: string): Promise<string | null> {
  const result = await showDialog(
    (dialogProps) => {
      const [topics, setTopics] = React.useState<string[] | null>(null);
      const isMounted = useIsMounted();

      async function getTopics(): Promise<void> {
        try {
          const response = await chat(
            {
              model: "gpt-4o",
              messages: [{ sender: "System", content: getConversationTopicPrompt(language, 10) }],
              temperature: 1,
            });

          if (isMounted.current) {
            setTopics(response.message.split("\n").map((v) => v.trim()).filter((v) => v.length > 0));
          }
        } catch (error) {
          logError(error);
          void showErrorDialog("Error", "Failed to generate conversation topics.");
          dialogProps.onClose(null);
        }
      }

      React.useEffect(
        () => void getTopics(),
        []);

      return (
        <div className="options-dialog-container">
          <h3>Possible conversation topics</h3>
          <div className="dialog-topics-list-container">
            {
              topics === null
                ? <LoadingDots />
                : (
                  topics.map(
                    (topic, i) => (
                      <Button
                        key={i}
                        type="button"
                        appearance="Standard"
                        color="Primary"
                        text={topic}
                        onClick={() => dialogProps.onClose(topic)}
                      />
                    ))
                )
            }
          </div>
          <div className="buttons">
            <Button
              type="button"
              appearance="Standard"
              color="Gray"
              text="Cancel"
              onClick={() => dialogProps.onClose(null)}
            />
          </div>
        </div>
      );
    },
    undefined,
    { width: "Small" });

  return result as string | null;
}

interface StartConversationPageProps {
  dataState: DataState;
  language: string;
  voices: Map<string, ListVoicesApiResponseVoice[]>;
}

export function StartConversationPage(props: StartConversationPageProps): React.JSX.Element {
  const navigate = useNavigate();

  const isMounted = useIsMounted();

  const [conversationTopic, setConversationTopic] = React.useState("");
  const [studyTopics, setStudyTopics] = React.useState("");
  const [studyWords, setStudyWords] = React.useState("");
  const [conversationSettings, setConversationSettings] = useConversationSettings(props.language, props.voices);

  const [submitting, setSubmitting] = React.useState(false);

  async function handleClickGenerateConversationTopics(): Promise<void> {
    const newConversationTopic = await showGenerateConversationTopicsDialog(props.language);
    if (newConversationTopic !== null && isMounted.current) {
      setConversationTopic(newConversationTopic);
    }
  }

  async function handleClickSettings(): Promise<void> {
    const newSettings = await showConversationSettingsDialog(props.language, props.voices, conversationSettings);
    if (newSettings !== null && isMounted.current) {
      setConversationSettings(newSettings);
    }
  }

  async function handleClickStartConversation(): Promise<void> {
    try {
      setSubmitting(true);
      const conversationId = await props.dataState.createConversation(
        props.language,
        conversationTopic.trim(),
        studyTopics.split("\n").map((v) => v.trim()).filter((v) => v.length > 0),
        studyWords.split("\n").map((v) => v.trim()).filter((v) => v.length > 0));

      navigate(`/${props.language}/conversations/${conversationId}`);
    } catch (error) {
      logError(error);
      void showErrorDialog("Error", "Failed to start conversation");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = conversationTopic.trim().length > 0;

  return (
    <div className="start-conversation-page">
      <h2>Start {props.language} conversation</h2>
      <div className="conversation-settings-grid">
        <div className="label">Conversation topic</div>
        <div className="conversation-topic-container">
          <TextInput value={conversationTopic} disabled={submitting} onChangeValue={setConversationTopic} />
          <Button
            type="button"
            appearance="IconOnly"
            color="Primary"
            icon={faMagicWandSparkles}
            tooltip="Generate topics"
            onClick={() => void handleClickGenerateConversationTopics()}
          />
        </div>
        <div className="label">Study topics</div>
        <TextArea value={studyTopics} rows={4} disabled={submitting} onChangeValue={setStudyTopics} />
        <div className="label">Study words</div>
        <TextArea value={studyWords} rows={4} disabled={submitting} onChangeValue={setStudyWords} lang={getIetfLanguageTag(props.language)} />
        <div className="label">Conversation settings</div>
        <Button type="button" appearance="Standard" color="Gray" text="Edit" disabled={submitting} onClick={() => void handleClickSettings()} />
      </div>
      <div className="buttons-container">
        <Button
          type="button"
          appearance="Standard"
          color="Primary"
          text="Start conversation"
          disabled={submitting || !canSubmit}
          onClick={() => void handleClickStartConversation()}
        />
        <ButtonLink
          to="/"
          appearance="Standard"
          color="Gray"
          text="Back"
        />
      </div>
    </div>
  );
}