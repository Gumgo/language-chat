import { faCircleArrowLeft, faLink, faList } from "@fortawesome/free-solid-svg-icons";
import { Button, ButtonLink } from "components/button";
import { Checkbox, TriStateCheckbox, TriStateCheckboxValue } from "components/checkbox";
import { showDialog, showErrorDialog, showOptionsDialog } from "components/dialog";
import { LoadingDots } from "components/loadingDots";
import { Conversation, DataState } from "dataState";
import * as React from "react";
import { assert } from "utilities/errors";
import { logError } from "utilities/logger";
import { useIsMounted } from "utilities/useIsMounted";

const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "short" });

interface ConversationDetailsEntryProps {
  name: string;
  contents: string[];
}

function ConversationDetailsEntry(props: ConversationDetailsEntryProps): React.JSX.Element | null {
  if (props.contents.length === 0) {
    return null;
  }

  return (
    <div className="entry">
      <div className="name">
        {props.name}
      </div>
      <div className="contents">
        {props.contents.map((v, i) => <div key={i}>{v}</div>)}
      </div>
    </div>
  );
}

function showConversationDetailsDialog(conversation: Conversation): void {
  void showDialog(
    (dialogProps) => {
      return (
        <div className="options-dialog-container">
          <h3>Conversation details</h3>
          <div className="conversation-details">
            <ConversationDetailsEntry name="Conversation topic" contents={[conversation.conversationTopic]} />
            <ConversationDetailsEntry name="Study topics" contents={conversation.studyTopics} />
            <ConversationDetailsEntry name="Study words" contents={conversation.studyWords} />
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
    null,
    { width: "Small" });
}

interface ConversationEntryProps {
  language: string;
  conversation: Conversation;
  selected: boolean;
  onChangeSelected: (selected: boolean) => void;
}

function ConversationEntry(props: ConversationEntryProps): React.JSX.Element {
  return (
    <div className="conversation">
      <div className="description">
        <div className="name">{props.conversation.conversationTopic}</div>
        <div>{dateTimeFormat.format(props.conversation.date)}</div>
      </div>
      <Button
        type="button"
        appearance="IconOnly"
        color="Primary"
        icon={faList}
        tooltip="Conversation details"
        onClick={() => showConversationDetailsDialog(props.conversation)}
      />
      <ButtonLink
        to={`/${props.language}/conversations/${props.conversation.id}`}
        appearance="IconOnly"
        color="Primary"
        icon={faLink}
        tooltip="Go to conversation"
      />
      <Checkbox checked={props.selected} onChange={props.onChangeSelected} />
    </div>
  );
}

interface ConversationsPageProps {
  dataState: DataState;
  language: string;
}

export function ConversationsPage(props: ConversationsPageProps): React.JSX.Element {
  const [conversations, setConversations] = React.useState<Conversation[] | null>(null);
  const [selectedConversations, setSelectedConversations] = React.useState(() => new Set<string>());
  const [deleting, setDeleting] = React.useState(false);

  const conversationsElement = React.useRef<HTMLDivElement | null>(null);
  const [conversationsWidth, setConversationsWidth] = React.useState(0);

  const isMounted = useIsMounted();

  React.useEffect(
    () => {
      props.dataState
        .getConversations(props.language)
        .then(
          (conversationsInner) => {
            if (isMounted.current) {
              setConversations(conversationsInner);
            }
          })
        .catch(
          (error: unknown) => {
            logError(error);
            if (isMounted.current) {
              setConversations([]);
              void showErrorDialog("Error", "Failed to list conversations.");
            }
          });
    },
    []);

  React.useLayoutEffect(
    () => {
      if (conversations !== null && conversations.length > 0) {
        assert(conversationsElement.current !== null);
        const resizeObserver = new ResizeObserver((entries) => setConversationsWidth(entries[0].target.getBoundingClientRect().width));
        resizeObserver.observe(conversationsElement.current);
        return () => resizeObserver.disconnect();
      } else {
        return () => { };
      }
    },
    [conversations]);

  function handleChangeConversationSelected(conversationId: string, selected: boolean): void {
    const newSelectedConversations = new Set([...selectedConversations]);
    if (selected) {
      newSelectedConversations.add(conversationId);
    } else {
      newSelectedConversations.delete(conversationId);
    }

    setSelectedConversations(newSelectedConversations);
  }

  function handleChangeSelectAll(value: boolean): void {
    setSelectedConversations(new Set(value ? conversations?.map((v) => v.id) ?? [] : []));
  }

  async function handleClickDelete(): Promise<void> {
    const result = await showOptionsDialog(
      "Delete conversations?",
      "Are you sure you wish to deleted the selected conversations? This cannot be undone.",
      [
        { text: "Cancel", color: "Gray" },
        { text: "Delete", color: "Primary" },
      ]);
    if (result === 0) {
      return;
    }

    setDeleting(true);
    try {
      await props.dataState.deleteConversations(props.language, [...selectedConversations]);
      setConversations((v) => v?.filter((x) => !selectedConversations.has(x.id)) ?? null);
      setSelectedConversations(new Set());
    } catch {
      void showErrorDialog("Error", "Failed to deleted the selected conversations.");
    } finally {
      setDeleting(false);
    }
  }

  const selectAllValue: TriStateCheckboxValue = selectedConversations.size === 0
    ? "Unchecked"
    : selectedConversations.size === (conversations?.length ?? 0)
      ? "Checked"
      : "Indeterminate";

  return (
    <div className="conversations-page">
      <div className="top-bar">
        <ButtonLink to="/" appearance="IconOnly" color="Gray" icon={faCircleArrowLeft} tooltip="Back" />
        <h2>Conversations</h2>
      </div>
      {
        conversations === null
          ? (
            <div className="centered">
              <LoadingDots />
            </div>
          )
          : (
            conversations.length === 0
              ? <h2 className="centered">No conversations</h2>
              : (
                <>
                  <div className="select-all-container" style={{ width: conversationsWidth }}>
                    <TriStateCheckbox value={selectAllValue} onChange={handleChangeSelectAll} />
                  </div>
                  <div className="scroll-container">
                    <div ref={conversationsElement} className="conversations">
                      {
                        conversations.map(
                          (conversation) => (
                            <ConversationEntry
                              key={conversation.id}
                              language={props.language}
                              conversation={conversation}
                              selected={selectedConversations.has(conversation.id)}
                              onChangeSelected={(v) => handleChangeConversationSelected(conversation.id, v)}
                            />
                          ))
                      }
                    </div>
                  </div>
                </>
              ))
      }
      <div className="controls">
        <Button
          type="button"
          appearance="Standard"
          color="Primary"
          disabled={selectedConversations.size === 0 || deleting}
          onClick={() => void handleClickDelete()}
          text="Delete selected conversations"
        />
      </div>
    </div>
  );
}