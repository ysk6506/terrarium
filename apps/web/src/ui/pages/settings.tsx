/**
 * Settings: choices that belong to this browser, one row each (`SETTING_DEFS`). A choice is saved the moment
 * it is made. The graphics row is read when a 3D view opens, so it takes hold the next time one does.
 */
import { useState } from "react";
import {
  readSettings,
  SETTING_DEFS,
  type SettingDef,
  type Settings,
  saveSetting,
} from "../../logic";
import { browserStore } from "../browser-store";
import { PageHead, Section, Segmented } from "../kit";

function Row({
  def,
  settings,
  onChoose,
}: {
  readonly def: SettingDef;
  readonly settings: Settings;
  readonly onChoose: (value: Settings[keyof Settings]) => void;
}) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <b>{def.label}</b>
        <p className="small muted">{def.help}</p>
      </div>
      <Segmented
        label={def.label}
        value={settings[def.key]}
        options={def.options}
        onChange={onChoose}
      />
    </div>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState(() => readSettings(browserStore()));
  const choose = (def: SettingDef, value: Settings[keyof Settings]) =>
    setSettings(saveSetting(browserStore(), def.key, value as never));
  return (
    <div className="page">
      <PageHead title="설정" lede="이 브라우저에만 저장돼요. 고르면 바로 기억해요." />
      <Section title="화면">
        <div className="stack">
          {SETTING_DEFS.map((def) => (
            <Row
              key={def.key}
              def={def}
              settings={settings}
              onChoose={(value) => choose(def, value)}
            />
          ))}
        </div>
      </Section>
    </div>
  );
}
