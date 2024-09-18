import { User } from "firebase/auth";
import { Database, DataSnapshot, onValue, push, ref, runTransaction, serverTimestamp, update, get } from "firebase/database";
import { assert, doThrow } from "utilities/errors";

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

export interface Conversation {
  id: string;
  date: Date;
  conversationTopic: string;
  studyTopics: string[];
  studyWords: string[];
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

export class DataState {
  private readonly database: Database;
  private readonly user: User;
  private readonly subscriptions: DatabaseSubscription[] = [];

  public constructor(database: Database, user: User) {
    this.database = database;
    this.user = user;
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
