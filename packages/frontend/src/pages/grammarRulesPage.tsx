import { ListVoicesApiResponseVoice } from "api";
import { Button } from "components/button";
import { showDialog, showErrorDialog, showOptionsDialog } from "components/dialog";
import { TextArea } from "components/textArea";
import { TextInput } from "components/textInput";
import { DataState, GrammarRuleEntry } from "dataState";
import { showGrammarRuleActionsDialog } from "dialogs/grammarRuleActionsDialog";
import { ListPage, ListPageListEntryData } from "pages/listPage";
import * as React from "react";
import { logError } from "utilities/logger";
import { useIsMounted } from "utilities/useIsMounted";

function runSearchQuery(grammarRuleEntries: GrammarRuleEntry[], searchQuery: string, filterDate: Date): GrammarRuleEntry[] {
  const searchTextParts = searchQuery.trim().toLocaleLowerCase().split(" ");
  if (searchTextParts.length === 0) {
    return grammarRuleEntries;
  }

  const words: string[] = [];
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
      }
    } else {
      words.push(part);
    }
  }

  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  return grammarRuleEntries.filter(
    (entry) => {
      if (excludeNewerThan.some((days) => entry.creationDate.getTime() > filterDate.getTime() - days * millisecondsPerDay)
        || excludeOlderThan.some((days) => entry.creationDate.getTime() < filterDate.getTime() - days * millisecondsPerDay)) {
        return false;
      }

      if (includeNewerThan.some((days) => entry.creationDate.getTime() > filterDate.getTime() - days * millisecondsPerDay)
        || includeOlderThan.some((days) => entry.creationDate.getTime() < filterDate.getTime() - days * millisecondsPerDay)) {
        return true;
      }

      const nameLower = entry.name.toLocaleLowerCase();
      return words.some((word) => nameLower.includes(word));
    });
}

interface GrammarRuleEntryDetailsProps {
  dataState: DataState;
  language: string;
  grammarRuleEntry: GrammarRuleEntry;
  onClose: (updatedGrammarRuleEntry: GrammarRuleEntry | null) => void;
}

function GrammarRuleEntryDetails(props: GrammarRuleEntryDetailsProps): React.JSX.Element {
  // $TODO allow name update too?
  const [description, setDescription] = React.useState(props.grammarRuleEntry.description);
  const [savingChanges, setSavingChanges] = React.useState(false);

  async function handleClickSaveChanges(): Promise<void> {
    setSavingChanges(true);
    try {
      await props.dataState.updateGrammarRuleEntry(props.language, props.grammarRuleEntry.id, props.grammarRuleEntry.name, props.grammarRuleEntry.description);
      props.onClose(
        {
          creationDate: props.grammarRuleEntry.creationDate,
          id: props.grammarRuleEntry.id,
          name: props.grammarRuleEntry.name,
          description,
          listeningSrsReviews: props.grammarRuleEntry.listeningSrsReviews,
        });
    } catch {
      void showErrorDialog("Error", "Failed to update the grammar rule.");
    } finally {
      setSavingChanges(false);
    }
  }

  const isValid = description.length > 0;
  const anyChanges = description !== props.grammarRuleEntry.description;

  return (
    <>
      <TextArea className="grammar-rule-description" value={description} onChangeValue={setDescription} placeholder="Description" />
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

async function showAddGrammarRuleEntryDialog(initialState?: GrammarRuleEntry): Promise<GrammarRuleEntry | null> {
  return await showDialog(
    (dialogProps) => {
      const [name, setName] = React.useState(initialState?.name ?? "");
      const [description, setDescription] = React.useState(initialState?.description ?? "");

      const trimmedName = name.trim();
      const canAdd = trimmedName.length > 0
        && description.length > 0;

      function getGrammarRuleEntry(): GrammarRuleEntry {
        return { creationDate: new Date(), id: "", name: trimmedName, description, listeningSrsReviews: new Map() }; // ID will be filled in later
      }

      return (
        <div className="options-dialog-container">
          <h3>Add grammar rule</h3>
          <div className="add-grammar-rule-entry-settings">
            <div className="name">Name</div>
            <TextInput value={name} onChangeValue={setName} />
            <div className="name">Description</div>
            <TextArea className="description" value={description} onChangeValue={setDescription} />
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
              onClick={() => dialogProps.onClose(getGrammarRuleEntry())}
            />
          </div>
        </div>
      );
    },
    undefined,
    { width: "Normal" }) as GrammarRuleEntry | null;
}

interface GrammarRulesPageProps {
  dataState: DataState;
  language: string;
  voices: Map<string, ListVoicesApiResponseVoice[]>;
}

export function GrammarRulesPage(props: GrammarRulesPageProps): React.JSX.Element {
  const [grammarRuleEntries, setGrammarRuleEntries] = React.useState<GrammarRuleEntry[] | null>(null);
  const [selectedFilteredGrammarRuleIds, setSelectedFilteredGrammarRuleIds] = React.useState(() => new Set<string>());
  const [deleting, setDeleting] = React.useState(false);

  const isMounted = useIsMounted();

  React.useEffect(
    () => {
      props.dataState
        .getGrammarRuleEntries(props.language)
        .then(
          (grammarRuleEntriesInner) => {
            if (isMounted.current) {
              setGrammarRuleEntries(grammarRuleEntriesInner);
            }
          })
        .catch(
          (error: unknown) => {
            logError(error);
            if (isMounted.current) {
              setGrammarRuleEntries([]);
              void showErrorDialog("Error", "Failed to list grammar rule entries.");
            }
          });
    },
    []);

  async function handleClickAdd(): Promise<void> {
    const grammarRuleEntry = await showAddGrammarRuleEntryDialog();
    if (grammarRuleEntry === null) {
      return;
    }

    try {
      const grammarRuleId = await props.dataState.createGrammarRuleEntry(props.language, grammarRuleEntry.name, grammarRuleEntry.description);
      setGrammarRuleEntries((v) => [...v ?? [], { ...grammarRuleEntry, id: grammarRuleId }]);
    } catch {
      void showErrorDialog("Error", "Failed to add the grammar rule.");
    }
  }

  async function handleClickDelete(): Promise<void> {
    const result = await showOptionsDialog(
      "Delete grammar rules?",
      "Are you sure you wish to deleted the selected grammar rules? This cannot be undone.",
      [
        { text: "Cancel", color: "Gray" },
        { text: "Delete", color: "Primary" },
      ]);
    if (result === 0) {
      return;
    }

    setDeleting(true);
    try {
      await props.dataState.deleteGrammarRuleEntries(props.language, [...selectedFilteredGrammarRuleIds]);
      setGrammarRuleEntries((entries) => entries?.filter((entry) => !selectedFilteredGrammarRuleIds.has(entry.id)) ?? null);
    } catch {
      void showErrorDialog("Error", "Failed to deleted the selected grammar rules.");
    } finally {
      setDeleting(false);
    }
  }

  function handleCloseGrammarRuleEntryDetails(updatedGrammarRuleEntry: GrammarRuleEntry | null): void {
    if (updatedGrammarRuleEntry !== null) {
      setGrammarRuleEntries((v) => v?.map((entry) => (entry.id === updatedGrammarRuleEntry.id ? updatedGrammarRuleEntry : entry)) ?? []);
    }
  }

  async function handleClickActions(): Promise<void> {
    const action = await showGrammarRuleActionsDialog(selectedFilteredGrammarRuleIds.size);
    switch (action) {
    case null:
      break;

    case "ListeningPractice":
      // void showGrammarRuleListeningPracticeDialog( // !!!
      //   props.language,
      //   props.voices,
      //   (grammarRuleEntries ?? []).filter((entry) => selectedFilteredGrammarRuleIds.has(entry.id)));
      break;
    }
  }

  const listPageListEntries = React.useMemo<ListPageListEntryData[] | null>(
    () => grammarRuleEntries?.map((v) => ({ id: v.id, title: v.name, data: v })) ?? null,
    [grammarRuleEntries]);

  function runSearchQueryWrapper(entries: ListPageListEntryData[], searchQuery: string, filterDate: Date): ListPageListEntryData[] {
    const results = new Set(runSearchQuery(entries.map((v) => v.data as GrammarRuleEntry), searchQuery, filterDate));
    return entries.filter((v) => results.has(v.data as GrammarRuleEntry));
  }

  return (
    <ListPage
      title="Grammar rules"
      noEntriesMessage="No grammar rules"
      backButtonAction="/"
      onClickActions={() => void handleClickActions()}
      entries={listPageListEntries}
      setSelectedFilteredEntryIds={setSelectedFilteredGrammarRuleIds}
      filterEntries={runSearchQueryWrapper}
      renderEntryDetails={
        (entry, onClose) => {
          return (
            <GrammarRuleEntryDetails
              language={props.language}
              dataState={props.dataState}
              grammarRuleEntry={entry.data as GrammarRuleEntry}
              onClose={
                (updatedVocabularyEntry) => {
                  handleCloseGrammarRuleEntryDetails(updatedVocabularyEntry);
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
        text="Add grammar rule"
      />
      <Button
        type="button"
        appearance="Standard"
        color="Primary"
        disabled={selectedFilteredGrammarRuleIds.size === 0 || deleting}
        onClick={() => void handleClickDelete()}
        text="Delete selected grammar rules"
      />
    </ListPage>
  );
}