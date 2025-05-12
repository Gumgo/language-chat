import { getSpeechTimepoints, speech, SpeechService } from "api";

export function trimAudioPlaybackUrl(url: string, startTimeSeconds: number | null, endTimeSeconds: number | null): string {
  if (startTimeSeconds === null && endTimeSeconds === null) {
    return url;
  }

  return `${url}#t=${startTimeSeconds?.toPrecision(3) ?? ""},${endTimeSeconds?.toPrecision(3) ?? ""}`;
}
export async function generateIsolatedWordSpeechUrl(language: string, service: SpeechService, voice: string, speed: number, word: string): Promise<string> {
  let message = word;
  let ssml = false;
  if (service === "Google" && language === "Japanese") {
    message = `<speak>言葉は<break time="500ms" /><mark name="a" />「${word}」<mark name="b" /><break time="500ms" />です。</speak>`;
    ssml = true;
  }

  const response = await speech({ language, service, voice, speed, message, ssml });

  if (ssml) {
    const timepoints = await getSpeechTimepoints(response);
    const timepointA = timepoints.timepoints.find((v) => v.markName === "a");
    const timepointB = timepoints.timepoints.find((v) => v.markName === "b");
    if (timepointA === undefined || timepointB === undefined) {
      throw new Error("No timepoints generated");
    }

    return trimAudioPlaybackUrl(response.audioUrl, timepointA.timeSeconds, timepointB.timeSeconds);
  } else {
    return response.audioUrl;
  }
}