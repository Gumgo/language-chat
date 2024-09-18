import { ChatMessage } from "api";
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