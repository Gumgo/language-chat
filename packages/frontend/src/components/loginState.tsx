import { showDialog, showErrorDialog } from "components/dialog";
import { DataState } from "dataState";
import { Auth, EmailAuthProvider, GoogleAuthProvider, User } from "firebase/auth";
import { Database } from "firebase/database";
import { auth as firebaseAuth } from "firebaseui";
import "firebaseui/dist/firebaseui.css";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { assert } from "utilities/errors";

let authUi: firebaseui.auth.AuthUI | null = null;

async function showLoginDialog(auth: Auth): Promise<void> {
  await showDialog(
    (props) => {
      const rootElement = useRef<HTMLDivElement | null>(null);

      useLayoutEffect(
        () => {
          if (authUi === null) {
            authUi = new firebaseAuth.AuthUI(auth);
          }

          assert(rootElement.current !== null);

          const firebaseUiConfig: firebaseui.auth.Config = {
            signInOptions: [
              GoogleAuthProvider.PROVIDER_ID,
              EmailAuthProvider.PROVIDER_ID,
            ],
            callbacks: {
              signInSuccessWithAuthResult: () => {
                props.onClose(undefined);
                return false;
              },
              signInFailure: (error) => {
                void showErrorDialog("Sign in failed", error.message);
              },
            },
            signInFlow: "popup",
          };

          authUi.start(rootElement.current, firebaseUiConfig);
        },
        []);

      return (
        <div className="authentication-dialog">
          <h3>Please sign in</h3>
          <div ref={rootElement} />
        </div>
      );
    },
    undefined,
    { width: "Unset" });
}

export interface LoginState {
  user: User;
  dataState: DataState;
}

export function useLoginState(auth: Auth, database: Database): LoginState | null {
  const [loginState, setLoginState] = useState<LoginState | null>(null);
  const dataState = useRef<DataState | null>(null);

  useEffect(
    () => auth.onAuthStateChanged(
      (user) => {
        dataState.current?.disconnect();
        dataState.current = null;

        if (user === null) {
          // Allow the user to sign in
          void showLoginDialog(auth);
          setLoginState(null);
        } else {
          dataState.current = new DataState(database, user);
          setLoginState({ user, dataState: dataState.current });
        }
      }),
    []);

  return loginState;
}
