import { Agent } from "agent";
import { Model } from "api";
import { GrammarRuleEntry } from "dataState";
import { assert, CustomError } from "utilities/errors";
import { shuffle } from "utilities/shuffle";

const sentenceGenerationTemperature = 1;
const logChatForDebugging = true; // !!! I'm leaving this uncommented to shake out bugs in this system

// LockedWord is in this list for convenience - we switch over from PracticeWord to LockedWord after sentence generation
export type SentencePartType = "Text" | "PracticeWord" | "FillerWord" | "LockedWord";

export interface SentencePart {
  type: SentencePartType;
  content: string;
  unmodifiedWord?: string;
}

export interface GenerateGrammarRuleSentenceResultData {
  sentence: string;
  englishSentence: string;
  sentenceParts: SentencePart[];
  sentenceWithIsolatedWords: string;
}

class ParseSentenceError extends CustomError {
  private readonly _errorDescription: string;

  public constructor(errorDescription: string) {
    super(`Parsing sentence failed with the following error: ${errorDescription}`);
    this._errorDescription = errorDescription;
  }

  public get errorDescription(): string {
    return this._errorDescription;
  }
}

function parseSentence(message: string, sentence: string, practiceWords: string[], fillerWords: string[]): SentencePart[] {
  const lines = message.split("\n").map((v) => v.trim()).filter((v) => v.length > 0); // Ignore extra empty linebreaks, sometimes they occur
  if (lines.length !== 1) {
    throw new ParseSentenceError("Incorrect line count, only a single line was expected");
  }

  const messageSentence = lines[0];
  const sentenceParts: SentencePart[] = [];
  let remainingMessageSentence = messageSentence;
  const unknownWords: string[] = [];
  while (remainingMessageSentence.length > 0) {
    const nextWordIndex = remainingMessageSentence.indexOf("[[");
    if (nextWordIndex >= 0) {
      if (nextWordIndex > 0) {
        sentenceParts.push({ type: "Text", content: remainingMessageSentence.substring(0, nextWordIndex) });
        remainingMessageSentence = remainingMessageSentence.substring(nextWordIndex);
      }

      const endIndex = remainingMessageSentence.indexOf("]]");
      if (endIndex < 0) {
        throw new ParseSentenceError("No matching ]] for [[");
      }

      const wordAndUnmodifiedWord = remainingMessageSentence.substring(2, endIndex).split("|");
      if (wordAndUnmodifiedWord.length !== 2) {
        throw new ParseSentenceError("Incorrect separation of modified and unmodified word");
      }

      const [word, unmodifiedWord] = wordAndUnmodifiedWord;
      if (practiceWords.includes(unmodifiedWord)) {
        sentenceParts.push({ type: "PracticeWord", content: word, unmodifiedWord });
      } else if (fillerWords.includes(unmodifiedWord)) {
        sentenceParts.push({ type: "FillerWord", content: word, unmodifiedWord });
      } else {
        unknownWords.push(word);
      }

      remainingMessageSentence = remainingMessageSentence.substring(endIndex + 2);
    } else {
      sentenceParts.push({ type: "Text", content: remainingMessageSentence });
      remainingMessageSentence = "";
    }
  }

  if (unknownWords.length > 0) {
    throw new ParseSentenceError(`The following words were marked with brackets but are not present in the provided word list: ${unknownWords.join(", ")}`);
  }

  const formattedSentence = sentenceParts.map((v) => v.content).join("");
  if (sentence !== formattedSentence) {
    throw new ParseSentenceError(
      "When removing [[, ]], |, and the unmodified words from the formatted sentence, the result not match the original sentence.\n"
      + `Original: ${sentence}\n`
      + `Formatted: ${formattedSentence}\n`);
  }

  return sentenceParts;
}

class GrammarRuleSentenceGenerator {
  private readonly language: string;
  private readonly model: Model;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  private readonly generatorAgent: Agent = new Agent(logChatForDebugging ? "LogChatForDebugging" : undefined);

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  private readonly formatterAgent: Agent = new Agent(logChatForDebugging ? "LogChatForDebugging" : undefined);

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  private readonly wordIsolatorAgent: Agent = new Agent(logChatForDebugging ? "LogChatForDebugging" : undefined);

  private readonly grammarRule: GrammarRuleEntry;
  private readonly practiceWords: string[];
  private readonly fillerWords: string[];

  private sentence: string | null = null;
  private englishSentence: string | null = null;
  private sentenceParts: SentencePart[] | null = null;
  private parseSentenceError: ParseSentenceError | null = null;
  private sentenceWithIsolatedWords: string | null = null;
  private incorrectSentenceWithIsolatedWords: string | null = null;

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

    this.generatorAgent.addMessage("System", prompt);
    const chatResponse = await this.generatorAgent.getResponse(this.model, sentenceGenerationTemperature);

    const message = chatResponse.message.trim();
    if (message === "$BAD_GRAMMAR_RULE") {
      return "BadGrammarRule";
    } else if (message === "$INCOMPATIBLE_WORDS") {
      return "IncompatibleWords";
    }

    return "Success";
  }

  public async finalizeRawSentence(attempt: number): Promise<boolean> {
    let prompt: string;
    if (attempt === 0) {
      prompt = "Now please respond with the following message, formatted exactly as follows: the generated sentence should be on the first line with no "
        + "additional formatting, markup, or linebreaks. The English translation should be on the second line with no additional formatting, markup, or "
        + "linebreaks.";
    } else {
      prompt = "The response that you provided could not be parsed because it was not properly formatted as two lines with the generated sentence on the "
        + "first line and the English translation on the second lines. Please provide another response with the correct formatting using the previously-"
        + "provided instructions.";
    }

    this.generatorAgent.addMessage("System", prompt);
    const chatResponse = await this.generatorAgent.getResponse(this.model, 0);

    const lines = chatResponse.message.split("\n").map((v) => v.trim()).filter((v) => v.length > 0);
    if (lines.length !== 2) {
      return false;
    }

    [this.sentence, this.englishSentence] = lines;
    return true;
  }

  public async reviewCorrectness(): Promise<boolean> {
    assert(this.sentence !== null);

    const prompt = `The user is learning ${this.language}. The following is a ${this.language} sentence generated for practice purposes:\n\n`
      + `${this.sentence}\n\n`
      + `Please determine if the sentence is grammatically correct and if it flows naturally in ${this.language}. If the sentence contains any grammatical `
      + "errors or irregularities, respond with the following message and nothing else:\n\n"
      + "$ERROR\n\n"
      + "Otherwise, respond with the following message and nothing else:\n\n"
      + "$OK";

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const agent = new Agent(logChatForDebugging ? "LogChatForDebugging" : undefined);
    agent.addMessage("System", prompt);
    const chatResponse = await agent.getResponse(this.model, 0);

    const message = chatResponse.message.trim();
    if (message === "$ERROR") {
      return false;
    } else if (message !== "$OK") {
      throw new Error("Invalid correctness analysis response");
    }

    return true;
  }

  public async reviewGrammarRuleUsage(): Promise<boolean> {
    assert(this.sentence !== null);

    const prompt = `The user is learning ${this.language} and wants to practice grammar. They have learned the following grammar rule: `
      + `${this.grammarRule.name}. Here is a short description of this rule:\n\n`
      + `${this.grammarRule.description}\n\n`
      + `The following is a ${this.language} sentence generated for practice purposes:\n\n`
      + `${this.sentence}\n\n`
      + "Please review this sentence. It should demonstrate a clear use case of the grammar rule. For example:\n"
      + "  - If the grammar rule describes how to conjugate a verb in the past tense, the generated sentence must contain a verb in the past tense.\n"
      + "  - If the grammar rule dictates how to use a certain pronoun, the sentence should contain the correct usage of that pronoun.\n"
      + "  - If the grammar is focusing on the usage of a set expression, the sentence should use that expression.\n"
      + "\n"
      + "If the sentence does NOT make clear use of the grammar rule in a manner that is appropriate for a language learner, respond with the following "
      + "message and nothing else:\n\n"
      + "$ERROR\n\n"
      + "Otherwise, if the sentence does make clear use of the grammar rule and helps reinforce the grammar structure, respond with the following message and "
      + "nothing else:\n\n"
      + "$OK";

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const agent = new Agent(logChatForDebugging ? "LogChatForDebugging" : undefined);
    agent.addMessage("System", prompt);
    const chatResponse = await agent.getResponse(this.model, 0);

    const message = chatResponse.message.trim();
    if (message === "$ERROR") {
      return false;
    } else if (message !== "$OK") {
      throw new Error("Invalid grammar rule usage analysis response");
    }

    return true;
  }

  public async reviewMeaning(): Promise<boolean> {
    assert(this.sentence !== null);

    const prompt = `The user is learning ${this.language}. The following is a ${this.language} sentence generated for practice purposes:\n\n`
      + `${this.sentence}\n\n`
      + "Please review the sentence. You are evaluating whether it is appropriate for a language learner. The sentence may be grammatically correct, but your "
      + "task is to decide whether its meaning is strange, confusing, or unhelpful for someone trying to learn the grammar. A sentence should be marked $ERROR "
      + "if it:\n"
      + "  - Is conceptually absurd or physically implausible (e.g. 'The pencil ran faster than the car')\n"
      + "  - Combines incompatible ideas (e.g. 'He drank three ideas')\n"
      + "  - Makes arbitrary or confusing comparisons or statements without context (e.g. 'One person is heavier than three people')\n"
      + "  - Describes situations that are so unlikely or specific that they distract from the grammar being taught (e.g. 'The moon hired an assistant')\n"
      + "  - Uses nouns or modifiers that are mismatched in category, scale, or unit (e.g. 'She ran faster than ten hours')\n"
      + "\n"
      + "Do NOT rely on whether a sentence could technically occur in the real world. If it is odd or confusing in a language learning context, respond with "
      + "the following message and nothing else:\n\n"
      + "$ERROR\n\n"
      + "If the sentence has a clear, realistic meaning that helps reinforce the grammar structure, respond with the following message and nothing else:\n\n"
      + "$OK";

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const agent = new Agent(logChatForDebugging ? "LogChatForDebugging" : undefined);
    agent.addMessage("System", prompt);
    const chatResponse = await agent.getResponse(this.model, 0);

    const message = chatResponse.message.trim();
    if (message === "$ERROR") {
      return false;
    } else if (message !== "$OK") {
      throw new Error("Invalid meaning analysis response");
    }

    return true;
  }

  public async formatSentence(attempt: number): Promise<boolean> {
    assert(this.sentence !== null);

    if (this.practiceWords.length === 0 && this.fillerWords.length === 0) {
      this.sentenceParts = [{ type: "Text", content: this.sentence }];
      return true;
    }

    let prompt: string;
    if (attempt === 0) {
      const words = [...this.practiceWords, ...this.fillerWords].join("\n");
      prompt = `The user is learning ${this.language}. The following is a ${this.language} sentence:\n\n`
        + `${this.sentence}\n\n`
        + "Here is a list of words that the user is studying:\n\n"
        + `${words}\n\n`
        + "Your task is to format the sentence so that it can be parsed by the user's practice app. I will now instruct you on how to generate your response. "
        + "You must follow these instructions exactly or else the response may be parsed incorrectly, leading to errors for the user. Do not include any extra "
        + "symbols, markup, lines, or linebreaks other than what is specified.\n\n"
        + "Write the sentence on the first line of your response. Include no additional markup around the sentence. When writing out the sentence, place "
        + "double brackets around each word which appears in the provided word list. Note that words in the sentence may not appear exactly as they do in the "
        + "list. For example, if the word 'run' appears in the word list and the conjugated form 'ran' appears in the sentence, this should still count as a "
        + "match. Then, within the brackets, write the original, unmodified word, EXACTLY as it appears in the word list, separated using the | character. For "
        + "example, if a listed word is 'run' and it was conjugated to 'ran' in the sentence, it should appear in your response as [[ran|run]]. An example of "
        + "a complete formatted sentence is: 'I [[ran|run]] five miles yesterday.'.";
    } else {
      assert(this.parseSentenceError !== null);
      prompt = "The parser was run on the response that you provided and it generated the following error:\n\n"
        + `${this.parseSentenceError.errorDescription}\n\n`
        + "Please repeat the previously-provided formatting instructions, making sure to format everything exactly as described and to correctly identify "
        + "words that appear in the provided word list using the [[ ]] syntax without identifying any additional unlisted words.";
    }

    this.formatterAgent.addMessage("System", prompt);
    const chatResponse = await this.formatterAgent.getResponse(this.model, 0);

    const message = chatResponse.message.trim();

    try {
      this.sentenceParts = parseSentence(message, this.sentence, this.practiceWords, this.fillerWords);
      return true;
    } catch (error) {
      if (error instanceof ParseSentenceError) {
        this.parseSentenceError = error;
        return false;
      } else {
        throw error;
      }
    }
  }

  public async validateFormattedSentence(): Promise<"Valid" | "Invalid" | "InvalidWithFormattingErrors"> {
    assert(this.sentence !== null);
    assert(this.sentenceParts !== null);

    if (this.practiceWords.length === 0 && this.fillerWords.length === 0) {
      return "Valid";
    }

    const identifiedWords = this.sentenceParts
      .filter((v) => v.type !== "Text")
      .map((v) => `${v.content} / ${v.unmodifiedWord}`)
      .join("\n");

    const prompt = "You identified the following listed words within the sentence:\n\n"
      + `${identifiedWords}\n\n`
      + `Please verify that these modified/unmodified word pairs are correct. For each pair, the modified word should appear in the generated sentence and the `
      + `unmodified word should EXACTLY match one of the listed words. In many cases, the modified and unmodified words will be the same, which is to be `
      + "expected. Otherwise, the modified word should generally be some conjugation of the unmodified word (for example, 'ran' and 'run').\n\n"
      + "If you identify any errors, repeat the previously-provided formatting instructions, making sure to format everything exactly as described and to "
      + "correctly identify words that appear in the provided word list using the [[ ]] syntax without identifying any additional unlisted words.\n\n"
      + "Otherwise, if you do not identify any errors, respond with the following message and nothing else:\n\n"
      + "$OK";

    this.formatterAgent.addMessage("System", prompt);
    const chatResponse = await this.formatterAgent.getResponse(this.model, 0);

    const message = chatResponse.message.trim();
    if (message === "$OK") {
      return "Valid";
    }

    try {
      this.sentenceParts = parseSentence(message, this.sentence, this.practiceWords, this.fillerWords);
      return "Invalid";
    } catch (error) {
      if (error instanceof ParseSentenceError) {
        this.parseSentenceError = error;
        return "InvalidWithFormattingErrors";
      } else {
        throw error;
      }
    }
  }

  public async isolateWords(attempt: number): Promise<boolean> {
    assert(this.sentence !== null);

    let prompt: string;
    if (attempt === 0) {
      prompt = `The following is a ${this.language} sentence:\n\n`
        + `${this.sentence}\n\n`
        + "Please take this sentence and add the character | between each word. Your response should consist of a single line and no additional formatting or "
        + "markup should be added. All grammar (such as commas, quotes, etc.) should be kept intact";
    } else {
      assert(this.incorrectSentenceWithIsolatedWords !== null);
      prompt = "After removing | characters from the message in the response you provided, the resulting sentence did not exactly match the original "
        + "sentence:\n\n"
        + `Original sentence: ${this.sentence}\n`
        + `Response sentence with | removed: ${this.incorrectSentenceWithIsolatedWords}\n\n`
        + "Please repeat the instructions, making sure that you ONLY add the | character between words and perform no other modifications.";
    }

    this.wordIsolatorAgent.addMessage("System", prompt);
    const chatResponse = await this.wordIsolatorAgent.getResponse(this.model, 0);

    const message = chatResponse.message.trim();
    const messageWithWordSeparatorRemoved = message.replaceAll("|", "");
    if (messageWithWordSeparatorRemoved !== this.sentence) {
      this.incorrectSentenceWithIsolatedWords = messageWithWordSeparatorRemoved;
      return false;
    }

    this.sentenceWithIsolatedWords = message;
    return true;
  }

  public getResult(): GenerateGrammarRuleSentenceResultData {
    assert(this.sentence !== null);
    assert(this.englishSentence !== null);
    assert(this.sentenceParts !== null);
    assert(this.sentenceWithIsolatedWords !== null);

    return {
      sentence: this.sentence,
      englishSentence: this.englishSentence,
      sentenceParts: this.sentenceParts,
      sentenceWithIsolatedWords: this.sentenceWithIsolatedWords,
    };
  }
}

export type GenerateGrammarRuleSentenceResult =
  | "Success"
  | "Cancelled"
  | "NoMoreItems"
  | "BadGrammar"
  | "BadGrammarRule"
  | "IncompatibleWords"
  | "BadGrammarRuleUsage"
  | "BadMeaning"
  | "FinalizeRawSentenceFailed"
  | "FormatSentenceFailed"
  | "IsolateWordsFailed"
  | "UnexpectedError";

export async function generateGrammarRuleSentence(
  language: string,
  model: Model,
  grammarRule: GrammarRuleEntry,
  practiceWords: string[],
  fillerWords: string[],
  cancelTest: () => boolean,
): Promise<[GenerateGrammarRuleSentenceResult, GenerateGrammarRuleSentenceResultData | null]> {
  try {
    const sentenceGenerator = new GrammarRuleSentenceGenerator(language, model, grammarRule, practiceWords, fillerWords);

    const generateSentenceResult = await sentenceGenerator.generateSentence();
    if (generateSentenceResult !== "Success") {
      return [generateSentenceResult, null];
    }

    if (cancelTest()) {
      return ["Cancelled", null];
    }

    {
      let success = false;
      for (let attempt = 0; !success && attempt < 5; attempt++) {
        success = await sentenceGenerator.finalizeRawSentence(attempt);
        if (cancelTest()) {
          return ["Cancelled", null];
        }
      }

      if (!success) {
        return ["FinalizeRawSentenceFailed", null];
      }
    }

    if (cancelTest()) {
      return ["Cancelled", null];
    }

    if (!await sentenceGenerator.reviewCorrectness()) {
      return ["BadGrammar", null];
    }

    if (cancelTest()) {
      return ["Cancelled", null];
    }

    if (!await sentenceGenerator.reviewGrammarRuleUsage()) {
      return ["BadGrammarRuleUsage", null];
    }

    if (cancelTest()) {
      return ["Cancelled", null];
    }

    if (!await sentenceGenerator.reviewMeaning()) {
      return ["BadMeaning", null];
    }

    if (cancelTest()) {
      return ["Cancelled", null];
    }

    {
      let success = false;
      for (let formatAttempt = 0; !success && formatAttempt < 5; formatAttempt++) {
        const formatSuccess = await sentenceGenerator.formatSentence(formatAttempt);
        if (cancelTest()) {
          return ["Cancelled", null];
        }

        if (!formatSuccess) {
          continue;
        }

        for (let validateAttempt = 0; !success && validateAttempt < 5; validateAttempt++) {
          const validateResult = await sentenceGenerator.validateFormattedSentence();
          if (cancelTest()) {
            return ["Cancelled", null];
          }

          if (validateResult === "Valid") {
            // Validation succeeded
            success = true;
          } else if (validateResult === "Invalid") {
            // Validation failed so we attempted to reformat and that succeeded, so repeat the validation loop
          } else {
            // Validation failed so we attempted to reformat and that also failed, so repeat the formating loop
            break;
          }
        }
      }

      if (!success) {
        return ["FormatSentenceFailed", null];
      }
    }

    {
      let success = false;
      for (let attempt = 0; !success && attempt < 5; attempt++) {
        success = await sentenceGenerator.isolateWords(attempt);
        if (cancelTest()) {
          return ["Cancelled", null];
        }
      }

      if (!success) {
        return ["IsolateWordsFailed", null];
      }
    }


    return ["Success", sentenceGenerator.getResult()];
  } catch (error) {
    return ["UnexpectedError", null];
  }
}