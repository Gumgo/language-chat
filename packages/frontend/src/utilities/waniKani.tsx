import { showErrorDialog } from "components/dialog";
import { VocabularyEntry } from "dataState";
import { doThrow } from "utilities/errors";

async function fetchPages(waniKaniApiKey: string, url: string): Promise<unknown[] | null> {
  const headers = { "Authorization": `Bearer ${waniKaniApiKey}` };
  const results: unknown[] = [];
  let pageUrl: string | null = url;
  while (pageUrl !== null) {
    const assignmentsResponse = await fetch(pageUrl, { headers });
    if (assignmentsResponse.status < 200 && assignmentsResponse.status >= 300) {
      void showErrorDialog("Error", "Failed to query WaniKani.");
      return null;
    }

    // Note: this only contains the data we care about
    interface ResponseBody {
      pages: {
        next_url: string | null;
      };
      data: unknown[];
    }

    const bodyJson = await assignmentsResponse.json() as ResponseBody;
    results.push(...bodyJson.data);
    pageUrl = bodyJson.pages.next_url;
  }

  return results;
}

interface Assignment {
  data: {
    subject_id: number;
  };
}

interface Subject {
  data: {
    characters: string;
    meanings: {
      meaning: string;
      primary: boolean;
    }[];
    parts_of_speech: string[];
    reading_mnemonic: string | undefined;
    readings: {
      primary: boolean;
      reading: string;
    }[] | undefined;
  };
  id: number;
}

interface WaniKaniData {
  assignments: Assignment[];
  subjects: Map<number, Subject>;
}

export async function fetchWaniKaniData(waniKaniApiKey: string): Promise<WaniKaniData | null> {
  const assignments =
    await fetchPages(waniKaniApiKey, "https://api.wanikani.com/v2/assignments?started=true&subject_types=vocabulary,kana_vocabulary") as Assignment[] | null;
  if (assignments === null) {
    return null;
  }

  const subjects = await fetchPages(waniKaniApiKey, "https://api.wanikani.com/v2/subjects?types=vocabulary,kana_vocabulary") as Subject[] | null;
  if (subjects === null) {
    return null;
  }

  const subjectsById = new Map(subjects.map((v) => [v.id, v]));
  return { assignments, subjects: subjectsById };
}

export function initializeWaniKaniVocabularyEntry(subject: Subject): VocabularyEntry {
  const meanings = subject.data.meanings.map(
    (meaning) => {
      // Convert to lowercase unless any other non-leading characters are uppercase
      const words = meaning.meaning.split(" ");
      const anyNonLeadingUppercaseLetters = words.some((word) => [...word.substring(1)].some((v) => v !== v.toLocaleLowerCase()));
      const fixedUpMeaning = anyNonLeadingUppercaseLetters ? meaning.meaning : meaning.meaning.toLocaleLowerCase();
      return { meaning: fixedUpMeaning, primary: meaning.primary };
    });

  const notesLines: string[] = [];

  const readings = subject.data.readings === undefined
    ? []
    : [...subject.data.readings.filter((v) => v.primary), ...subject.data.readings.filter((v) => !v.primary)];
  for (const reading of readings) {
    notesLines.push(reading.reading);
  }

  const alternativeMeanings = meanings.filter((v) => !v.primary);
  if (alternativeMeanings.length > 0) {
    notesLines.push(`Also means: ${alternativeMeanings.map((v) => v.meaning).join(", ")}`);
  }

  const tags: string[] = [];
  const partsOfSpeech = subject.data.parts_of_speech.map(
    (partOfSpeech) => {
      switch (partOfSpeech) {
      case "い adjective":
        return "i-adjective";
      case "な adjective":
        return "na-adjective";
      case "の adjective":
        return "no-adjective";
      case "する verb":
        return "suru-verb";
      case "こそあど word":
        return "kosoado";
      default:
        return partOfSpeech.toLocaleLowerCase().replaceAll(" ", "-");
      }
    });

  tags.push(...partsOfSpeech);
  const readingMnemonicLower = subject.data.reading_mnemonic?.toLocaleLowerCase() ?? "";
  if (readingMnemonicLower.includes("jukugo")) {
    tags.push("jukugo");
  }
  if (readingMnemonicLower.includes("rendaku")) {
    tags.push("rendaku");
  }
  if (readingMnemonicLower.includes("exceptional reading")) {
    tags.push("exceptional-reading");
  }

  const vocabularyEntry: VocabularyEntry = {
    creationDate: new Date(),
    word: subject.data.characters,
    translation: meanings.find((meaning) => meaning.primary)?.meaning ?? doThrow(new Error("No primary meaning")),
    notes: notesLines.join("\n"),
    tags,
    listeningSrsReviews: new Map(),
  };

  return vocabularyEntry;
}