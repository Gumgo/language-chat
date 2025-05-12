import { listVoices, ListVoicesApiResponseVoice } from "api";
import { DialogManager } from "components/dialog";
import { LoadingDots } from "components/loadingDots";
import { LoginState, useLoginState } from "components/loginState";
import { FirebaseOptions, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { supportedLanguages } from "language";
import { ConversationPage } from "pages/conversationPage";
import { ConversationsPage } from "pages/conversationsPage";
import { GrammarRulesPage } from "pages/grammarRulesPage";
import { HomePage } from "pages/homePage";
import { SrsPracticePage } from "pages/srsPracticePage";
import { StartConversationPage } from "pages/startConversationPage";
import { VocabularyPage } from "pages/vocabularyPage";
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { activeSpeechService } from "speechService";
import { logError } from "utilities/logger";
import { useIsMounted } from "utilities/useIsMounted";

// $TODO:
// - Add "Extra instructions" box for conversations
// - Add a speech page with actions:
//   - Say this word (use the high quality voices)
//   - Use this word in a sentence (generate a sentence automatically)
//   - Button to download the audio clip

const firebaseOptions: FirebaseOptions = {
  apiKey: "AIzaSyDR10RFmWNcWH9zhamlgA5V5fwpGIQdW8E",
  authDomain: "language-chat-9bc61.firebaseapp.com",
  databaseURL: "https://language-chat-9bc61-default-rtdb.firebaseio.com",
  projectId: "language-chat-9bc61",
  storageBucket: "language-chat-9bc61.appspot.com",
  messagingSenderId: "128921954980",
  appId: "1:128921954980:web:9e64508a0399380d051431",
  measurementId: "G-YMHBSSFTPN",
};

const useEmulatorDatabase = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
if (useEmulatorDatabase) {
  firebaseOptions.databaseURL = "http://127.0.0.1:9000/?ns=language-chat-default-rtdb";
}

const app = initializeApp(firebaseOptions);
const auth = getAuth(app);
const database = getDatabase(app);

function NotFound(): React.JSX.Element {
  return <div className="not-found">Page not found</div>;
}

interface LoggedInWithVoicesProps {
  loginState: LoginState;
  voices: Map<string, ListVoicesApiResponseVoice[]>;
}

function LoggedInWithVoices(props: LoggedInWithVoicesProps): React.JSX.Element {
  return (
    <Routes>
      <Route
        index
        element={<HomePage auth={auth} dataState={props.loginState.dataState} />}
      />
      {
        supportedLanguages.map(
          (language) => (
            <React.Fragment key={language}>
              <Route
                path={`/${language}/start-conversation`}
                element={<StartConversationPage dataState={props.loginState.dataState} language={language} voices={props.voices} />}
              />
              <Route
                path={`/${language}/conversations`}
                element={<ConversationsPage dataState={props.loginState.dataState} language={language} />}
              />
              <Route
                path={`/${language}/conversations/:conversationId`}
                element={<ConversationPage dataState={props.loginState.dataState} language={language} voices={props.voices} />}
              />
              <Route
                path={`/${language}/vocabulary`}
                element={<VocabularyPage dataState={props.loginState.dataState} language={language} voices={props.voices} />}
              />
              <Route
                path={`/${language}/grammar-rules`}
                element={<GrammarRulesPage dataState={props.loginState.dataState} language={language} voices={props.voices} />}
              />
              <Route
                path={`/${language}/srs`}
                element={<SrsPracticePage dataState={props.loginState.dataState} language={language} voices={props.voices} />}
              />
            </React.Fragment>
          ))
      }
      <Route
        path="*"
        element={<NotFound />}
      />
    </Routes>
  );
}

interface LoggedInProps {
  loginState: LoginState;
}

function LoggedIn(props: LoggedInProps): React.JSX.Element {
  const isMounted = useIsMounted();
  const [voices, setVoices] = React.useState<Map<string, ListVoicesApiResponseVoice[]> | null | "Error">(null);

  async function fetchVoices(): Promise<void> {
    try {
      const response = await listVoices(activeSpeechService);

      if (isMounted.current) {
        setVoices(new Map(response.languages.map((language) => [language.language, language.voices])));
      }
    } catch (error) {
      logError(error);
      if (isMounted.current) {
        setVoices("Error");
      }
    }
  }

  React.useEffect(
    () => void fetchVoices(),
    []);

  if (voices === "Error") {
    return <div className="fetch-voices-failed">Failed to fetch voices, please try again.</div>;
  }

  return (
    voices === null
      ? (
        <div className="fetching-voices">
          <LoadingDots />
        </div>
      )
      : <LoggedInWithVoices loginState={props.loginState} voices={voices} />
  );
}

function Index(): React.JSX.Element {
  const loginState = useLoginState(auth, database);

  return (
    <BrowserRouter>
      <DialogManager />
      <div className="content-container">
        {loginState !== null && <LoggedIn loginState={loginState} />}
      </div>
    </BrowserRouter>
  );
}

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Root element not found");
}

const root = createRoot(container);
root.render(<Index />);
