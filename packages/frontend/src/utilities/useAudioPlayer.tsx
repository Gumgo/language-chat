import * as React from "react";
import { assert } from "utilities/errors";
import { useStateRef } from "utilities/useStateRef";
import { useIsMounted } from "./useIsMounted";

export type AudioState = "Generating" | "Ready" | "Error";

export interface AudioPlayer<TAudioIdentifier> {
  playAudio: (audioIdentifier: TAudioIdentifier) => void;
  stopAudio: (audioIdentifier?: TAudioIdentifier) => void;

  audioStates: ReadonlyMap<string, AudioState>;
  playingAudioIdentifier: TAudioIdentifier | null;
}

export function useAudioPlayer<TAudioIdentifier>(
  generateAudioUrl: (audioIdentifier: TAudioIdentifier) => Promise<string>,
  getKey: (audioIdentifier: TAudioIdentifier) => string,
): AudioPlayer<TAudioIdentifier> {
  const [audioStatesState, audioStatesRef, setAudioStates] = useStateRef(new Map<string, AudioState>());
  const audioUrls = React.useRef(new Map<string, string>());
  const [playingAudioIdentifierState, playingAudioIdentifierRef, setPlayingAudioIdentifier] = useStateRef<TAudioIdentifier | null>(null);

  const audioElement = React.useRef<HTMLAudioElement | null>(null);

  const isMounted = useIsMounted();

  function audioElementPlay(url: string): void {
    assert(audioElement.current !== null);
    audioElement.current.src = url;
    void audioElement.current.play();
  }

  function audioElementStop(): void {
    assert(audioElement.current !== null);
    audioElement.current.pause();
    audioElement.current.src = "";
    audioElement.current.currentTime = 0;
  }

  const playAudio = React.useCallback(
    (audioIdentifier: TAudioIdentifier) => {
      if (audioElement.current === null
        || (playingAudioIdentifierRef.current !== null && getKey(audioIdentifier) === getKey(playingAudioIdentifierRef.current))) {
        return;
      }

      audioElementStop();

      const key = getKey(audioIdentifier);
      const audioState = audioStatesRef.current.get(key);
      switch (audioState) {
      case undefined:
        setPlayingAudioIdentifier(audioIdentifier);
        setAudioStates(new Map([...audioStatesRef.current.entries(), [key, "Generating"]]));
        generateAudioUrl(audioIdentifier)
          .then(
            (url) => {
              if (!isMounted.current) {
                return;
              }

              const newAudioStates = new Map([...audioStatesRef.current.entries()]);
              newAudioStates.set(key, "Ready");
              setAudioStates(newAudioStates);

              audioUrls.current.set(key, url);
              audioElementPlay(url);
            })
          .catch(
            (error: unknown) => {
              console.log(error);
              if (!isMounted.current) {
                return;
              }

              const newAudioStates = new Map([...audioStatesRef.current.entries()]);
              newAudioStates.set(key, "Error");
              setAudioStates(newAudioStates);
              if (playingAudioIdentifierRef.current !== null && key === getKey(playingAudioIdentifierRef.current)) {
                setPlayingAudioIdentifier(null);
              }
            });
        break;

      case "Generating":
        // We'll play automatically once we're done generating
        setPlayingAudioIdentifier(audioIdentifier);
        break;

      case "Ready":
        {
          setPlayingAudioIdentifier(audioIdentifier);
          const url = audioUrls.current.get(key);
          assert(url !== undefined);
          audioElementPlay(url);
        }
        break;

      case "Error":
        // Nothing to do - audio generation previously failed
        break;
      }
    },
    []);

  const stopAudio = React.useCallback(
    (audioIdentifier?: TAudioIdentifier) => {
      if (audioIdentifier === undefined || audioIdentifier === playingAudioIdentifierRef.current) {
        setPlayingAudioIdentifier(null);
        audioElementStop();
      }
    },
    []);

  React.useEffect(
    () => {
      audioElement.current = new Audio();
      audioElement.current.addEventListener(
        "ended",
        () => {
          setPlayingAudioIdentifier(null);
          audioElementStop();
        });

      return () => {
        assert(audioElement.current !== null);
        audioElementStop();
        audioElement.current = null;
      };
    },
    []);

  return { playAudio, stopAudio, audioStates: audioStatesState, playingAudioIdentifier: playingAudioIdentifierState };
}