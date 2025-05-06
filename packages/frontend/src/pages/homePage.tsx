import { Button, ButtonLink } from "components/button";
import { showInputDialog } from "components/dialog";
import { Select } from "components/select";
import { DataState } from "dataState";
import { Auth } from "firebase/auth";
import { supportedLanguages } from "language";
import * as React from "react";
import { useLocalStorageState } from "utilities/useLocalStorage";

interface HomePageProps {
  auth: Auth;
  dataState: DataState;
}

export function HomePage(props: HomePageProps): React.JSX.Element {
  const [selectedLanguage, setSelectedLanguage] = useLocalStorageState("selectedLanguage", (v) => v, supportedLanguages[0]);

  async function handleClickSetWaniKaniApiKey(): Promise<void> {
    const waniKaniApiKey = await props.dataState.getWaniKaniApiKey();
    let updatedWaniKaniApiKey = await showInputDialog("Set WaniKani API Key", "API Key:", waniKaniApiKey ?? "");
    if (updatedWaniKaniApiKey === null) {
      return;
    }

    updatedWaniKaniApiKey = updatedWaniKaniApiKey.trim();
    if (updatedWaniKaniApiKey.length === 0) {
      updatedWaniKaniApiKey = null;
    }

    if (waniKaniApiKey !== updatedWaniKaniApiKey) {
      await props.dataState.setWaniKaniApiKey(updatedWaniKaniApiKey);
    }
  }

  function handleClickLogOut(): void {
    void props.auth.signOut();
  }

  return (
    <div className="home-page">
      <h2>Language Chat</h2>
      <div className="controls">
        <Select value={selectedLanguage} onChange={(e) => setSelectedLanguage(e.target.value)}>
          {supportedLanguages.map((language) => <option key={language} value={language}>{language}</option>)}
        </Select>
        <ButtonLink to={`/${selectedLanguage}/start-conversation`} appearance="Standard" color="Primary" text="Start conversation" />
        <ButtonLink to={`/${selectedLanguage}/conversations`} appearance="Standard" color="Primary" text="View conversations" />
        <ButtonLink to={`/${selectedLanguage}/vocabulary`} appearance="Standard" color="Primary" text="Vocabulary" />
        <ButtonLink to={`/${selectedLanguage}/grammar-rules`} appearance="Standard" color="Primary" text="Grammar rules" />
        {
          selectedLanguage === "Japanese" && (
            <Button type="button" appearance="Standard" color="Primary" text="Set WaniKani API key" onClick={() => void handleClickSetWaniKaniApiKey()} />
          )
        }
        <Button type="button" appearance="Standard" color="Gray" text="Log out" onClick={handleClickLogOut} />
      </div>
    </div>
  );
}