import { faCircleArrowLeft, faList, faWrench } from "@fortawesome/free-solid-svg-icons";
import { Button, ButtonLink } from "components/button";
import { Checkbox, TriStateCheckbox, TriStateCheckboxValue } from "components/checkbox";
import { LoadingDots } from "components/loadingDots";
import { TextInput } from "components/textInput";
import * as React from "react";
import { assert } from "utilities/errors";

interface ListPageTopBarProps {
  title: string;
  backButtonAction: string | (() => void);
  onClickActions?: () => void;
}

function ListPageTopBar(props: ListPageTopBarProps): React.JSX.Element {
  return (
    <div className="top-bar">
      {
        typeof props.backButtonAction === "string"
          ? <ButtonLink to={props.backButtonAction} appearance="IconOnly" color="Gray" icon={faCircleArrowLeft} tooltip="Back" />
          // eslint-disable-next-line react/jsx-handler-names
          : <Button type="button" appearance="IconOnly" color="Gray" icon={faCircleArrowLeft} tooltip="Back" onClick={props.backButtonAction} />
      }
      <h2>{props.title}</h2>
      {
        props.onClickActions !== undefined && (
          <Button
            type="button"
            appearance="IconOnly"
            color="Gray"
            icon={faWrench}
            tooltip="Actions"
            onClick={props.onClickActions}
          />
        )
      }
    </div>
  );
}

interface ListPageListEntryProps {
  title: string;
  details?: string;
  selected: boolean;
  onClickDetails: () => void;
  onChangeSelected: (selected: boolean) => void;
}

function ListPageListEntry(props: ListPageListEntryProps): React.JSX.Element {
  return (
    <div className="list-entry">
      <div className="description">
        <div className="title">{props.title}</div>
        {(props.details?.length ?? 0) > 0 && <div>{props.details}</div>}
      </div>
      <Button
        type="button"
        appearance="IconOnly"
        color="Primary"
        icon={faList}
        tooltip="Details"
        onClick={props.onClickDetails}
      />
      <Checkbox checked={props.selected} onChange={props.onChangeSelected} />
    </div>
  );
}

export interface ListPageListEntryData {
  id: string;
  title: string;
  details?: string;
  data?: unknown;
}

interface ListPageProps {
  title: string;
  noEntriesMessage: string;
  backButtonAction: string | (() => void);
  onClickActions?: () => void;
  entries: ListPageListEntryData[] | null;
  setSelectedFilteredEntryIds: (selectedFilteredEntryIds: Set<string>) => void;
  filterEntries: (entries: ListPageListEntryData[], searchText: string, filterDate: Date) => ListPageListEntryData[];
  renderEntryDetails: (entry: ListPageListEntryData, onClose: () => void) => React.JSX.Element;
}

export function ListPage(props: React.PropsWithChildren<ListPageProps>): React.JSX.Element {
  const [searchText, setSearchText] = React.useState("");
  const [filterDate, setFilterDate] = React.useState(() => new Date());

  const entriesElement = React.useRef<HTMLDivElement | null>(null);
  const [scrollbarWidth, setScrollbarWidth] = React.useState(0);

  const [selectedEntryIds, setSelectedEntryIds] = React.useState(() => new Set<string>());
  const [activeEntry, setActiveEntry] = React.useState<ListPageListEntryData | null>(null);

  const scrollContainerElement = React.useRef<HTMLDivElement | null>(null);
  const entriesScrollPosition = React.useRef<number | null>();

  // Set the date once up-front so that it doesn't change after the page has loaded
  React.useEffect(
    () => setFilterDate(new Date()),
    []);

  React.useLayoutEffect(
    () => {
      if (props.entries !== null && props.entries.length > 0) {
        assert(entriesElement.current !== null);
        const resizeObserver = new ResizeObserver(
          (entries) => {
            const width = entries[0].target.getBoundingClientRect().width;
            const parent = entries[0].target.parentElement;
            assert(parent !== null);
            const parentWidth = parent.getBoundingClientRect().width;
            setScrollbarWidth(parentWidth - width);
          });
        resizeObserver.observe(entriesElement.current);
        return () => resizeObserver.disconnect();
      } else {
        return () => { };
      }
    },
    [props.entries]);

  React.useLayoutEffect(
    () => {
      if (activeEntry === null && scrollContainerElement.current !== null && entriesScrollPosition.current !== null) {
        scrollContainerElement.current.scrollTo({ top: entriesScrollPosition.current });
        entriesScrollPosition.current = null;
      }
    });

  React.useLayoutEffect(
    () => {
      if (props.entries === null) {
        setSelectedEntryIds(new Set());
        return;
      }

      const entryIds = new Set(props.entries.map((v) => v.id));
      if ([...selectedEntryIds].some((id) => !entryIds.has(id))) {
        const newSelectedEntryIds = new Set<string>();
        for (const id of selectedEntryIds) {
          if (entryIds.has(id)) {
            newSelectedEntryIds.add(id);
          }
        }

        setSelectedEntryIds(newSelectedEntryIds);
      }
    },
    [props.entries]);

  const filteredEntries = React.useMemo(
    () => {
      if (props.entries === null) {
        return null;
      }

      return props.filterEntries(props.entries, searchText, filterDate);
    },
    [props.entries, searchText, filterDate]);

  function handleChangeEntrySelected(entryId: string, selected: boolean): void {
    const newSelectedEntryIds = new Set(selectedEntryIds);
    if (selected) {
      newSelectedEntryIds.add(entryId);
    } else {
      newSelectedEntryIds.delete(entryId);
    }

    setSelectedEntryIds(newSelectedEntryIds);
  }

  function handleChangeSelectAll(value: boolean): void {
    const newSelectedEntryIds = new Set(selectedEntryIds);
    for (const entry of filteredEntries ?? []) {
      if (value) {
        newSelectedEntryIds.add(entry.id);
      } else {
        newSelectedEntryIds.delete(entry.id);
      }
    }

    setSelectedEntryIds(newSelectedEntryIds);
  }

  function handleCloseEntryDetails(): void {
    setActiveEntry(null);
  }

  function handleClickEntryDetails(entry: ListPageListEntryData): void {
    entriesScrollPosition.current = scrollContainerElement.current?.scrollTop ?? null;
    setActiveEntry(entry);
  }

  const selectedFilteredEntryIds = React.useMemo(
    () => new Set(filteredEntries?.filter((entry) => selectedEntryIds.has(entry.id)).map((entry) => entry.id) ?? []),
    [filteredEntries, selectedEntryIds]);

  React.useLayoutEffect(() => props.setSelectedFilteredEntryIds(selectedFilteredEntryIds), [selectedFilteredEntryIds]);

  const selectAllValue: TriStateCheckboxValue = selectedFilteredEntryIds.size === 0
    ? "Unchecked"
    : selectedFilteredEntryIds.size === (filteredEntries?.length ?? 0)
      ? "Checked"
      : "Indeterminate";

  const sortedEntries = React.useMemo(
    () => filteredEntries?.toSorted((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" })) ?? null,
    [filteredEntries]);

  if (activeEntry !== null) {
    props.renderEntryDetails(activeEntry, handleCloseEntryDetails);
  }

  if (activeEntry !== null) {
    return (
      <div className="list-page">
        <ListPageTopBar
          title={activeEntry.title}
          backButtonAction={handleCloseEntryDetails}
        />
        {props.renderEntryDetails(activeEntry, handleCloseEntryDetails)}
      </div>
    );
  }

  return (
    <div className="list-page">
      <ListPageTopBar
        title={props.title}
        backButtonAction={props.backButtonAction}
        onClickActions={props.onClickActions}
      />
      {
        (() => {
          if (props.entries === null) {
            return (
              <div className="centered">
                <LoadingDots />
              </div>
            );
          }

          if (props.entries.length === 0) {
            return <h2 className="centered">{props.noEntriesMessage}</h2>;
          }

          return (
            <>
              {/* Note: for some reason, in Chrome, a "search" input doesn't pop up with the Kanji completion box in Chrome so I'm not using it */}
              <TextInput className="search" value={searchText} onChangeValue={setSearchText} placeholder="Search" />
              <div className="select-all-container" style={{ marginRight: scrollbarWidth }}>
                <TriStateCheckbox value={selectAllValue} onChange={handleChangeSelectAll} />
              </div>
              <div ref={scrollContainerElement} className="scroll-container">
                <div ref={entriesElement} className="list-entries">
                  {
                    (sortedEntries ?? []).map(
                      (entry) => (
                        <ListPageListEntry
                          key={entry.id}
                          title={entry.title}
                          details={entry.details}
                          selected={selectedEntryIds.has(entry.id)}
                          onClickDetails={() => handleClickEntryDetails(entry)}
                          onChangeSelected={(v) => handleChangeEntrySelected(entry.id, v)}
                        />
                      ))
                  }
                </div>
              </div>
            </>
          );
        })()
      }
      {
        React.Children.count(props.children) > 0 && (
          <div className="controls">
            {props.children}
          </div>
        )
      }
    </div>
  );
}