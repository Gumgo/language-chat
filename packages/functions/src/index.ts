import { protos, v1beta1 } from "@google-cloud/text-to-speech";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import * as ajv from "ajv";
import assert from "assert";
import * as bodyParser from "body-parser";
import { createHash } from "crypto";
import express from "express";
import * as admin from "firebase-admin";
import { getDownloadURL, getStorage } from "firebase-admin/storage";
import * as functions from "firebase-functions";
import { existsSync } from "fs";
import { CancellationDetails, ResultReason, SpeechConfig, SpeechSynthesisOutputFormat, SpeechSynthesisResult, SpeechSynthesizer, SynthesisVoiceGender, SynthesisVoiceType } from "microsoft-cognitiveservices-speech-sdk";
import OpenAI from "openai";
import * as path from "path";
import { encoding_for_model, TiktokenModel } from "tiktoken";

const microsoftSpeechSdkRegion = "westus";

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
  textToSpeechClient: v1beta1.TextToSpeechClient;
  microsoftSpeechSdkKey: string;
}

let globals: Globals | null = null;

function getGlobals(): Globals {
  return globals ?? doThrow(new Error("Globals not initialized"));
}

// These time value suffixes are sorted from longest to shortest so that find() can be used to identify the first matching one
const timeValueSuffixes = ["s", "ms"].sort((a, b) => b.length - a.length);

function scaleTimeValue(value: string, scale: number): string | null {
  const trimmedValue = value.trim();
  const suffix = timeValueSuffixes.find((v) => trimmedValue.endsWith(v));
  if (suffix === undefined) {
    return null;
  }

  const parsedValue = parseFloat(trimmedValue.substring(0, trimmedValue.length - suffix.length));
  if (isNaN(parsedValue)) {
    return null;
  }

  return `${parsedValue * scale}${suffix}`;
}

function scaleSsmlSpeechSpeed(message: string, scale: number): string | null {
  const domParser = new DOMParser();
  const xmlDocument = domParser.parseFromString(message, "application/xml");
  const rootNode = xmlDocument.documentElement;
  if (rootNode === null || rootNode.getElementsByTagName("parsererror").length > 0 || rootNode.tagName !== "speak") {
    return null;
  }

  // Find the root voice tag
  const rootVoiceNode = [...rootNode.getElementsByTagName("voice")].find((v) => v.parentElement === rootNode);
  if (rootVoiceNode === undefined) {
    return null;
  }

  // Add a root-level prosody tag to slow down speech
  const rootProsodyNode = xmlDocument.createElement("prosody");
  rootProsodyNode.setAttribute("rate", `${scale}`);

  // Move over children
  const rootChildren = [...rootVoiceNode.childNodes];
  for (const child of rootChildren) {
    rootVoiceNode.removeChild(child);
    rootProsodyNode.appendChild(child);
  }

  rootVoiceNode.appendChild(rootProsodyNode);

  // Find any prosody nodes with the "rate" attribute and scale the value
  for (const prosodyNode of rootProsodyNode.getElementsByTagName("prosody")) {
    if (prosodyNode === rootProsodyNode) {
      continue;
    }

    const rate = prosodyNode.getAttribute("rate");
    if (rate !== null) {
      const rateValue = parseFloat(rate);
      if (isNaN(rateValue)) {
        // Only number values are supported, not "low", "medium", "high", etc. because we need the ability to scale the rate
        return null;
      }

      const scaledRateValue = rateValue * scale;
      prosodyNode.setAttribute("rate", scaledRateValue.toString());
    }

    const duration = prosodyNode.getAttribute("duration");
    if (duration !== null) {
      const scaledDuration = scaleTimeValue(duration, scale);
      if (scaledDuration === null) {
        return null;
      }

      prosodyNode.setAttribute("duration", scaledDuration);
    }
  }

  // Find any break nodes and scale the time value
  for (const breakNode of rootProsodyNode.getElementsByTagName("break")) {
    const time = breakNode.getAttribute("time");
    if (time !== null) {
      const scaledTime = scaleTimeValue(time, scale);
      if (scaledTime === null) {
        return null;
      }

      breakNode.setAttribute("time", scaledTime);
    }
  }

  const xmlSerializer = new XMLSerializer();
  return xmlSerializer.serializeToString(rootNode);
}

// Environment variables aren't available until the function runs so we lazily-initialize globals
app.use(
  (_req, _res, next) => {
    if (globals === null) {
      const openAiApiKey = process.env.OPENAI_API_KEY ?? doThrow(new Error("OpenAI API key not provided"));
      const openAiProjectId = process.env.OPENAI_PROJECT_ID ?? doThrow(new Error("OpenAI project ID not provided"));
      const tiktokenCacheDir = process.env.TIKTOKEN_CACHE_DIR ?? doThrow(new Error("Tiktoken cache directory not provided"));
      const microsoftSpeechSdkKey = process.env.MICROSOFT_SPEECH_SDK_KEY ?? doThrow(new Error("Microsoft Speech SDK key not provided"));

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
        textToSpeechClient: new v1beta1.TextToSpeechClient({ keyFile: "./language-chat-service-account.json" }),
        microsoftSpeechSdkKey,
      };
    }

    next();
  });

// $TODO this causes requests to hang, not sure why:
// import cors from "cors";
// app.use(cors);

const languageCodesFromLanguages: ReadonlyMap<string, string> = new Map<string, string>(
  [
    ["English", "en-US"],
    ["Spanish", "es-US"],
    ["Japanese", "ja-JP"],
    ["French", "fr-FR"],
  ]);

const languageValues = [...languageCodesFromLanguages.keys()];

const senderValues = ["System", "Assistant", "User"] as const;
type Sender = typeof senderValues[number];

const modelValues = ["gpt-3.5-turbo", "gpt-4o-mini", "gpt-4", "gpt-4o", "gpt-4-turbo", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"] as const;
type Model = typeof modelValues[number];

const speechServiceValues = ["Google", "Microsoft"] as const;
type SpeechService = typeof speechServiceValues[number];

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
  service: SpeechService;
  language: string;
  voice: string;
  speed: number;
  message: string;
  ssml: boolean;
}

interface SpeechApiResponse {
  audioUrl: string;
  timepointsUrl?: string;
}

interface SpeechTimepoint {
  markName: string;
  timeSeconds: number;
}

interface SpeechTimepoints {
  timepoints: SpeechTimepoint[];
}

const speechApiRequestSchema: ajv.JSONSchemaType<SpeechApiRequest> = {
  type: "object",
  properties: {
    service: {
      type: "string",
      enum: speechServiceValues,
    },
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
    ssml: {
      type: "boolean",
    },
  },
  required: ["language", "voice", "speed", "message", "ssml"],
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
  "/v1/voices/:service",
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  async (req, res) => {
    const response: ListVoicesApiResponse = {
      languages: [],
    };

    if (req.params.service === "Google") {
      for (const [language, languageCode] of languageCodesFromLanguages.entries()) {
        const [listVoicesResponse] = await getGlobals().textToSpeechClient.listVoices({ languageCode });
        response.languages.push(
          {
            language,
            voices: (listVoicesResponse.voices ?? [])
              .filter((voice) => voice.name?.includes("Wavenet") ?? false)
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
    } else if (req.params.service === "Microsoft") {
      const speechConfig = SpeechConfig.fromSubscription(getGlobals().microsoftSpeechSdkKey, microsoftSpeechSdkRegion);
      const speechSynthesizer = new SpeechSynthesizer(speechConfig, null);
      for (const [language, languageCode] of languageCodesFromLanguages.entries()) {
        const listVoicesResult = await speechSynthesizer.getVoicesAsync(languageCode);
        response.languages.push(
          {
            language,
            voices: listVoicesResult.voices
              .filter((voice) => voice.voiceType === SynthesisVoiceType.OnlineNeural) // OnlineNeuralHD does not seem to be available
              .map(
                (voice) => {
                  let name = voice.name;
                  let gender: VoiceGender;
                  switch (voice.gender) {
                  case SynthesisVoiceGender.Male:
                    gender = "Male";
                    break;

                  case SynthesisVoiceGender.Female:
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
    } else {
      res.sendStatus(404);
    }
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
      body.service,
      body.language,
      body.voice,
      body.speed.toString(),
      body.message,
      body.ssml.toString(),
    ];

    const hashInput = hashInputs.join("|");
    const hash = createHash("sha256").update(hashInput).digest("base64url");
    const audioStoragePath = `speech/${hash}.mp3`;
    const audioStorageFile = storageBucket.file(audioStoragePath);
    const timepointsStoragePath = `speech/${hash}.timepoints`;
    const timepointsStorageFile = storageBucket.file(timepointsStoragePath);

    const [fileExists] = await audioStorageFile.exists();
    if (!fileExists) {
      // The file doesn't yet exist so generate and upload it
      const promises: Promise<void>[] = [];
      switch (body.service) {
      case "Google":
      {
        const [response] = await getGlobals().textToSpeechClient.synthesizeSpeech(
          {
            input: {
              text: !body.ssml ? body.message : undefined,
              ssml: body.ssml ? body.message : undefined,
            },
            voice: {
              languageCode,
              name: body.voice,
            },
            enableTimePointing: body.ssml ? [protos.google.cloud.texttospeech.v1beta1.SynthesizeSpeechRequest.TimepointType.SSML_MARK] : undefined,
            audioConfig: {
              audioEncoding: "MP3",
              speakingRate: body.speed * 0.01,
            },
          });

        if (response.audioContent === null || response.audioContent === undefined || typeof response.audioContent === "string") {
          res.sendStatus(500);
          return;
        }

        promises.push(audioStorageFile.save(Buffer.from(response.audioContent), { contentType: "audio/mpeg" }));

        if (body.ssml) {
          const timepoints: SpeechTimepoints = {
            timepoints: (response.timepoints ?? [])
              .filter((v) => v.markName !== null && v.markName !== undefined && v.timeSeconds !== null && v.timeSeconds !== undefined)
              .map(
                (v) => {
                  assert(v.markName !== null && v.markName !== undefined);
                  assert(v.timeSeconds !== null && v.timeSeconds !== undefined);
                  return { markName: v.markName, timeSeconds: v.timeSeconds };
                }),
          };

          const timepointsJson = JSON.stringify(timepoints);
          promises.push(timepointsStorageFile.save(timepointsJson, { contentType: "application/json" }));
        }

        break;
      }

      case "Microsoft":
      {
        const speechConfig = SpeechConfig.fromSubscription(getGlobals().microsoftSpeechSdkKey, microsoftSpeechSdkRegion);
        speechConfig.speechSynthesisVoiceName = body.voice;
        speechConfig.speechSynthesisOutputFormat = SpeechSynthesisOutputFormat.Audio48Khz96KBitRateMonoMp3;
        const speechSynthesizer = new SpeechSynthesizer(speechConfig, null);

        const timepoints: SpeechTimepoints = { timepoints: [] };
        speechSynthesizer.bookmarkReached = (_, event) => timepoints.timepoints.push({ markName: event.text, timeSeconds: event.audioOffset / 10000000 });

        let message = body.message;
        let ssml = body.ssml;
        if (ssml && !message.trim().startsWith("<speak ")) {
          // For convenience, we don't require the speak tag to be explicitly provided
          message = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${languageCode}">`
            + `<voice name="${body.voice}">${body.message}</voice></speak>`;
        }

        if (body.speed !== 100) {
          ssml = true;
          if (body.ssml) {
            // We need to scale any existing SSML prosody rate values
            const scaleResult = scaleSsmlSpeechSpeed(message, body.speed * 0.01);
            if (scaleResult === null) {
              res.sendStatus(400);
              return;
            }

            message = scaleResult;
          } else {
            message = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${languageCode}">`
              + `<voice name="${body.voice}"><prosody rate="${body.speed * 0.01}">${message}</prosody></voice></speak>`;
          }
        }

        const result = await new Promise<SpeechSynthesisResult>(
          (resolve) => {
            if (ssml) {
              speechSynthesizer.speakSsmlAsync(message, resolve);
            } else {
              speechSynthesizer.speakTextAsync(message, resolve);
            }
          });

        if (result.reason !== ResultReason.SynthesizingAudioCompleted) {
          // This logging is useful to diagnose issues
          console.log("Speech synthesis failed");
          console.log(`Message: ${message}`);
          console.log(`Failure reason: ${result.reason}`);
          if (result.reason === ResultReason.Canceled) {
            const cancellationDetails = CancellationDetails.fromResult(result);
            console.log(`  Cancellation code: ${cancellationDetails.ErrorCode}`);
            console.log(`  Cancellation reason: ${cancellationDetails.reason}`);
            console.log(`  Cancellation error details: ${cancellationDetails.errorDetails}`);
          }

          res.sendStatus(500);
          return;
        }

        promises.push(audioStorageFile.save(Buffer.from(result.audioData), { contentType: "audio/mpeg" }));

        if (body.ssml) {
          const timepointsJson = JSON.stringify(timepoints);
          promises.push(timepointsStorageFile.save(timepointsJson, { contentType: "application/json" }));
        }

        break;
      }
      }

      await Promise.all(promises);
    }

    const response: SpeechApiResponse = {
      audioUrl: await getDownloadURL(audioStorageFile),
      timepointsUrl: body.ssml ? await getDownloadURL(timepointsStorageFile) : undefined,
    };

    // Note: 201 is "created" and technically we may not create the resource if it's already cached but that shouldn't cause issues
    res.status(201).send(response);
  });

export const api = functions.https.onRequest(app);
