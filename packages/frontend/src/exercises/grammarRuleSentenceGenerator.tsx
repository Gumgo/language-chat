import { Agent } from "agent";
import { Model } from "api";
import { GrammarRuleEntry } from "dataState";
import { assert } from "utilities/errors";
import { logInfo } from "utilities/logger";
import { shuffle } from "utilities/shuffle";

const sentenceGenerationTemperature = 1;

function logPromptData(message: unknown): void {
  // Uncomment this for prompt debug logging
  logInfo(message); // !!! I'm leaving this uncommented to shake out bugs in this system
}

export type SentencePartType = "Text" | "PracticeWord" | "FillerWord" | "LockedWord" | "UnknownWord";

export interface SentencePart {
  type: SentencePartType;
  content: string;
  unmodifiedWord?: string;
}

export interface Sentence {
  languageSentenceParts: SentencePart[];
  englishSentence: string;
}

function parseSentence(message: string, practiceWords: string[], fillerWords: string[]): Sentence {
  const lines = message.split("\n").filter((v) => v.length > 0); // Ignore extra empty linebreaks, sometimes they occur
  if (lines.length !== 2) {
    throw new Error("Invalid grammar rule practice message: incorrect line count");
  }

  const [languageSentence, englishSentence] = lines;
  const languageSentenceParts: SentencePart[] = [];
  let remainingLanguageSentence = languageSentence;
  while (remainingLanguageSentence.length > 0) {
    const nextWordIndex = remainingLanguageSentence.indexOf("[[");
    if (nextWordIndex >= 0) {
      if (nextWordIndex > 0) {
        languageSentenceParts.push({ type: "Text", content: remainingLanguageSentence.substring(0, nextWordIndex) });
        remainingLanguageSentence = remainingLanguageSentence.substring(nextWordIndex);
      }

      const endIndex = remainingLanguageSentence.indexOf("]]");
      if (endIndex < 0) {
        throw new Error("Invalid grammar rule practice message: no matching ]] for [[");
      }

      const wordAndUnmodifiedWord = remainingLanguageSentence.substring(2, endIndex).split("|");
      if (wordAndUnmodifiedWord.length !== 2) {
        throw new Error("Invalid grammar rule practice message: incorrect word and unmodified word division");
      }

      const [word, unmodifiedWord] = wordAndUnmodifiedWord;
      let type: SentencePartType = "UnknownWord";
      if (practiceWords.includes(unmodifiedWord)) {
        type = "PracticeWord";
      } else if (fillerWords.includes(unmodifiedWord)) {
        type = "FillerWord";
      }

      languageSentenceParts.push({ type, content: word, unmodifiedWord });
      remainingLanguageSentence = remainingLanguageSentence.substring(endIndex + 2);
    } else {
      languageSentenceParts.push({ type: "Text", content: remainingLanguageSentence });
      remainingLanguageSentence = "";
    }
  }

  return { languageSentenceParts, englishSentence };
}

export class GrammarRuleSentenceGenerator {
  private readonly language: string;
  private readonly model: Model;
  private readonly agent: Agent = new Agent();
  private readonly grammarRule: GrammarRuleEntry;
  private readonly practiceWords: string[];
  private readonly fillerWords: string[];

  private sentence: Sentence | null = null;

  public constructor(language: string, model: Model, grammarRule: GrammarRuleEntry, practiceWords: string[], fillerWords: string[]) {
    this.language = language;
    this.model = model;
    this.grammarRule = grammarRule;
    this.practiceWords = practiceWords;
    this.fillerWords = fillerWords;
  }

  public async generateSentence(): Promise<"Success" | "BadGrammarRule" | "IncompatibleWords"> {
    let prompt = `The user is learning ${this.language} and wants to practice grammar. They have learned the following grammar rule: ${this.grammarRule.name}. `
      + "Here is a short description of this rule:\n\n"
      + `${this.grammarRule.description}\n\n`
      + "If you cannot understand this grammar rule or if something is wrong with it (e.g. its description is inaccurate), respond with the following message "
      + "and nothing else:\n\n$BAD_GRAMMAR_RULE\n\nOtherwise, please continue following these instructions.\n\n";

    if (this.practiceWords.length > 0) {
      const shuffledPracticeWords = shuffle(this.practiceWords); // Shuffle to try to improve variation in responses
      prompt += `In addition to practicing grammar, here is a list of words the user wishes to practice:\n\n${shuffledPracticeWords.join("\n")}\n\nI will `
        + "refer to this list as the 'practice words' list.\n\n";
    }

    if (this.fillerWords.length > 0) {
      const shuffledFillerWords = shuffle(this.fillerWords); // Shuffle to try to improve variation in responses
      prompt += `Here are some${this.practiceWords.length > 0 ? " additional" : ""} words that the user has learned: \n\n${shuffledFillerWords.join("\n")}\n\n`
        + "I will refer to this list as the 'filler words' list.\n\n";
    }

    prompt += "Your task is to generate a sentence so that the user can practice this grammar rule.\n\n";

    let step = 1;
    if (this.practiceWords.length > 0 || this.fillerWords.length > 0) {
      if (this.practiceWords.length > 0) {
        prompt += `STEP ${step}: Choose some words from the practice word list which would work well with the grammar rule.\n\n`;
      } else if (this.fillerWords.length > 0) {
        prompt += `STEP ${step}: Choose some words from the filler word list which would work well with the grammar rule.\n\n`;
      }
      step++;

      prompt += `STEP ${step}: Generate a sentence which uses the grammar rule and the chosen words. `;

      if (this.practiceWords.length > 0 && this.fillerWords.length > 0) {
        prompt += "You may use words in the filler word list in the sentence as well. ";
      }

      prompt += "Try to avoid using complex words which have not been listed unless they are grammatically necessary. You may modify any of the words chosen "
        + "as necessary (for example, verbs may be conjugated as needed) as long as the modification does not deviate unnecessarily far from the word's base "
        + "meaning/form. However, the generated sentence should still be meaningful. Don't sacrifice meaning just for the sake of using listed words. "
        + "An example of a *BAD* generated sentence would be 'The cat is bigger than three days.', even if 'cat' and 'three days' are listed words.\n\n";

      prompt += "If you are unable to find any combination of listed words that will work with the grammar rule, respond with the following message and "
        + "nothing else:\n\n$INCOMPATIBLE_WORDS\n\nOtherwise, please continue following these instructions.\n\n";
      step++;

      prompt += `STEP ${step}: Provide an English translation of the sentence.`;
    }

    logPromptData(prompt);
    this.agent.addMessage("System", prompt);
    const chatResponse = await this.agent.getResponse(this.model, sentenceGenerationTemperature);
    logPromptData(chatResponse.message);

    const message = chatResponse.message.trim();
    if (message === "$BAD_GRAMMAR_RULE") {
      return "BadGrammarRule";
    } else if (message === "$INCOMPATIBLE_WORDS") {
      return "IncompatibleWords";
    }

    return "Success";
  }

  public async reviewGrammarRuleUsage(): Promise<boolean> {
    const prompt = "Now please review the sentence you generated. It should demonstrate a clear use case of the grammar rule. For example:\n"
      + "  - If the grammar rule describes how to conjugate a verb in the past tense, the generated sentence must contain a verb in the past tense.\n"
      + "  - If the grammar rule dictates how to use a certain pronoun, the sentence should contain the correct usage of that pronoun.\n"
      + "  - If the grammar is focusing on the usage of a set expression, the sentence should use that expression.\n"
      + "\n"
      + "If the sentence does NOT make clear use of the grammar rule in a manner that is appropriate for a language learner, respond with the following "
      + "message and nothing else:\n\n"
      + "$BAD_GRAMMAR_RULE_USAGE\n\n"
      + "Otherwise, if the sentence does make clear use of the grammar rule and helps reinforce the grammar structure, respond with the following message and "
      + "nothing else:\n\n"
      + "$OK";

    logPromptData(prompt);
    this.agent.addMessage("System", prompt);
    const chatResponse = await this.agent.getResponse(this.model, 0);
    logPromptData(chatResponse.message);

    const message = chatResponse.message.trim();
    if (message === "$BAD_GRAMMAR_RULE_USAGE") {
      return false;
    } else if (message !== "$OK") {
      throw new Error("Invalid grammar rule usage analysis response");
    }

    return true;
  }

  public async reviewMeaning(): Promise<boolean> {
    const prompt = "Now please review the sentence you generated once more. You are evaluating whether it is appropriate for a language learner. The sentence "
      + "may be grammatically correct, but your task is to decide whether its meaning is strange, confusing, or unhelpful for someone trying to learn the "
      + "grammar. A sentence should be marked $BAD_MEANING if it:\n"
      + "  - Is conceptually absurd or physically implausible (e.g. 'The pencil ran faster than the car')\n"
      + "  - Combines incompatible ideas (e.g. 'He drank three ideas')\n"
      + "  - Makes arbitrary or confusing comparisons or statements without context (e.g. 'One person is heavier than three people')\n"
      + "  - Describes situations that are so unlikely or specific that they distract from the grammar being taught (e.g. 'The moon hired an assistant')\n"
      + "  - Uses nouns or modifiers that are mismatched in category, scale, or unit (e.g. 'She ran faster than ten hours')\n"
      + "\n"
      + "Do NOT rely on whether a sentence could technically occur in the real world. If it is odd or confusing in a language learning context, respond with "
      + "the following message and nothing else:\n\n"
      + "$BAD_MEANING\n\n"
      + "If the sentence has a clear, realistic meaning that helps reinforce the grammar structure, respond with the following message and nothing else:\n\n"
      + "$OK";

    logPromptData(prompt);
    this.agent.addMessage("System", prompt);
    const chatResponse = await this.agent.getResponse(this.model, 0);
    logPromptData(chatResponse.message);

    const message = chatResponse.message.trim();
    if (message === "$BAD_MEANING") {
      return false;
    } else if (message !== "$OK") {
      throw new Error("Invalid meaning analysis response");
    }

    return true;
  }

  public async formatSentence(): Promise<void> {
    let prompt = "Your task is to format these generated sentences so that they can be parsed by the user's practice app. I will now instruct you on how to "
      + "generate your response. You must follow these instructions exactly or else the response may be parsed incorrectly, leading to errors for the user. "
      + "Do not include any extra symbols, markup, lines, or linebreaks other than what is specified.\n\n";

    let step = 1;
    prompt += `STEP ${step}: Write the generated sentence on the first line of your response. Include no additional markup around the sentence.`;
    if (this.practiceWords.length > 0 || this.fillerWords.length > 0) {
      const listOrLists = this.practiceWords.length > 0 && this.fillerWords.length > 0 ? "lists" : "list";
      prompt += `\n  - When writing out the sentence, place double brackets around each word chosen from the provided ${listOrLists}. Additionally, within the `
        + "brackets, write the original, unmodified word, EXACTLY as it appears in the word list, separated using the | character. For example, if a chosen "
        + "word is 'run' and it was conjugated to 'ran', it should appear in the sentence as [[ran|run]]. An example of a complete formatted sentence is: 'I "
        + "[[ran|run]] five miles yesterday.'.";
      prompt += "\n  - For all other words, including ones utilized by the grammar rule but not in the provided word list, you should not add any additional "
      + "markup.";
    }

    prompt += "\n\n";
    step++;

    prompt += `STEP ${step}: Write the English translation of the sentence on the next line. Include no additional markup around the sentence.`;
    step++;

    logPromptData(prompt);
    this.agent.addMessage("System", prompt);
    const chatResponse = await this.agent.getResponse(this.model, 0);
    logPromptData(chatResponse.message);

    const message = chatResponse.message.trim();
    this.sentence = parseSentence(message, this.practiceWords, this.fillerWords);
  }

  public async validateSentence(): Promise<Sentence | null> {
    assert(this.sentence !== null);
    if (this.practiceWords.length === 0 && this.fillerWords.length === 0) {
      return this.sentence;
    }

    let prompt = "In your previous response, within the generated sentence, you identified the following pairs of modified/original words:\n\n";

    for (const part of this.sentence.languageSentenceParts) {
      if (part.type === "PracticeWord" || part.type === "FillerWord") {
        prompt += `LISTED WORD: ${part.content}, ${part.unmodifiedWord}\n`;
      } else if (part.type === "UnknownWord") {
        prompt += `UNKNOWN WORD: ${part.content}, ${part.unmodifiedWord}\n`;
      }
    }

    prompt += "\n";

    const unknownWordCount = this.sentence.languageSentenceParts.filter((v) => v.type === "UnknownWord").length;
    const listOrLists = this.practiceWords.length > 0 && this.fillerWords.length > 0 ? "lists" : "list";
    if (unknownWordCount > 0) {
      prompt += `As you can see, your response marked ${unknownWordCount} ${unknownWordCount === 1 ? "word" : "words"} which was not present in the provided `
        + `word ${listOrLists}. This mistake must be corrected. Please do the following:\n\n`;
    } else {
      prompt += `Please verify that these modified/unmodified word pairs are correct. For each pair, the modified word should appear in the generated sentence `
        + `and the unmodified word should EXACTLY match one of the listed words. In many cases, the modified and unmodified words will be the same, which is `
        + "to be expected. Otherwise, the modified word should generally be some conjugation of the unmodified word (for example, 'ran' and 'run').\n\n";
      prompt += "If you identify any errors, please do the following:\n\n";
    }

    prompt += "Repeat the previously-provided formatting instructions, this time making sure to accurately flag ALL words within the provided word "
      + `${listOrLists} and no additional words. Your response format should not change: the generated sentence should be on its own line, followed by the `
      + "English translation on the next line.";

    if (unknownWordCount === 0) {
      prompt += "\n\nOtherwise, if you do not identify any errors, respond with the following message and nothing else:\n\n"
        + "$OK";
    }

    logPromptData(prompt);
    this.agent.addMessage("System", prompt);
    const chatResponse = await this.agent.getResponse(this.model, 0);
    logPromptData(chatResponse.message);

    const message = chatResponse.message.trim();
    if (message === "$OK") {
      return this.sentence;
    } else {
      this.sentence = parseSentence(message, this.practiceWords, this.fillerWords);
      return null;
    }
  }
}