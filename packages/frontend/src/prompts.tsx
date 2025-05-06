import { ChatMessage } from "api";
import { StoryDifficulty, StoryMode } from "exercises/storyPracticeTypes";
import { assert } from "utilities/errors";

function getIntro(language: string): string {
  return `I am learning the ${language} language and I am trying to improve my conversation skills.`;
}

function listMessages(messages: ChatMessage[]): string {
  const parts: string[] = [];

  parts.push(`<USER> marks a message I sent, <ASSISTANT> marks a message you sent, and <END> marks the current end of our conversation:`);

  for (const message of messages) {
    assert(message.sender === "User" || message.sender === "Assistant");
    parts.push(`${message.sender === "User" ? "<USER>" : "<ASSISTANT>"}\n${message.content}`);
  }

  parts.push("<END>");

  return parts.join("\n\n");
}

export function getConversationTopicPrompt(language: string, count: number): string {
  return `${getIntro(language)}. Provide me with a non-numbered, non-bulleted list of ${count} conversation ${count === 1 ? "topic" : "topics"} that I could `
  + `use for practice. List each topic on a new line. Each topic should be a short English phrase of around 1-8 words. Be creative with these topics ideas. Do `
  + `not add any text before the list.`;
}

export interface ConversationPromptSettings {
  language: string;
  conversationTopic: string;
  studyTopics: string[];
  studyWords: string[];
  summary: string | null;
}

export function getConversationPrompt(settings: ConversationPromptSettings): string {
  const parts: string[] = [];

  parts.push(
    `${getIntro(settings.language)} Take on the persona of a native speaker of the ${settings.language} language and hold a conversation with me. The initial `
    + `topic of this conversation will be: ${settings.conversationTopic}. However, as we continue speaking, it is okay to deviate from this initial topic.`);

  if (settings.studyTopics.length > 0) {
    parts.push(
      `I am currently focusing on learning these specific ${settings.language} language topics: ${settings.studyTopics.join(", ")}. Incorporate these into our `
      + `conversation when opportunities arise.`);
  }

  if (settings.studyWords.length > 0) {
    parts.push(
      `I am currently focusing on learning these specific ${settings.language} language words: ${settings.studyWords.join(", ")}. Incorporate these into our `
      + `conversation when opportunities arise. It is fine to use different variations of these words (for example, different conjugations of a verb or the `
      + `adjective form of a noun).`);
  }

  parts.push("Keep your messages relatively brief. A few sentences is enough.");

  if (settings.summary !== null) {
    parts.push("The following is a summary of the previous messages in our conversation which have been removed for brevity:", settings.summary);
  }

  return parts.join("\n\n");
}

export interface CorrectMistakesPromptSettings {
  language: string;
  previousMessages: ChatMessage[];
}

export function getCorrectMistakesPrompt(settings: CorrectMistakesPromptSettings): string {
  const parts: string[] = [];

  if (settings.previousMessages.length > 0) {
    parts.push(
      `${getIntro(settings.language)} I am currently holding a conversation with you as practice. Following are the last few messages from our conversation. `
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-template-expression
      + `${listMessages(settings.previousMessages)}`);

    parts.push(
      `In the next message, correct any grammar, spelling, or conceptual errors. You do not need to correct mistakes in any of the previous messages, they are `
      + `only included for context.`);
  } else {
    parts.push(
      `${getIntro(settings.language)} I am currently holding a conversation with you as practice. In the next message, correct any grammar, spelling, or `
      + `conceptual errors`);
  }

  parts.push(
    `For each mistake you find, write $MISTAKE$ on a new line, followed by a brief 3-8 word description of the mistake that I made in English. This `
    + `description should be general and should be understandable even if the message is not available. Then, on the next line, write $SEVERITY$ followed by a `
    + `number which rates how bad the mistake is on a scale from 1 to 5 where 1 is an innocuous and not very noticeable mistake and 5 is a severe and very `
    + `noticeable mistake. On the next line, write $EXPL_ENGLISH$ and explain, in English, what I did wrong. This explanation can be more specific to the `
    + `details of the error in the message. Finally, on the next line, write $EXPL_LANGUAGE$ and explain again what I did wrong, only this time, the `
    + `explanation should be in ${settings.language}.`);

  parts.push("If you find no mistakes, reply with the message $NO_MISTAKES$.");

  return parts.join("\n\n");
}

export interface SummaryPromptSettings {
  language: string;
  previousSummary: string | null;
  recentMessages: ChatMessage[];
}

export function getSummaryPrompt(settings: SummaryPromptSettings): string {
  const parts: string[] = [];

  parts.push(`${getIntro(settings.language)} We are currently having a conversation which has grown fairly long.`);

  if (settings.previousSummary !== null) {
    parts.push("You previously summarized our conversation as follows (delimited with XML tags):");
    parts.push(`<summary>\n${settings.previousSummary}\n</summary>`);
  }

  parts.push(
    `${settings.previousSummary === null ? "We have" : "Since then, we have"} exchanged the following messages. ${listMessages(settings.recentMessages)}`);

  parts.push(
    `Using${settings.previousSummary !== null ? " the previous summary and" : ""} these messages, write a brief summary of our conversation up to this point `
    + `in time. The summary should be in the ${settings.language} language. Shorter is better; keep the summary under 250 words. Write the summary in plain `
    + `text; do not surround it with any delimiters.`);

  return parts.join("\n\n");
}

export function getUseWordInSentenceProp(language: string, word: string): string {
  return `Use the following ${language} word in a short, simple sentence (do not provide the English translation or pronunciation): ${word}`;
}

export interface StoryPracticePrompts {
  generateStoryPrompt: string;
  modifyStoryPrompt: string | null;
  ssmlPrompt: string;
  splitPrompt: string;
  reviewPrompt: string;
  additionalComponentsPrompt: string;
}

export function getStoryPracticePrompts(
  language: string,
  words: string[],
  focusWords: string[],
  mode: StoryMode,
  difficulty: StoryDifficulty,
): StoryPracticePrompts {
  const storyType = mode === "Story" ? "story" : "dialog";
  const additionalComponents = mode === "Story" ? "title" : "title and character introductions";

  const generateStoryPromptParts: string[] = [];

  const generateStoryPromptIntroParts: string[] = [];
  generateStoryPromptIntroParts.push(`I am learning ${language} and I am trying to improve my listening skills.`);
  generateStoryPromptIntroParts.push(`Please generate a short ${storyType} in ${language} which would take about 2-3 minutes to read.`);
  if (mode === "Dialog") {
    generateStoryPromptIntroParts.push(
      `The dialog should be between two people. Each person can be either male or female. Before the dialog, list the gender of each person as it is required `
      + `to select an appropriate text-to-speech voice. Additionally, provide a very brief introduction spoken by each character which includes the `
      + `character's name and any relevant context to the story (for example: I am John, a firefighter). This introduction should be in ${language}.`);
    generateStoryPromptIntroParts.push(
      `This dialog will be read back by a text-to-speech system so do not include any additional text describing how the characters speak (e.g. "*in a quiet `
      + `voice*") or any actions they are taking (e.g. *jogs while speaking*) as these will sound very out of place when they are read back. Only include the `
      + `actual dialog spoken by the characters.`);
  }
  generateStoryPromptIntroParts.push(
    `I use this method to practice quite often so, to avoid monotony, the story can be in any genre or about any topic. A few examples are adventure, science `
    + `fiction, history, everyday life, folklore, but you do not need to limit yourself to these genres.`);
  generateStoryPromptIntroParts.push(`Please also generate a title to go along with the ${storyType}.`);

  generateStoryPromptParts.push(generateStoryPromptIntroParts.join(" "));

  if (words.length > 0) {
    generateStoryPromptParts.push(`I have currently learned the following words, so please try to restrict the ${storyType}'s content to this list:`);
    generateStoryPromptParts.push(words.join("\n"));
  }

  if (focusWords.length > 0) {
    generateStoryPromptParts.push(
      `The following is a list of words that I am currently focused on learning so please try to include some or all of them in the ${storyType}:`);
    generateStoryPromptParts.push(focusWords.join("\n"));
  }

  const generateStoryPrompt = generateStoryPromptParts.join("\n\n");

  let modifyStoryPrompt: string | null = null;
  if (words.length > 0) {
    const easyCommand = difficulty === "Easy"
      ? "You may also revise sentence structure and grammar as well. Please stick to simple, short sentences which avoid any advanced or complex grammar. "
      : "";
    modifyStoryPrompt = `I have not yet read the ${storyType} but it may be too challenging for my current level. Before I attempt, please review the list of `
      + `words and rewrite/revise the ${storyType} to use as few words that are not on the list as possible (extremely common words and grammatical words are `
      + `still acceptable). It is fine if you simplify or change details of the ${storyType} to make this possible. If some new words which are not listed in `
      + `the provided word list are critical to the ${storyType}, please introduce them along with their English translations in a list before the revised `
      + `${storyType}. ${easyCommand}In addition to revising the ${storyType} content, you may revise the ${additionalComponents} as well if needed.`;
  }

  const ssmlPromptParts: string[] = [];
  ssmlPromptParts.push(
    `This ${storyType} will be read back using text-to-speech, so please repeat back the ${storyType} content (but not the ${additionalComponents}) but with `
    + `the addition of SSML tags. Do not include any additional leading or trailing text in your response. Use the following rules:`);
  ssmlPromptParts.push("- Do not include a <speak> tag around the content (this will be manually added later)");
  ssmlPromptParts.push("- Each sentence should be placed on a new line");
  ssmlPromptParts.push("- Each sentence should be wrapped in a <s> tag");
  ssmlPromptParts.push(
    "- If relevant to the context or tone, a complete sentence can be wrapped in an <emphasis> tag using any of the following emphasis levels: strong, "
    + "moderate, none, reduced");
  if (mode === "Dialog") {
    ssmlPromptParts.push(
      "- Each character's dialog should NOT be prefixed with the character's name but should instead be wrapped in a <voice> tag with the 'name' attribute "
      + "specified. The name should be either $CHARACTER1 or $CHARACTER2 (these strings will later be replaced with the selected voice names for each "
      + "character so do not include any additional tags such as language or gender).");
    ssmlPromptParts.push(
      "- Each <voice> tag should surround exactly one sentence and should be on the same line as that sentence. A <voice> tag should NOT appear on its own "
      + "line and should NOT wrap multiple sentences.");
  }
  ssmlPromptParts.push("- Make sure to escape any of the following characters using XML escape codes: \" & ' < >");

  const ssmlPrompt = ssmlPromptParts.join("\n");

  const splitPromptParts: string[] = [];
  splitPromptParts.push(
    `Next, take the output of your previous response (the ${storyType} content with the addition of SSML tags) and perform the following modifications (do not `
    + `alter the text in any other way):`);
  splitPromptParts.push(
    `- Consider each sentence broken down into logical grammatical chunks. Each chunk should include at least one word (for example, a chunk should not `
    + `consist of only a grammatical symbol such as a comma or period). Before each chunk, insert [[[$EXPLANATION]]], where $EXPLANATION is replaced with a `
    + `brief English explanation of the chunk, describing what it means or what its role is in the sentence (do not add any extra spaces before [[[ or after `
    + `]]]). The explanation should serve as a very rough translation of that chunk of the sentence but does not need to be nicely-worded English; it should `
    + `more closely match how the concept is expressed in ${language} rather than in English. These should be fairly granular - a single chunk should ideally `
    + `be relatively short and cover only a few words.`);

  const splitPrompt = splitPromptParts.join("\n");

  const reviewPrompt =
    "The previous instructions I sent are very important and the program will break if any of them are not followed. Before moving forward, please review the "
    + "output you provided and make sure each requirement is met without any errors. After doing this, repeat the output with any errors fixed. (Do not "
    + "comment on whether you found any errors. For example, don't say 'I found and fixed 5 errors'. Simply send the results without any further comments.)";

  const additionalComponentsPromptParts: string[] = [];
  additionalComponentsPromptParts.push("Finally, in your next response, provide the following items in the exact format described as follows:");
  additionalComponentsPromptParts.push(`- A line containing the text $TITLE followed by the title in ${language}`);
  additionalComponentsPromptParts.push(`- A line containing the text $TITLE_TRANSLATION followed by an English translation of the title`);
  if (mode === "Dialog") {
    additionalComponentsPromptParts.push("- A line containing the text $CHARACTER1_GENDER followed by the gender of character 1, either MALE or FEMALE");
    additionalComponentsPromptParts.push("- A line containing the text $CHARACTER1_INTRODUCTION followed by character 1's introduction sentence");
    additionalComponentsPromptParts.push("- A line containing the text $CHARACTER2_GENDER followed by the gender of character 2, either MALE or FEMALE");
    additionalComponentsPromptParts.push("- A line containing the text $CHARACTER2_INTRODUCTION followed by character 2's introduction sentence");
  }
  if (words.length > 0) {
    additionalComponentsPromptParts.push(
      `- For each new word introduced in your prior response, a line containing the text $NEW_WORD followed by $WORD|||$MEANING where $WORD is `
      + `replaced with the ${language} word and $MEANING is replaced with the word's English translation`);
  }

  const additionalComponentsPrompt = additionalComponentsPromptParts.join("\n");

  return {
    generateStoryPrompt,
    modifyStoryPrompt,
    ssmlPrompt,
    splitPrompt,
    reviewPrompt,
    additionalComponentsPrompt,
  };
}