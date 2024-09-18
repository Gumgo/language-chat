import { ListVoicesApiResponseVoice, Model, modelValues, VoiceGender, voiceGenderValues } from "api";
import { Button } from "components/button";
import { Checkbox } from "components/checkbox";
import { showDialog } from "components/dialog";
import { Select } from "components/select";
import { ConversationSettings, MistakeExplanationLanguage } from "conversation";
import * as React from "react";
import { doThrow } from "utilities/errors";

const speechSpeedValues = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];

export async function showConversationSettingsDialog(
  language: string,
  voices: Map<string, ListVoicesApiResponseVoice[]>,
  conversationSettings: ConversationSettings,
): Promise<ConversationSettings | null> {
  const result = await showDialog(
    (dialogProps) => {
      const languageVoices = voices.get(language) ?? doThrow(new Error(`Voices for language ${language} not provided`));
      const voicesByGender = React.useMemo(
        () => {
          const voiceByGenderResult = new Map<string, string[]>();
          for (const voice of languageVoices) {
            let voiceList = voiceByGenderResult.get(voice.gender);
            if (voiceList === undefined) {
              voiceList = [];
              voiceByGenderResult.set(voice.gender, voiceList);
            }

            voiceList.push(voice.name);
          }

          return voiceByGenderResult;
        },
        [languageVoices]);

      const initialVoice = React.useMemo(
        () => languageVoices.find((v) => v.name === conversationSettings.voice) ?? languageVoices[0],
        [languageVoices]);

      const [model, setModel] = React.useState(conversationSettings.model);
      const [voiceGender, setVoiceGender] = React.useState<VoiceGender>(initialVoice.gender);

      // Keep track of the last voice selection for each gender
      const [selectedVoicesByGender, setSelectedVoicesByGender] = React.useState(
        () => new Map<string, string>(
          [...voicesByGender.entries()].map((v) => [v[0], v[0] === initialVoice.gender ? initialVoice.name : v[1][0]])));

      const [speechSpeed, setSpeechSpeed] = React.useState(conversationSettings.speechSpeed);
      const [autoPlayResponses, setAutoPlayResponses] = React.useState(conversationSettings.autoPlayResponses);
      const [hideResponseText, setHideResponseText] = React.useState(conversationSettings.hideResponseText);
      const [mistakeExplanationLanguage, setMistakeExplanationLanguage] = React.useState(conversationSettings.mistakeExplanationLanguage);

      const selectedGenderVoices = voicesByGender.get(voiceGender) ?? doThrow(new Error("No voices for the selected gender"));
      const selectedVoice = selectedVoicesByGender.get(voiceGender) ?? doThrow(new Error("No selected voice for the selected gender"));

      const selectedConversationSettings: ConversationSettings = {
        model,
        voice: selectedVoice,
        speechSpeed,
        autoPlayResponses,
        hideResponseText,
        mistakeExplanationLanguage,
      };

      function setSelectedVoice(voice: string): void {
        setSelectedVoicesByGender(new Map<string, string>([...selectedVoicesByGender.entries()].map((v) => [v[0], v[0] === voiceGender ? voice : v[1]])));
      }

      return (
        <div className="options-dialog-container">
          <h3>Conversation settings</h3>
          <div className="conversation-settings">
            <div className="label">Model</div>
            <Select value={model} onChange={(e) => setModel(e.target.value as Model)}>
              {modelValues.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
            <div className="label">Voice gender</div>
            <Select value={voiceGender} onChange={(e) => setVoiceGender(e.target.value as VoiceGender)}>
              {voiceGenderValues.filter((v) => voicesByGender.has(v)).map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
            <div className="label">Voice</div>
            <Select value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)}>
              {selectedGenderVoices.map((v) => <option key={`${voiceGender}-${v}`} value={v}>{v}</option>)}
            </Select>
            <div className="label">Speech speed</div>
            <Select value={speechSpeed} onChange={(e) => setSpeechSpeed(parseInt(e.target.value))}>
              {speechSpeedValues.map((v) => <option key={v} value={v}>{`${v}%`}</option>)}
            </Select>
            <div />
            <label>
              <Checkbox checked={autoPlayResponses} onChange={setAutoPlayResponses} />
              Auto-play responses
            </label>
            <div />
            <label>
              <Checkbox checked={hideResponseText} onChange={setHideResponseText} />
              Hide response text
            </label>
            <div className="label">Mistake explanation language</div>
            <Select value={mistakeExplanationLanguage} onChange={(e) => setMistakeExplanationLanguage(e.target.value as MistakeExplanationLanguage)}>
              <option value="English">English</option>
              <option value="Language">{language}</option>
            </Select>
          </div>
          <div className="buttons">
            <Button
              type="button"
              appearance="Standard"
              color="Gray"
              text="Cancel"
              onClick={() => dialogProps.onClose(null)}
            />
            <Button
              type="button"
              appearance="Standard"
              color="Primary"
              text="Accept"
              onClick={() => dialogProps.onClose(selectedConversationSettings)}
            />
          </div>
        </div>
      );
    },
    undefined,
    { width: "Small" });

  return result as ConversationSettings | null;
}