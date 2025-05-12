import { doThrow } from "utilities/errors";

export const senderValues = ["System", "Assistant", "User"] as const;
export type Sender = typeof senderValues[number];

export const modelValues = ["gpt-3.5-turbo", "gpt-4o-mini", "gpt-4", "gpt-4o", "gpt-4-turbo", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"] as const;
export type Model = typeof modelValues[number];

export const speechServiceValues = ["Google", "Microsoft"] as const;
export type SpeechService = typeof speechServiceValues[number];

export const voiceGenderValues = ["Male", "Female"] as const;
export type VoiceGender = typeof voiceGenderValues[number];

export interface ChatMessage {
  sender: Sender;
  content: string;
}

export interface ChatApiRequest {
  model: Model;
  messages: ChatMessage[];
  temperature: number;
}

export interface ChatApiResponse {
  message: string;
  inputTokenCounts: number[];
  outputTokenCount: number;
}

export interface ListVoicesApiResponseVoice {
  name: string;
  gender: VoiceGender;
}

export interface ListVoicesApiResponseLanguage {
  language: string;
  voices: ListVoicesApiResponseVoice[];
}

export interface ListVoicesApiResponse {
  languages: ListVoicesApiResponseLanguage[];
}

export interface SpeechApiRequest {
  language: string;
  service: SpeechService;
  voice: string;
  speed: number;
  message: string;
  ssml: boolean;
}

export interface SpeechApiResponse {
  audioUrl: string;
  timepointsUrl?: string;
}

export interface SpeechTimepoint {
  markName: string;
  timeSeconds: number;
}

export interface SpeechTimepoints {
  timepoints: SpeechTimepoint[];
}

export async function chat(request: ChatApiRequest): Promise<ChatApiResponse> {
  const response = await fetch(
    "/api/v1/chat",
    {
      method: "POST",
      body: JSON.stringify(request),
      headers: { "Content-Type": "application/json" },
    });

  return response.status >= 200 && response.status < 300
    ? await response.json() as ChatApiResponse
    : doThrow(new Error("Chat request failed"));
}

export async function listVoices(service: SpeechService): Promise<ListVoicesApiResponse> {
  const response = await fetch(`/api/v1/voices/${service}`);
  return response.status >= 200 && response.status < 300
    ? await response.json() as ListVoicesApiResponse
    : doThrow(new Error("List voices request failed"));
}

// Returns URL of uploaded TTS clip
export async function speech(request: SpeechApiRequest): Promise<SpeechApiResponse> {
  const response = await fetch(
    "/api/v1/speech",
    {
      method: "POST",
      body: JSON.stringify(request),
      headers: { "Content-Type": "application/json" },
    });

  return response.status >= 200 && response.status < 300
    ? await response.json() as SpeechApiResponse
    : doThrow(new Error("Speech request failed"));
}

export async function getSpeechTimepoints(speechResponse: SpeechApiResponse): Promise<SpeechTimepoints> {
  if (speechResponse.timepointsUrl === undefined) {
    return { timepoints: [] };
  }

  const response = await fetch(speechResponse.timepointsUrl);

  return response.status >= 200 && response.status < 300
    ? await response.json() as SpeechTimepoints
    : doThrow(new Error("Timepoints request failed"));
}