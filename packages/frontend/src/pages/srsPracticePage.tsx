import { ListVoicesApiResponseVoice } from "api";
import { DataState } from "dataState";
import { showSrsPracticeDialog } from "dialogs/srsPracticeDialog";
import { SrsPractice } from "exercises/srsPractice";
import { SrsPracticeSettings } from "exercises/srsPracticeTypes";
import React from "react";
import { useNavigate } from "react-router-dom";
import { doThrow } from "utilities/errors";

interface SrsPracticePageProps {
  dataState: DataState;
  language: string;
  voices: Map<string, ListVoicesApiResponseVoice[]>;
}

export function SrsPracticePage(props: SrsPracticePageProps): React.JSX.Element {
  const navigate = useNavigate();

  const languageVoices = props.voices.get(props.language) ?? doThrow(new Error(`Voices for language ${props.language} not provided`));
  const [settings, setSettings] = React.useState<SrsPracticeSettings | null>(null);

  async function start(): Promise<void> {
    const settingsInner = await showSrsPracticeDialog(props.language, props.dataState);
    if (settingsInner !== null) {
      setSettings(settingsInner);
    } else {
      navigate("/");
    }
  }

  React.useEffect(() => void start(), []);

  if (settings === null) {
    return <div />;
  }

  return (
    <SrsPractice
      language={props.language}
      settings={settings}
      voices={languageVoices}
      dataState={props.dataState}
      onStop={() => navigate("/")}
    />
  );
}