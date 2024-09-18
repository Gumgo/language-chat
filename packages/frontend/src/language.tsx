import { doThrow } from "utilities/errors";

interface Language {
  name: string;
  ietfLanguageTag: string;
}

const languages: Language[] = [
  { name: "Spanish", ietfLanguageTag: "sp" },
  { name: "Japanese", ietfLanguageTag: "ja" },
  { name: "French", ietfLanguageTag: "fr" },
];

export const supportedLanguages: readonly string[] = languages.map((v) => v.name);

export function getIetfLanguageTag(language: string): string {
  return languages.find((v) => v.name === language)?.ietfLanguageTag ?? doThrow(new Error(`Unsupported language: ${language}`));
}
