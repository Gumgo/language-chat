import { User } from "firebase/auth";
import { Database, DataSnapshot, onValue, push, ref, runTransaction, serverTimestamp, update, get, set } from "firebase/database";
import { assert, doThrow } from "utilities/errors";

function waniKaniApiKeyPath(user: User): string {
  return `/users/${user.uid}/waniKaniApiKey`;
}

function languagePath(user: User, language: string): string {
  return `/users/${user.uid}/languages/${language}`;
}

function conversationsPath(user: User, language: string): string {
  return `${languagePath(user, language)}/conversations`;
}

function conversationsConversationPath(user: User, language: string, conversationId: string): string {
  return `${conversationsPath(user, language)}/${conversationId}`;
}

function conversationMessagesPath(user: User, language: string): string {
  return `${languagePath(user, language)}/conversationMessages`;
}

function conversationMessagesConversationPath(user: User, language: string, conversationId: string): string {
  return `${conversationMessagesPath(user, language)}/${conversationId}`;
}

function conversationMessagesConversationMessagesPath(user: User, language: string, conversationId: string): string {
  return `${conversationMessagesConversationPath(user, language, conversationId)}/messages`;
}

function conversationMessagesConversationMessagesMessagePath(user: User, language: string, conversationId: string, messageId: string): string {
  return `${conversationMessagesConversationMessagesPath(user, language, conversationId)}/${messageId}`;
}

function vocabularyPath(user: User, language: string): string {
  return `${languagePath(user, language)}/vocabulary`;
}

function vocabularyEntryPath(user: User, language: string, vocabularyEntryId: string): string {
  return `${vocabularyPath(user, language)}/${vocabularyEntryId}`;
}

function vocabularyEntryListeningSrsReviewsPath(user: User, language: string, vocabularyEntryId: string): string {
  return `${vocabularyEntryPath(user, language, vocabularyEntryId)}/listeningSrsReviews`;
}

function encodeVocabularyEntryId(word: string): string {
  // We encode words using their UTF-8 bytes written out as hex
  const bytes = new TextEncoder().encode(word);
  return [...bytes].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function decodeVocabularyEntryId(vocabularyEntryId: string): string {
  if (vocabularyEntryId.length % 2 !== 0) {
    throw new Error("Invalid vocabulary entry ID");
  }

  const byteCount = vocabularyEntryId.length >> 1;
  const bytes = new Uint8Array([...new Array(byteCount).keys()].map((i) => parseInt(vocabularyEntryId.substring(i * 2, i * 2 + 2), 16)));
  return new TextDecoder().decode(bytes);
}

function grammarRulesPath(user: User, language: string): string {
  return `${languagePath(user, language)}/grammarRules`;
}

function grammarRuleEntryPath(user: User, language: string, grammarRuleId: string): string {
  return `${grammarRulesPath(user, language)}/${grammarRuleId}`;
}

function grammarRuleEntryListeningSrsReviewsPath(user: User, language: string, grammarRuleId: string): string {
  return `${grammarRuleEntryPath(user, language, grammarRuleId)}/listeningSrsReviews`;
}

export interface Conversation {
  id: string;
  date: Date;
  conversationTopic: string;
  studyTopics: string[];
  studyWords: string[];
}

export interface VocabularyEntry {
  creationDate: Date;
  word: string;
  translation: string;
  notes: string;
  tags: string[];
  listeningSrsReviews: Map<Date, boolean>;
}

export interface GrammarRuleEntry {
  id: string;
  creationDate: Date;
  name: string;
  description: string;
  listeningSrsReviews: Map<Date, boolean>;
}

export type MessageSender = "System" | "Assistant" | "User";

export interface Mistake {
  description: string;
  severity: number;
  englishExplanation: string;
  languageExplanation: string;
}

export interface Message {
  id: string;
  date: Date;
  sender: MessageSender;
  content: string;
  tokenCount: number | null;

  mistakesProcessed: boolean;
  mistakes: Mistake[];

  summary: string | null;
}

interface DatabaseSubscription {
  disconnect: () => void;
}

// This is currently unused but could be useful in the future
// eslint-disable-next-line @typescript-eslint/no-unused-vars
abstract class TypedDatabaseSubscription<TData> {
  private readonly onDisconnect: (databaseSubscription: DatabaseSubscription) => void;
  private readonly listeners: { listener: (update: TData | undefined) => void }[] = [];
  private unsubscribe: (() => void) | null = null;
  private _data: TData | undefined = undefined;
  private error = false;

  protected constructor(database: Database, path: string, onDisconnect: (databaseSubscription: DatabaseSubscription) => void) {
    this.onDisconnect = onDisconnect;

    this.unsubscribe = onValue(
      ref(database, path),
      (snapshot) => {
        this._data = this.readData(snapshot);
        for (const listener of this.listeners) {
          listener.listener(this._data);
        }

        if (this._data === undefined) {
          this.error = true;
          this.unsubscribe?.();
          this.unsubscribe = null;
        }
      },
      () => {
        this._data = undefined;
        for (const listener of this.listeners) {
          listener.listener(this._data);
        }

        this.error = true;
        this.unsubscribe?.();
        this.unsubscribe = null;
      });

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this.error) {
      // We immediately encountered an error
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  public get data(): TData | undefined {
    return this._data;
  }

  public addListener(listener: (update: TData | undefined) => void): () => void {
    const wrapper = { listener };
    this.listeners.push(wrapper);

    if ((this.unsubscribe !== null && this._data !== undefined) || this.error) {
      listener(this._data);
    }

    return () => {
      const index = this.listeners.indexOf(wrapper);
      assert(index >= 0, "Listener has already been removed");
      this.listeners.splice(index, 1);
    };
  }

  public disconnect(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.error = false;
    this.onDisconnect(this);
  }

  // In the event of an error (e.g. the path does not exist), return undefined
  protected abstract readData(snapshot: DataSnapshot): TData | undefined;
}

function parseConversation(snapshot: DataSnapshot): Conversation {
  const conversation: Conversation = {
    id: snapshot.key ?? doThrow(new Error("Conversation has no key")),
    date: new Date(snapshot.child("date").val() as number),
    conversationTopic: snapshot.child("conversationTopic").val() as string,
    studyTopics: [],
    studyWords: [],
  };

  snapshot.child("studyTopics").forEach((studyTopicSnapshot) => void conversation.studyTopics.push(studyTopicSnapshot.val() as string));
  snapshot.child("studyWords").forEach((studyWordSnapshot) => void conversation.studyWords.push(studyWordSnapshot.val() as string));

  return conversation;
}

function parseConversationMessages(snapshot: DataSnapshot): Message[] {
  const messages: Message[] = [];
  snapshot
    .child("messages")
    .forEach(
      (messageSnapshot) => {
        const mistakesProcessed = messageSnapshot.hasChild("mistakes");
        const message: Message = {
          id: messageSnapshot.key,
          date: new Date(messageSnapshot.child("date").val() as number),
          sender: messageSnapshot.child("sender").val() as MessageSender,
          content: messageSnapshot.child("content").val() as string,
          tokenCount: messageSnapshot.child("tokenCount").val() as number | null,
          mistakesProcessed,
          mistakes: [],
          summary: messageSnapshot.child("summary").val() as string | null,
        };

        if (mistakesProcessed && typeof messageSnapshot.child("mistakes").val() !== "string") {
          messageSnapshot
            .child("mistakes")
            .forEach((mistakeSnapshot) => void message.mistakes.push(
              {
                description: mistakeSnapshot.child("description").val() as string,
                severity: mistakeSnapshot.child("severity").val() as number,
                englishExplanation: mistakeSnapshot.child("englishExplanation").val() as string,
                languageExplanation: mistakeSnapshot.child("languageExplanation").val() as string,
              }));
        }

        messages.push(message);
      });

  return messages;
}

function parseVocabularyEntry(snapshot: DataSnapshot): VocabularyEntry {
  const vocabularyEntry: VocabularyEntry = {
    creationDate: new Date(snapshot.child("creationDate").val() as number),
    word: decodeVocabularyEntryId(snapshot.key ?? doThrow(new Error("Vocabulary entry has no key"))),
    translation: snapshot.child("translation").val() as string,
    notes: snapshot.child("notes").val() as string,
    tags: (snapshot.child("tags").val() as string).split(" "),
    listeningSrsReviews: new Map(),
  };

  snapshot.child("listeningSrsReviews").forEach(
    (reviewSnapshot) => void vocabularyEntry.listeningSrsReviews.set(new Date(reviewSnapshot.key), reviewSnapshot.val() as boolean));

  return vocabularyEntry;
}

function parseGrammarRuleEntry(snapshot: DataSnapshot): GrammarRuleEntry {
  const grammarRuleEntry: GrammarRuleEntry = {
    id: snapshot.key ?? doThrow(new Error("Grammar rule entry has no key")),
    creationDate: new Date(snapshot.child("creationDate").val() as number),
    name: snapshot.child("name").val() as string,
    description: snapshot.child("description").val() as string,
    listeningSrsReviews: new Map(),
  };

  snapshot.child("listeningSrsReviews").forEach(
    (reviewSnapshot) => void grammarRuleEntry.listeningSrsReviews.set(new Date(reviewSnapshot.key), reviewSnapshot.val() as boolean));

  return grammarRuleEntry;
}

export class DataState {
  private readonly database: Database;
  private readonly user: User;
  private readonly subscriptions: DatabaseSubscription[] = [];

  public constructor(database: Database, user: User) {
    this.database = database;
    this.user = user;
  }

  public async getWaniKaniApiKey(): Promise<string | null> {
    const snapshot = await get(ref(this.database, waniKaniApiKeyPath(this.user)));
    return snapshot.exists() ? snapshot.val() as string : null;
  }

  public async setWaniKaniApiKey(waniKaniApiKey: string | null): Promise<void> {
    await set(ref(this.database, waniKaniApiKeyPath(this.user)), waniKaniApiKey);
  }

  public async getConversations(language: string): Promise<Conversation[]> {
    const snapshot = await get(ref(this.database, conversationsPath(this.user, language)));
    const conversations: Conversation[] = [];
    snapshot.forEach((conversationSnapshot) => void conversations.push(parseConversation(conversationSnapshot)));
    return conversations;
  }

  public async getConversation(language: string, conversationId: string): Promise<Conversation | null> {
    const snapshot = await get(ref(this.database, conversationsConversationPath(this.user, language, conversationId)));
    return snapshot.exists() ? parseConversation(snapshot) : null;
  }

  public async getConversationMessages(language: string, conversationId: string): Promise<Message[] | null> {
    const snapshot = await get(ref(this.database, conversationMessagesConversationPath(this.user, language, conversationId)));
    return snapshot.exists() ? parseConversationMessages(snapshot) : null;
  }

  public async createConversation(
    language: string,
    conversationTopic: string,
    studyTopics: string[],
    studyWords: string[]): Promise<string> {
    const conversationId = push(ref(this.database, `${languagePath(this.user, language)}/conversations`)).key;
    if (conversationId === null) {
      throw new Error("Failed to create conversation ID");
    }

    const updates: Record<string, unknown> = {};
    updates[`conversations/${conversationId}`] = {
      date: serverTimestamp(),
      conversationTopic,
      studyTopics,
      studyWords,
    };
    updates[`conversationMessages/${conversationId}`] = { lastMessageId: "" };

    await update(ref(this.database, languagePath(this.user, language)), updates);
    return conversationId;
  }

  public async deleteConversations(language: string, conversationIds: string[]): Promise<void> {
    const updates: Record<string, unknown> = {};
    for (const conversationId of conversationIds) {
      updates[`conversations/${conversationId}`] = null;
      updates[`conversationMessages/${conversationId}`] = null;
    }

    await update(ref(this.database, languagePath(this.user, language)), updates);
  }

  public async addConversationMessage(
    language: string,
    conversationId: string,
    lastMessageId: string,
    sender: MessageSender,
    content: string,
    tokenCount: number | null): Promise<string | null> {
    const messageId = push(ref(this.database, conversationMessagesConversationMessagesPath(this.user, language, conversationId))).key
      ?? doThrow(new Error("Failed to create message ID"));

    const message = {
      date: serverTimestamp(),
      sender,
      content,
      tokenCount,
    };

    let didAdd = false;
    const transactionResult = await runTransaction(
      ref(this.database, conversationMessagesConversationPath(this.user, language, conversationId)),
      (currentData) => {
        didAdd = false;

        // If the data is not cached, firebase will initially call this with null data. Then, after we submit a result, firebase will look up the actual data on
        // the server and if there is a mismatch (which there will be since this data should never be null), will re-call this function with the actual data. So
        // in the null case, we'll just return the same data and expect this function to be re-called. Note: if the conversation got deleted, this will be null,
        // so this logic also handles that case.
        if (currentData === null) {
          return currentData;
        }

        const currentDataJson = currentData as Record<string, unknown>;
        if (currentDataJson.lastMessageId !== lastMessageId) {
          // Another client modified this conversation
          return undefined;
        }

        currentDataJson.lastMessageId = messageId;
        if (currentDataJson.messages === undefined) {
          currentDataJson.messages = {};
        }

        (currentDataJson.messages as Record<string, unknown>)[messageId] = message;
        didAdd = true;
        return currentData;
      });

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return transactionResult.committed && didAdd ? messageId : null;
  }

  public async setConversationMessageTokenCount(
    language: string,
    conversationId: string,
    messageId: string,
    tokenCount: number): Promise<boolean> {
    let didSet = false;
    const transactionResult = await runTransaction(
      ref(this.database, conversationMessagesConversationMessagesMessagePath(this.user, language, conversationId, messageId)),
      (currentData) => {
        didSet = false;

        // If the data is not cached, firebase will initially call this with null data. Then, after we submit a result, firebase will look up the actual data on
        // the server and if there is a mismatch (which there will be since this data should never be null), will re-call this function with the actual data. So
        // in the null case, we'll just return the same data and expect this function to be re-called. Note: if the conversation got deleted, this will be null,
        // so this logic also handles that case.
        if (currentData === null) {
          return currentData;
        }

        const currentDataJson = currentData as Record<string, unknown>;
        if (currentDataJson.tokenCount !== undefined) {
          // Another client modified this conversation
          return undefined;
        }

        currentDataJson.tokenCount = tokenCount;

        didSet = true;
        return currentData;
      });

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return transactionResult.committed && didSet;
  }

  public async setMessageMistakes(
    language: string,
    conversationId: string,
    messageId: string,
    mistakes: Mistake[]): Promise<boolean> {
    let didSet = false;
    const transactionResult = await runTransaction(
      ref(this.database, conversationMessagesConversationMessagesMessagePath(this.user, language, conversationId, messageId)),
      (currentData) => {
        didSet = false;

        // If the data is not cached, firebase will initially call this with null data. Then, after we submit a result, firebase will look up the actual data on
        // the server and if there is a mismatch (which there will be since this data should never be null), will re-call this function with the actual data.
        // So in the null case, we'll just return the same data and expect this function to be re-called. Note: if the conversation got deleted, this will be
        // null, so this logic also handles that case.
        if (currentData === null) {
          return currentData;
        }

        const currentDataJson = currentData as Record<string, unknown>;
        if (currentDataJson.mistakes !== undefined) {
          // Another client modified this conversation
          return undefined;
        }

        let mistakesJson: unknown;
        if (mistakes.length === 0) {
          mistakesJson = "";
        } else {
          mistakesJson = {};
          for (const [i, mistake] of mistakes.entries()) {
            // Note: the provided MessageMistake object happens to match the database's format so no need to manually assign field values
            (mistakesJson as Record<string, unknown>)[`${i}`] = mistake;
          }
        }

        currentDataJson.mistakes = mistakesJson;
        didSet = true;
        return currentData;
      });

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!transactionResult.committed || !didSet) {
      return false;
    }

    return true;
  }

  public async setConversationMessageSummary(
    language: string,
    conversationId: string,
    messageId: string,
    summary: string): Promise<boolean> {
    let didSet = false;
    const transactionResult = await runTransaction(
      ref(this.database, conversationMessagesConversationMessagesMessagePath(this.user, language, conversationId, messageId)),
      (currentData) => {
        didSet = false;

        // If the data is not cached, firebase will initially call this with null data. Then, after we submit a result, firebase will look up the actual data on
        // the server and if there is a mismatch (which there will be since this data should never be null), will re-call this function with the actual data. So
        // in the null case, we'll just return the same data and expect this function to be re-called. Note: if the conversation got deleted, this will be null,
        // so this logic also handles that case.
        if (currentData === null) {
          return currentData;
        }

        const currentDataJson = currentData as Record<string, unknown>;
        if (currentDataJson.summary !== undefined) {
          // Another client modified this conversation
          return undefined;
        }

        currentDataJson.summary = summary;

        didSet = true;
        return currentData;
      });

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return transactionResult.committed && didSet;
  }

  public async getVocabularyEntries(language: string): Promise<VocabularyEntry[]> {
    const snapshot = await get(ref(this.database, vocabularyPath(this.user, language)));
    const vocabularyEntries: VocabularyEntry[] = [];
    snapshot.forEach((vocabularyEntrySnapshot) => void vocabularyEntries.push(parseVocabularyEntry(vocabularyEntrySnapshot)));
    return vocabularyEntries;
  }

  public async createVocabularyEntry(
    language: string,
    word: string,
    translation: string,
    notes: string,
    tags: string[]): Promise<void> {
    const vocabularyEntryId = encodeVocabularyEntryId(word);

    const updates: Record<string, unknown> = {};
    updates[vocabularyEntryId] = {
      creationDate: serverTimestamp(),
      translation,
      notes,
      tags: tags.join(" "),
    };

    await update(ref(this.database, vocabularyPath(this.user, language)), updates);
  }

  public async updateVocabularyEntry(
    language: string,
    word: string,
    translation: string,
    notes: string,
    tags: string[]): Promise<void> {
    const vocabularyEntryId = encodeVocabularyEntryId(word);

    const updates: Record<string, unknown> = {};
    updates.translation = translation;
    updates.notes = notes;
    updates.tags = tags.join(" ");

    await update(ref(this.database, vocabularyEntryPath(this.user, language, vocabularyEntryId)), updates);
  }

  public async addVocabularyEntrySrsReview(language: string, word: string, date: Date, passed: boolean): Promise<void> {
    const vocabularyEntryId = encodeVocabularyEntryId(word);

    const updates: Record<string, unknown> = {};
    updates[date.toUTCString()] = passed;

    await update(ref(this.database, vocabularyEntryListeningSrsReviewsPath(this.user, language, vocabularyEntryId)), updates);
  }

  public async deleteVocabularyEntries(language: string, words: string[]): Promise<void> {
    const updates: Record<string, unknown> = {};
    for (const word of words) {
      const vocabularyEntryId = encodeVocabularyEntryId(word);
      updates[vocabularyEntryId] = null;
    }

    await update(ref(this.database, vocabularyPath(this.user, language)), updates);
  }

  public async getGrammarRuleEntries(language: string): Promise<GrammarRuleEntry[]> {
    const snapshot = await get(ref(this.database, grammarRulesPath(this.user, language)));
    const grammarRuleEntries: GrammarRuleEntry[] = [];
    snapshot.forEach((grammarRuleEntrySnapshot) => void grammarRuleEntries.push(parseGrammarRuleEntry(grammarRuleEntrySnapshot)));
    return grammarRuleEntries;
  }

  public async createGrammarRuleEntry(language: string, name: string, description: string): Promise<string> {
    const grammarRuleId = push(ref(this.database, grammarRulesPath(this.user, language))).key
      ?? doThrow(new Error("Failed to create grammar rule ID"));

    const updates: Record<string, unknown> = {};
    updates[grammarRuleId] = {
      creationDate: serverTimestamp(),
      name,
      description,
    };

    await update(ref(this.database, grammarRulesPath(this.user, language)), updates);
    return grammarRuleId;
  }

  public async updateGrammarRuleEntry(language: string, grammarRuleId: string, name: string, description: string): Promise<void> {
    const updates: Record<string, unknown> = {};
    updates.name = name;
    updates.description = description;

    await update(ref(this.database, grammarRuleEntryPath(this.user, language, grammarRuleId)), updates);
  }

  public async addGrammarRuleEntrySrsReview(language: string, grammarRuleId: string, date: Date, passed: boolean): Promise<void> {
    const updates: Record<string, unknown> = {};
    updates[date.toUTCString()] = passed;

    await update(ref(this.database, grammarRuleEntryListeningSrsReviewsPath(this.user, language, grammarRuleId)), updates);
  }

  public async deleteGrammarRuleEntries(language: string, grammarRuleIds: string[]): Promise<void> {
    const updates: Record<string, unknown> = {};
    for (const grammarRuleId of grammarRuleIds) {
      updates[grammarRuleId] = null;
    }

    await update(ref(this.database, grammarRulesPath(this.user, language)), updates);
  }

  public disconnect(): void {
    while (this.subscriptions.length > 0) {
      this.subscriptions[this.subscriptions.length - 1].disconnect();
    }
  }

  private onDatabaseSubscriptionDisconnect(databaseSubscription: DatabaseSubscription): void {
    const index = this.subscriptions.indexOf(databaseSubscription);
    if (index >= 0) {
      this.subscriptions.splice(index, 1);
    }
  }
}
