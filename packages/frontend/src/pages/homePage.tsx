import { Button, ButtonLink } from "components/button";
import { Select } from "components/select";
import { Auth } from "firebase/auth";
import { supportedLanguages } from "language";
import * as React from "react";
import { useLocalStorageState } from "utilities/useLocalStorage";

interface HomePageProps {
  auth: Auth;
}

export function HomePage(props: HomePageProps): React.JSX.Element {
  const [selectedLanguage, setSelectedLanguage] = useLocalStorageState("selectedLanguage", (v) => v, supportedLanguages[0]);

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
        <Button type="button" appearance="Standard" color="Gray" text="Log out" onClick={handleClickLogOut} />
      </div>
    </div>
  );
}