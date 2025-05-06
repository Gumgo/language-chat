import { ListVoicesApiResponseVoice } from "api";
import { Button } from "components/button";
import { showDialog, showErrorDialog, showMessageDialog, showOptionsDialog } from "components/dialog";
import { TextArea } from "components/textArea";
import { TextInput } from "components/textInput";
import { DataState, VocabularyEntry } from "dataState";
import { showListeningPracticeDialog } from "dialogs/listeningPracticeDialog";
import { showStoryPracticeDialog } from "dialogs/storyPracticeDialog";
import { showVocabularyActionsDialog } from "dialogs/vocabularyActionsDialog";
import { ListPage, ListPageListEntryData } from "pages/listPage";
import * as React from "react";
import { doThrow } from "utilities/errors";
import { logError } from "utilities/logger";
import { useIsMounted } from "utilities/useIsMounted";
import { fetchWaniKaniData, initializeWaniKaniVocabularyEntry } from "utilities/waniKani";

function characterRange(start: string, end: string): string[] {
  const startCharCode = start.charCodeAt(0);
  const endCharCode = end.charCodeAt(0);
  const result: string[] = [];
  for (let i = startCharCode; i <= endCharCode; i++) {
    result.push(String.fromCharCode(i));
  }

  return result;
}

const allowedTagCharacters = new Set(
  [
    ...characterRange("a", "z"),
    ...characterRange("0", "9"),
    "-",
  ]);

function fixupTags(rawTags: string): string[] {
  return rawTags
    .split(" ")
    .map((tag) => [...tag.trim().toLocaleLowerCase()].filter((v) => allowedTagCharacters.has(v)).join(""))
    .filter((tag) => tag.length > 0);
}

function runSearchQuery(vocabularyEntries: VocabularyEntry[], searchQuery: string, filterDate: Date): VocabularyEntry[] {
  const searchTextParts = searchQuery.trim().toLocaleLowerCase().split(" ");
  if (searchTextParts.length === 0) {
    return vocabularyEntries;
  }

  const words: string[] = [];
  const includeTags: string[] = [];
  const excludeTags: string[] = [];
  const includeNewerThan: number[] = [];
  const includeOlderThan: number[] = [];
  const excludeNewerThan: number[] = [];
  const excludeOlderThan: number[] = [];
  for (const part of searchTextParts) {
    if (part.startsWith("+")) {
      const remaining = part.substring(1);
      if (remaining.startsWith("<")) {
        const days = parseFloat(remaining.substring(1));
        if (!isNaN(days) && days >= 0) {
          includeOlderThan.push(days);
        }
      } else if (remaining.startsWith(">")) {
        const days = parseFloat(remaining.substring(1));
        if (!isNaN(days) && days >= 0) {
          includeNewerThan.push(days);
        }
      } else {
        includeTags.push(remaining);
      }
    } else if (part.startsWith("-")) {
      const remaining = part.substring(1);
      if (remaining.startsWith("<")) {
        const days = parseFloat(remaining.substring(1));
        if (!isNaN(days) && days >= 0) {
          excludeOlderThan.push(days);
        }
      } else if (remaining.startsWith(">")) {
        const days = parseFloat(remaining.substring(1));
        if (!isNaN(days) && days >= 0) {
          excludeNewerThan.push(days);
        }
      } else {
        excludeTags.push(remaining);
      }
    } else {
      words.push(part);
    }
  }

  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  return vocabularyEntries.filter(
    (entry) => {
      if (excludeTags.some((tag) => entry.tags.includes(tag))
        || excludeNewerThan.some((days) => entry.creationDate.getTime() > filterDate.getTime() - days * millisecondsPerDay)
        || excludeOlderThan.some((days) => entry.creationDate.getTime() < filterDate.getTime() - days * millisecondsPerDay)) {
        return false;
      }

      if (includeTags.some((tag) => entry.tags.includes(tag))
        || includeNewerThan.some((days) => entry.creationDate.getTime() > filterDate.getTime() - days * millisecondsPerDay)
        || includeOlderThan.some((days) => entry.creationDate.getTime() < filterDate.getTime() - days * millisecondsPerDay)) {
        return true;
      }

      const wordLower = entry.word.toLocaleLowerCase();
      const translationLower = entry.translation.toLocaleLowerCase();
      return words.some((word) => wordLower.includes(word) || translationLower.includes(word));
    });
}

interface VocabularyEntryDetailsProps {
  dataState: DataState;
  language: string;
  vocabularyEntry: VocabularyEntry;
  onClose: (updatedVocabularyEntry: VocabularyEntry | null) => void;
}

function VocabularyEntryDetails(props: VocabularyEntryDetailsProps): React.JSX.Element {
  const [translation, setTranslation] = React.useState(props.vocabularyEntry.translation);
  const [notes, setNotes] = React.useState(props.vocabularyEntry.notes);
  const [tags, setTags] = React.useState(() => props.vocabularyEntry.tags.join(" "));
  const [savingChanges, setSavingChanges] = React.useState(false);

  const trimmedTranslation = translation.trim();
  const tagsArray = fixupTags(tags);

  async function handleClickSaveChanges(): Promise<void> {
    setSavingChanges(true);
    try {
      await props.dataState.updateVocabularyEntry(props.language, props.vocabularyEntry.word, trimmedTranslation, notes, tagsArray);
      props.onClose(
        {
          creationDate: props.vocabularyEntry.creationDate,
          word: props.vocabularyEntry.word,
          translation: trimmedTranslation,
          notes,
          tags: tagsArray,
          listeningSrsReviews: props.vocabularyEntry.listeningSrsReviews,
        });
    } catch {
      void showErrorDialog("Error", "Failed to update the vocabulary.");
    } finally {
      setSavingChanges(false);
    }
  }

  const fixedUpTags = tagsArray.join(" ");
  const initialTags = props.vocabularyEntry.tags.join(" ");
  const isValid = trimmedTranslation.length > 0;
  const anyChanges = trimmedTranslation !== props.vocabularyEntry.translation
    || notes !== props.vocabularyEntry.notes
    || fixedUpTags !== initialTags;

  return (
    <>
      <TextInput value={translation} onChangeValue={setTranslation} placeholder="Translation" />
      <TextArea className="vocabulary-notes" value={notes} onChangeValue={setNotes} placeholder="Notes" />
      <TextInput value={tags} onChangeValue={setTags} onBlur={() => setTags(fixedUpTags)} placeholder="Tags" />
      <div className="controls">
        <Button
          type="button"
          appearance="Standard"
          color="Primary"
          disabled={!isValid || !anyChanges || savingChanges}
          onClick={() => void handleClickSaveChanges()}
          text="Save changes"
        />
      </div>
    </>
  );
}

async function showAddVocabularyEntryDialog(vocabularyEntries: VocabularyEntry[], initialState?: VocabularyEntry): Promise<VocabularyEntry | null> {
  return await showDialog(
    (dialogProps) => {
      const [word, setWord] = React.useState(initialState?.word ?? "");
      const [translation, setTranslation] = React.useState(initialState?.translation ?? "");
      const [notes, setNotes] = React.useState(initialState?.notes ?? "");
      const [tags, setTags] = React.useState(initialState?.tags.join(" ") ?? "");

      const trimmedWord = word.trim();
      const trimmedTranslation = translation.trim();
      const tagsArray = fixupTags(tags);
      const fixedUpTags = tagsArray.join(" ");
      const canAdd = trimmedWord.length > 0
        && vocabularyEntries.every((entry) => entry.word !== trimmedWord)
        && trimmedTranslation.length > 0;

      function getVocabularyEntry(): VocabularyEntry {
        return { creationDate: new Date(), word: trimmedWord, translation: trimmedTranslation, notes, tags: tagsArray, listeningSrsReviews: new Map() };
      }

      return (
        <div className="options-dialog-container">
          <h3>Add vocabulary</h3>
          <div className="add-vocabulary-entry-settings">
            <div className="name">Word</div>
            <TextInput value={word} onChangeValue={setWord} />
            <div className="name">Translation</div>
            <TextInput value={translation} onChangeValue={setTranslation} />
            <div className="name">Notes</div>
            <TextArea className="notes" value={notes} onChangeValue={setNotes} />
            <div className="name">Tags</div>
            <TextInput value={tags} onChangeValue={setTags} onBlur={() => setTags(fixedUpTags)} />
          </div>
          <div className="buttons">
            <Button
              type="button"
              appearance="Standard"
              color="Gray"
              text="Close"
              onClick={() => dialogProps.onClose(null)}
            />
            <Button
              type="button"
              appearance="Standard"
              color="Primary"
              text="Add"
              disabled={!canAdd}
              onClick={() => dialogProps.onClose(getVocabularyEntry())}
            />
          </div>
        </div>
      );
    },
    undefined,
    { width: "Normal" }) as VocabularyEntry | null;
}

interface VocabularyPageProps {
  dataState: DataState;
  language: string;
  voices: Map<string, ListVoicesApiResponseVoice[]>;
}

export function VocabularyPage(props: VocabularyPageProps): React.JSX.Element {
  const [waniKaniApiKey, setWaniKaniApiKey] = React.useState<string | null>(null);
  const [vocabularyEntries, setVocabularyEntries] = React.useState<VocabularyEntry[] | null>(null);
  const [selectedFilteredVocabularyWords, setSelectedFilteredVocabularyWords] = React.useState(() => new Set<string>());
  const [deleting, setDeleting] = React.useState(false);

  const isMounted = useIsMounted();

  React.useEffect(
    () => {
      if (props.language !== "Japanese") {
        return;
      }

      props.dataState
        .getWaniKaniApiKey()
        .then(
          (waniKaniApiKeyInner) => {
            if (isMounted.current) {
              setWaniKaniApiKey(waniKaniApiKeyInner);
            }
          })
        .catch(
          (error: unknown) => {
            logError(error);
            if (isMounted.current) {
              void showErrorDialog("Error", "Failed to get WaniKani API key.");
            }
          });
    },
    []);

  React.useEffect(
    () => {
      props.dataState
        .getVocabularyEntries(props.language)
        .then(
          (vocabularyEntriesInner) => {
            if (isMounted.current) {
              setVocabularyEntries(vocabularyEntriesInner);
            }
          })
        .catch(
          (error: unknown) => {
            logError(error);
            if (isMounted.current) {
              setVocabularyEntries([]);
              void showErrorDialog("Error", "Failed to list vocabulary entries.");
            }
          });
    },
    []);

  async function handleClickAdd(): Promise<void> {
    const vocabularyEntry = await showAddVocabularyEntryDialog(vocabularyEntries ?? []);
    if (vocabularyEntry === null) {
      return;
    }

    try {
      await props.dataState.createVocabularyEntry(
        props.language,
        vocabularyEntry.word,
        vocabularyEntry.translation,
        vocabularyEntry.notes,
        vocabularyEntry.tags);
      setVocabularyEntries((v) => [...v ?? [], vocabularyEntry]);
    } catch {
      void showErrorDialog("Error", "Failed to add the vocabulary.");
    }
  }

  async function handleClickDelete(): Promise<void> {
    const result = await showOptionsDialog(
      "Delete vocabulary?",
      "Are you sure you wish to deleted the selected vocabulary? This cannot be undone.",
      [
        { text: "Cancel", color: "Gray" },
        { text: "Delete", color: "Primary" },
      ]);
    if (result === 0) {
      return;
    }

    setDeleting(true);
    try {
      await props.dataState.deleteVocabularyEntries(props.language, [...selectedFilteredVocabularyWords]);
      setVocabularyEntries((entries) => entries?.filter((entry) => !selectedFilteredVocabularyWords.has(entry.word)) ?? null);
    } catch {
      void showErrorDialog("Error", "Failed to deleted the selected vocabulary.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleClickSyncWithWaniKani(): Promise<void> {
    if (waniKaniApiKey === null || vocabularyEntries === null) {
      return;
    }

    const waniKaniData = await fetchWaniKaniData(waniKaniApiKey);
    if (waniKaniData === null) {
      return;
    }

    let anyEntries = false;
    for (const assignment of waniKaniData.assignments) {
      const subject = waniKaniData.subjects.get(assignment.data.subject_id) ?? doThrow(new Error("WaniKani subject not found for assignment"));

      const entryExists = vocabularyEntries.some((v) => v.word === subject.data.characters);
      if (entryExists) {
        continue;
      }

      anyEntries = true;
      const initialState = initializeWaniKaniVocabularyEntry(subject);

      const vocabularyEntry = await showAddVocabularyEntryDialog(vocabularyEntries, initialState);
      if (vocabularyEntry === null) {
        return;
      }

      try {
        await props.dataState.createVocabularyEntry(
          props.language,
          vocabularyEntry.word,
          vocabularyEntry.translation,
          vocabularyEntry.notes,
          vocabularyEntry.tags);
        setVocabularyEntries((v) => [...v ?? [], vocabularyEntry]);
      } catch {
        await showErrorDialog("Error", "Failed to add the vocabulary.");
      }
    }

    if (!anyEntries) {
      void showMessageDialog("Nothing to sync", "All vocabulary entries are up to date.");
    }
  }

  function handleCloseVocabularyEntryDetails(updatedVocabularyEntry: VocabularyEntry | null): void {
    if (updatedVocabularyEntry !== null) {
      setVocabularyEntries((v) => v?.map((entry) => (entry.word === updatedVocabularyEntry.word ? updatedVocabularyEntry : entry)) ?? []);
    }
  }

  async function handleClickActions(): Promise<void> {
    const action = await showVocabularyActionsDialog(selectedFilteredVocabularyWords.size);
    switch (action) {
    case null:
      break;

    case "CopySelectedWords":
      {
        const selectedWords = [...selectedFilteredVocabularyWords].toSorted();
        const clipboardText = selectedWords.join("\n");
        void navigator.clipboard.writeText(clipboardText);
      }
      break;

    case "ListeningPractice":
      void showListeningPracticeDialog(
        props.language,
        props.voices,
        (vocabularyEntries ?? []).filter((entry) => selectedFilteredVocabularyWords.has(entry.word)));
      break;

    case "StoryPractice":
      void showStoryPracticeDialog(
        props.language,
        props.voices,
        (query) => runSearchQuery(vocabularyEntries ?? [], query, new Date()));
      break;
    }
  }

  const listPageListEntries = React.useMemo<ListPageListEntryData[] | null>(
    () => vocabularyEntries?.map((v) => ({ id: v.word, title: v.word, details: v.translation, data: v })) ?? null,
    [vocabularyEntries]);

  function runSearchQueryWrapper(entries: ListPageListEntryData[], searchQuery: string, filterDate: Date): ListPageListEntryData[] {
    const results = new Set(runSearchQuery(entries.map((v) => v.data as VocabularyEntry), searchQuery, filterDate));
    return entries.filter((v) => results.has(v.data as VocabularyEntry));
  }

  return (
    <ListPage
      title="Vocabulary"
      noEntriesMessage="No vocabulary"
      backButtonAction="/"
      onClickActions={() => void handleClickActions()}
      entries={listPageListEntries}
      setSelectedFilteredEntryIds={setSelectedFilteredVocabularyWords}
      filterEntries={runSearchQueryWrapper}
      renderEntryDetails={
        (entry, onClose) => {
          return (
            <VocabularyEntryDetails
              language={props.language}
              dataState={props.dataState}
              vocabularyEntry={entry.data as VocabularyEntry}
              onClose={
                (updatedVocabularyEntry) => {
                  handleCloseVocabularyEntryDetails(updatedVocabularyEntry);
                  onClose();
                }
              }
            />
          );
        }
      }
    >
      <Button
        type="button"
        appearance="Standard"
        color="Primary"
        onClick={() => void handleClickAdd()}
        text="Add vocabulary"
      />
      <Button
        type="button"
        appearance="Standard"
        color="Primary"
        disabled={selectedFilteredVocabularyWords.size === 0 || deleting}
        onClick={() => void handleClickDelete()}
        text="Delete selected vocabulary"
      />
      {
        waniKaniApiKey !== null && (
          <Button
            type="button"
            appearance="Standard"
            color="Primary"
            onClick={() => void handleClickSyncWithWaniKani()}
            text="Sync with WaniKani"
          />
        )
      }
    </ListPage>
  );
}