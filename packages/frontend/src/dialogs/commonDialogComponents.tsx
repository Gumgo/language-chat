import { Model, modelValues } from "api";
import { Checkbox } from "components/checkbox";
import { NumberInput } from "components/numberInput";
import { Select } from "components/select";
import { TextInput } from "components/textInput";
import * as React from "react";

const speechSpeedValues = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface DialogSettingsGridProps {
}

export function DialogSettingsGrid(props: React.PropsWithChildren<DialogSettingsGridProps>): React.JSX.Element {
  return (
    <div className="dialog-settings-grid">
      {props.children}
    </div>
  );
}

interface ModelSelectProps {
  model: Model;
  setModel: (model: Model) => void;
}

export function ModelSelect(props: ModelSelectProps): React.JSX.Element {
  return (
    <>
      <div className="label">Model</div>
      <Select value={props.model} onChange={(e) => props.setModel(e.target.value as Model)}>
        {modelValues.map((v) => <option key={v} value={v}>{v}</option>)}
      </Select>
    </>
  );
}

interface SpeechSpeedSelectProps {
  speechSpeed: number;
  setSpeechSpeed: (speechSpeed: number) => void;
}

export function SpeechSpeedSelect(props: SpeechSpeedSelectProps): React.JSX.Element {
  return (
    <>
      <div className="label">Speech speed</div>
      <Select value={props.speechSpeed} onChange={(e) => props.setSpeechSpeed(parseInt(e.target.value))}>
        {speechSpeedValues.map((v) => <option key={v} value={v}>{`${v}%`}</option>)}
      </Select>
    </>
  );
}

interface WordsQueryProps {
  title: string;
  wordsQuery: string;
  setWordsQuery: (wordsQuery: string) => void;
  resultCount: number;
}

export function WordsQuery(props: WordsQueryProps): React.JSX.Element {
  return (
    <>
      <div className="label">{props.title}</div>
      { /* eslint-disable-next-line react/jsx-handler-names */ }
      <TextInput value={props.wordsQuery} onChangeValue={props.setWordsQuery} />
      <div />
      <div>{props.resultCount} {props.resultCount === 1 ? "result" : "results"}</div>
    </>
  );
}

interface CheckboxDialogSettingProps {
  title: string;
  value: boolean;
  setValue: (value: boolean) => void;
}

export function CheckboxDialogSetting(props: CheckboxDialogSettingProps): React.JSX.Element {
  return (
    <>
      <div />
      <label>
        { /* eslint-disable-next-line react/jsx-handler-names */ }
        <Checkbox checked={props.value} onChange={props.setValue} />
        {props.title}
      </label>
    </>
  );
}

interface NumberSelectDialogSettingProps {
  title: string;
  values: number[];
  suffixes: [string, string]; // Non-plural and plural
  value: number;
  setValue: (value: number) => void;
}

export function NumberSelectDialogSetting(props: NumberSelectDialogSettingProps): React.JSX.Element {
  return (
    <>
      <div className="label">{props.title}</div>
      <Select value={props.value} onChange={(e) => props.setValue(parseFloat(e.target.value))}>
        {props.values.map((v) => <option key={v} value={v}>{v} {v === 1 ? props.suffixes[0] : props.suffixes[1]}</option>)}
      </Select>
    </>
  );
}

interface IntegerDialogSettingProps {
  title: string;
  min: number;
  max: number;
  value: number;
  setValue: (value: number) => void;
}

export function IntegerDialogSetting(props: IntegerDialogSettingProps): React.JSX.Element {
  return (
    <>
      <div className="label">{props.title}</div>
      { /* eslint-disable-next-line react/jsx-handler-names */ }
      <NumberInput min={props.min} max={props.max} value={props.value} onChangeValue={props.setValue} />
    </>
  );
}

interface EnumDialogSettingProps<T> {
  title: string;
  values: T[];
  value: T;
  setValue: (value: T) => void;
}

export function EnumDialogSetting<T>(props: EnumDialogSettingProps<T>): React.JSX.Element {
  return (
    <>
      <div className="label">{props.title}</div>
      <Select value={props.value as string} onChange={(e) => props.setValue(e.target.value as T)}>
        {props.values.map((v) => <option key={v as string} value={v as string}>{v as string}</option>)}
      </Select>
    </>
  );
}