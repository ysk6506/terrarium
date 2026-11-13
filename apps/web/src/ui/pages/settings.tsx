/**
 * Settings: choices that belong to this browser, one row each (`SETTING_DEFS`). A choice is saved the moment
 * it is made. The graphics row is read when a 3D view opens, so it takes hold the next time one does.
 */
import { useState } from "react";
import {
  isAdmin,
  readSettings,
  SETTING_DEFS,
  type SettingDef,
  type Settings,
  saveSetting,
  type ThemeChoice,
} from "../../logic";
import { MossAsk, settingsState, termQuestion, useMossScreen } from "../../moss";
import { applyTheme, browserStore } from "../browser-store";
import { Go, useApp } from "../context";
import { PageHead, Section, Segmented } from "../kit";
import { ModelSection } from "./model-section";

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
        <b className="setting-term">
          <MossAsk question={termQuestion(def.label)}>{def.label}</MossAsk>
        </b>
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

const THEME_WORDS: Readonly<Record<string, ThemeChoice>> = {
  다크: "dark",
  어둡: "dark",
  라이트: "light",
  밝: "light",
  시스템: "system",
  컴퓨터: "system",
};

/** Where what was done is read: the whole log for an administrator, a person's own things for everyone else. */
function RecordSection() {
  const { meta } = useApp();
  const admin = isAdmin(meta);
  return (
    <Section title={admin ? "감사 기록" : "내 것에 있던 일"}>
      <div className="setting-row">
        <div className="setting-text">
          <p className="small muted">
            {admin
              ? "누가 무엇을 했는지, 무엇이 막혔는지 읽고 파일로 받아요. 고치거나 지울 수 없어요."
              : "내가 만든 것에 누가 언제 무엇을 했는지 읽어요."}
          </p>
        </div>
        <Go to={{ name: "audit" }} className="btn">
          {admin ? "감사 기록 열기" : "내 것에 있던 일 열기"}
        </Go>
      </div>
    </Section>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState(() => readSettings(browserStore()));
  const choose = (def: SettingDef, value: Settings[keyof Settings]) => {
    const saved = saveSetting(browserStore(), def.key, value as never);
    setSettings(saved);
    if (def.key === "theme") applyTheme(saved.theme);
  };
  useMossScreen("settings", {
    read: () =>
      settingsState({ 그래픽: settings.graphics, 소리: settings.sound, 화면_색: settings.theme }),
    run: {
      // 이끼의 "화면 색 바꾸기": 화면 색 버튼과 같은 `choose` (REQ-103)
      "settings-theme": (a) => {
        const text = String(a.text ?? "");
        const word = Object.keys(THEME_WORDS).find((w) => text.includes(w));
        const next = word ? THEME_WORDS[word] : settings.theme === "dark" ? "light" : "dark";
        const def = SETTING_DEFS.find((d) => d.key === "theme");
        if (!def || !next) throw new Error("바꿀 화면 색이 없어요");
        choose(def, next);
        return `화면 색을 ${def.options.find((o) => o.value === next)?.label ?? next}(으)로 바꿨어요`;
      },
    },
  });
  return (
    <div className="page">
      <PageHead title="설정" lede="화면 설정은 이 브라우저에만 저장돼요. 모델은 서버에 저장돼요." />
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
      <RecordSection />
      <ModelSection />
    </div>
  );
}
