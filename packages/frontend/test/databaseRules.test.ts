import { RulesTestEnvironment, assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, test } from "@jest/globals";
import { serverTimestamp } from "firebase/database";
import { createWriteStream, readFileSync } from "fs";
import { get } from "http";
import path from "path";
import { assert } from "utilities/errors";

// Note: these should match parameters found in firebase.json
const projectId = "language-chat";
const databaseName = "test-database";
const databaseHost = "127.0.0.1";
const databasePort = 9000;

let testEnvironment: RulesTestEnvironment | null = null;

beforeAll(
  async () => {
    const rules = readFileSync(path.resolve(__dirname, "..", "..", "..", "database.rules.json"), "utf8");
    testEnvironment = await initializeTestEnvironment(
      {
        projectId,
        database: {
          host: databaseHost,
          port: databasePort,
          rules,
        },
      });
  });

beforeEach(
  async () => {
    await testEnvironment?.clearDatabase();
  });

// After all tests, write database rules coverage to a file
afterAll(
  async () => {
    const coverageUrl = `http://${databaseHost}:${databasePort}/.inspect/coverage?ns=${databaseName}`;
    const coverageFile = "database-coverage.html";
    const stream = createWriteStream(coverageFile);
    await new Promise<void>(
      (resolve, reject) => {
        get(
          coverageUrl,
          (res) => {
            res.pipe(stream, { end: true });
            res.on("end", resolve);
            res.on("error", reject);
          });
      });
  });

test(
  "initialize user",
  async () => {
    assert(testEnvironment !== null);
    const anonymousUser = testEnvironment.unauthenticatedContext().database();
    const userA = testEnvironment.authenticatedContext("userA").database();

    const conversation = {
      date: serverTimestamp(),
      conversationTopic: "test",
      studyTopics: {},
      studyWords: {},
    };

    const conversationMessages = {
      lastMessageId: "",
      messages: {},
    };

    // Incorrect user fails to initialize data
    await assertFails(
      userA
        .ref("/users/userB/languages/Spanish")
        .update(
          {
            "conversations/convA": conversation,
            "conversationMessages/convA": conversationMessages,
          }));

    // Unauthenticated user fails to initialize data
    await assertFails(
      anonymousUser
        .ref("/users/userA/languages/Spanish")
        .update(
          {
            "conversations/convA": conversation,
            "conversationMessages/convA": conversationMessages,
          }));

    // Initialize complete data - note that in practice, this writes nothing because empty objects are considered not to exist
    await assertSucceeds(
      userA
        .ref("/users/userA/languages/Spanish")
        .update(
          {
            "conversations/convA": conversation,
            "conversationMessages/convA": conversationMessages,
          }));

    // Read data
    await assertSucceeds(
      userA
        .ref("/users/userA/languages/Spanish/conversations")
        .once("value"));

    // Fail to read data because unauthenticated
    await assertFails(
      anonymousUser
        .ref("/users/userA/languages/Spanish/conversations")
        .once("value"));
  });

test(
  "conversations",
  async () => {
    assert(testEnvironment !== null);
    const userA = testEnvironment.authenticatedContext("userA").database();

    // Add a conversation without any messages
    await assertFails(
      userA
        .ref("/users/userA/languages/Spanish")
        .update(
          {
            "conversations/convA": {
              date: serverTimestamp(),
              conversationTopic: "test",
              studyTopics: {},
              studyWords: {},
            },
          }));

    // Add conversation messages without any conversation
    await assertFails(
      userA
        .ref("/users/userA/languages/Spanish")
        .update(
          {
            "conversationMessages/convA": {
              lastMessageId: "",
              messages: {},
            },
          }));

    // Add conversation and conversation messages
    await assertSucceeds(
      userA
        .ref("/users/userA/languages/Spanish")
        .update(
          {
            "conversations/convA": {
              date: serverTimestamp(),
              conversationTopic: "test",
              studyTopics: {},
              studyWords: {},
            },
            "conversationMessages/convA": {
              lastMessageId: "",
              messages: {},
            },
          }));

    // Fail to remove just the conversation
    await assertFails(
      userA
        .ref("/users/userA/languages/Spanish/conversations/convA")
        .remove());

    // Fail to remove just the conversation messages
    await assertFails(
      userA
        .ref("/users/userA/languages/Spanish/conversationMessages/convA")
        .remove());
  });