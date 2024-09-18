import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import * as ajv from "ajv";
import * as bodyParser from "body-parser";
import { createHash } from "crypto";
import express from "express";
import * as admin from "firebase-admin";
import { getDownloadURL, getStorage } from "firebase-admin/storage";
import * as functions from "firebase-functions";
import { existsSync } from "fs";
import OpenAI from "openai";
import * as path from "path";
import { encoding_for_model, TiktokenModel } from "tiktoken";

function doThrow(error: Error): never {
  throw error;
}

admin.initializeApp();
const storageBucket = getStorage().bucket();

const app = express();
const jsonParser = bodyParser.json();
const jsonValidator = new ajv.Ajv();

// Remove redundant function name prefix in routing
const urlPrefix = "/api";

app.use(
  (req, _res, next) => {
    if (req.url.startsWith(`${urlPrefix}/`)) {
      req.url = req.url.substring(urlPrefix.length);
    }

    next();
  });

interface Globals {
  openAi: OpenAI;
  textToSpeechClient: TextToSpeechClient;
}

let globals: Globals | null = null;

function getGlobals(): Globals {
  return globals ?? doThrow(new Error("Globals not initialized"));
}

// Environment variables aren't available until the function runs so we lazily-initialize globals
app.use(
  (_req, _res, next) => {
    if (globals === null) {
      const openAiApiKey = process.env.OPENAI_API_KEY ?? doThrow(new Error("OpenAI API key not provided"));
      const openAiProjectId = process.env.OPENAI_PROJECT_ID ?? doThrow(new Error("OpenAI project ID not provided"));
      const tiktokenCacheDir = process.env.TIKTOKEN_CACHE_DIR ?? doThrow(new Error("Tiktoken cache directory not provided"));

      // Make sure we've pre-downloaded all expected cache files for tiktoken. Instructions are here:
      // https://stackoverflow.com/questions/76106366/how-to-use-tiktoken-in-offline-mode-computer
      const expectedTiktokenCacheFiles = [
        "6d1cbeee0f20b3d9449abfede4726ed8212e3aee",
        "6c7ea1a7e38e3a7f062df639a5b80947f075ffe6",
        "0ea1e91bbb3a60f729a8dc8f777fd2fc07cd8df4",
        "ec7223a39ce59f226a68acc30dc1af2788490e15",
        "9b5ad71b2ce5302211f9c61530b329a4922fc6a4",
        "fb374d419588a4632f3f557e76b4b70aebbca790",
      ];

      for (const file of expectedTiktokenCacheFiles) {
        if (!existsSync(path.join(tiktokenCacheDir, file))) {
          throw new Error(`Expected tiktoken cache file '${file}' does not exist`);
        }
      }

      globals = {
        openAi: new OpenAI({ apiKey: openAiApiKey, project: openAiProjectId }),
        textToSpeechClient: new TextToSpeechClient({ keyFile: "./language-chat-service-account.json" }),
      };
    }

    next();
  });

// $TODO this causes requests to hang, not sure why:
// import cors from "cors";
// app.use(cors);

const languageCodesFromLanguages: ReadonlyMap<string, string> = new Map<string, string>(
  [
    ["Spanish", "es-US"],
    ["Japanese", "ja-JP"],
    ["French", "fr-FR"],
  ]);

const languageValues = [...languageCodesFromLanguages.keys()];

const senderValues = ["System", "Assistant", "User"] as const;
type Sender = typeof senderValues[number];

const modelValues = ["gpt-3.5-turbo", "gpt-4o-mini", "gpt-4o", "gpt-4", "gpt-4-turbo"] as const;
type Model = typeof modelValues[number];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const voiceGenderValues = ["Male", "Female"] as const;
type VoiceGender = typeof voiceGenderValues[number];

interface ChatMessage {
  sender: Sender;
  content: string;
}

interface ChatApiRequest {
  model: Model;
  messages: ChatMessage[];
  temperature: number;
}

interface ChatApiResponse {
  message: string;
  inputTokenCounts: number[];
  outputTokenCount: number;
}

const chatApiRequestSchema: ajv.JSONSchemaType<ChatApiRequest> = {
  type: "object",
  properties: {
    model: {
      type: "string",
      enum: modelValues,
    },
    messages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sender: {
            type: "string",
            enum: senderValues,
          },
          content: {
            type: "string",
          },
        },
        required: ["sender", "content"],
        additionalProperties: false,
      },
    },
    temperature: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
  },
  required: ["model", "messages", "temperature"],
  additionalProperties: false,
};

interface ListVoicesApiResponseVoice {
  name: string;
  gender: VoiceGender;
}

interface ListVoicesApiResponseLanguage {
  language: string;
  voices: ListVoicesApiResponseVoice[];
}

interface ListVoicesApiResponse {
  languages: ListVoicesApiResponseLanguage[];
}

interface SpeechApiRequest {
  language: string;
  voice: string;
  speed: number;
  message: string;
}

const speechApiRequestSchema: ajv.JSONSchemaType<SpeechApiRequest> = {
  type: "object",
  properties: {
    language: {
      type: "string",
      enum: languageValues,
    },
    voice: {
      type: "string",
    },
    speed: {
      type: "number",
      minimum: 50,
      maximum: 100,
    },
    message: {
      type: "string",
    },
  },
  required: ["language", "voice", "speed", "message"],
  additionalProperties: false,
};

app.post(
  "/v1/chat",
  jsonParser,
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  async (req, res) => {
    const body = req.body as ChatApiRequest;
    if (!jsonValidator.validate(chatApiRequestSchema, body)) {
      res.sendStatus(400);
      return;
    }

    function roleFromSender(sender: Sender): "system" | "assistant" | "user" {
      switch (sender) {
      case "System":
        return "system";

      case "Assistant":
        return "assistant";

      case "User":
        return "user";

      default:
        throw new Error("Invalid sender");
      }
    }

    const result = await getGlobals().openAi.chat.completions.create(
      {
        messages: body.messages.map(
          (message) => (
            {
              role: roleFromSender(message.sender),
              content: message.content,
            })),
        model: body.model,
        response_format: { type: "text" },
        temperature: body.temperature,
      });

    const responseMessage = result.choices[0].message.content;
    if (responseMessage === null) {
      res.sendStatus(500);
      return;
    }

    let inputTokenCounts: number[];
    let outputTokenCount: number;
    const encoding = encoding_for_model(body.model as TiktokenModel);
    try {
      // See https://github.com/openai/openai-cookbook/blob/main/examples/How_to_count_tokens_with_tiktoken.ipynb for details on token counting. Note that for
      // simplicity we're just counting tokens from message content and not any additional tokens.
      inputTokenCounts = body.messages.map((message) => encoding.encode(message.content).length);
      outputTokenCount = encoding.encode(responseMessage).length;
    } finally {
      encoding.free();
    }

    const response: ChatApiResponse = {
      message: responseMessage,
      inputTokenCounts,
      outputTokenCount,
    };

    res.status(200).send(response);
  });

app.get(
  "/v1/voices",
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  async (_req, res) => {
    const response: ListVoicesApiResponse = {
      languages: [],
    };

    for (const [language, languageCode] of languageCodesFromLanguages.entries()) {
      const [listVoicesResponse] = await getGlobals().textToSpeechClient.listVoices({ languageCode });
      response.languages.push(
        {
          language,
          voices: (listVoicesResponse.voices ?? [])
            .map(
              (voice) => {
                let name = voice.name ?? "";
                let gender: VoiceGender;
                switch (voice.ssmlGender) {
                case "MALE":
                  gender = "Male";
                  break;

                case "FEMALE":
                  gender = "Female";
                  break;

                default:
                  gender = "Male";
                  name = ""; // Use this to filter out unsupported voices
                }

                return { name, gender };
              })
            .filter((voice) => voice.name.length > 0),
        });
    }

    res.status(200).send(response);
  });

app.post(
  "/v1/speech",
  jsonParser,
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  async (req, res) => {
    const body = req.body as SpeechApiRequest;
    if (!jsonValidator.validate(speechApiRequestSchema, body)) {
      res.sendStatus(400);
      return;
    }

    const languageCode = languageCodesFromLanguages.get(body.language);
    if (languageCode === undefined) {
      throw new Error(`Unsupported language ${body.language}`);
    }

    // Speech files expire after two days. The filename includes a hash of the file's creation day index (i.e. the date rounded down to the beginning of the
    // day). This means that once the current day is over, all existing speech files are considered expired and we'll generate new ones. We do this so that
    // there is no risk of a speech file expiring right after it is generated.
    const date = new Date();
    const dayIndex = Math.floor(date.getTime() / (24 * 60 * 60 * 1000));
    const hashInputs = [
      dayIndex.toString(),
      body.language,
      body.voice,
      body.speed.toString(),
      body.message,
    ];

    const hashInput = hashInputs.join("|");
    const hash = createHash("sha256").update(hashInput).digest("base64url");
    const storagePath = `speech/${hash}.mp3`;
    const storageFile = storageBucket.file(storagePath);

    const [fileExists] = await storageFile.exists();
    if (!fileExists) {
      // The file doesn't yet exist so generate and upload it
      const [response] = await getGlobals().textToSpeechClient.synthesizeSpeech(
        {
          input: {
            text: body.message,
          },
          voice: {
            languageCode,
            name: body.voice,
          },
          audioConfig: {
            audioEncoding: "MP3",
            speakingRate: body.speed * 0.01,
          },
        });

      if (response.audioContent === null || response.audioContent === undefined || typeof response.audioContent === "string") {
        res.sendStatus(500);
        return;
      }

      await storageFile.save(Buffer.from(response.audioContent), { contentType: "audio/mpeg" });
    }

    // Note: 201 is "created" and technically we may not create the resource if it's already cached but that shouldn't cause issues
    const downloadUrl = await getDownloadURL(storageFile);
    res.status(201).send(downloadUrl);
  });

export const api = functions.https.onRequest(app);
