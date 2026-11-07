/**
 * 떠 있는 "이끼" 버튼과 키 (REQ-103, ADR-0124): 오른쪽 아래에 조용히 있다가, 처음 온 사람에게만 한 번 "처음이세요? 같이 만들어요"라고
 * 말한다(이 브라우저에 기억, 읽기·쓰기는 try/catch). 그 뒤로는 누가 누를 때까지 아무 말도 하지 않는다. 기본 모델이 없으면 이끼는 꺼져 있어요(ADR-0125):
 * 설정으로 가는 작은 알약만 남고 패널·키·물음표·인사는 모두 없다.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { hasDefaultModel, MODELS_CHANGED, MODELS_HASH, MOSS_SLEEP_LINE } from "../../logic";
import {
  openMoss,
  panelState,
  setAwake,
  subscribe,
  useMossScreen,
  watchBottomBars,
} from "../../moss";
import { useApp, useAsync } from "../context";
import { MossPanel } from "./Panel";

const SEEN_KEY = "terrarium.moss.seen";

/** 이 브라우저에서 이미 말했는가. 저장소를 못 쓰면 "이미 말했다"로 쳐서 말을 걸지 않는다. */
function alreadySaid(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) !== null;
  } catch {
    return true;
  }
}

function markSaid(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Without storage the hint is never shown, so there is nothing to remember.
  }
}

const EDITABLE = /^(input|textarea|select)$/i;

function useOpenKeys(awake: boolean): void {
  useEffect(() => {
    if (!awake) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = Boolean(el && (EDITABLE.test(el.tagName) || el.isContentEditable));
      const cmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (cmdK || (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey)) {
        e.preventDefault();
        openMoss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [awake]);
}

/** 기본 모델이 있는가. 설정에서 모델을 더하거나 바꾸면 알려 줘서 다시 읽는다. */
export function useAwake(): boolean {
  const { api, page } = useApp();
  const [tick, setTick] = useState(0);
  const list = useAsync(
    (signal) => api.call("listModels", { signal }),
    [tick, page.name === "settings"],
  );
  useEffect(() => {
    const again = () => setTick((n) => n + 1);
    window.addEventListener(MODELS_CHANGED, again);
    return () => window.removeEventListener(MODELS_CHANGED, again);
  }, []);
  const awake = hasDefaultModel(list.data);
  // 이끼의 나머지(물음표, 열기)가 읽는 곳에 알린다
  useEffect(() => {
    setAwake(awake);
    return () => setAwake(false);
  }, [awake]);
  return awake;
}

/** 알약을 누르면 설정의 모델 구역으로: 화면이 그려질 때까지 몇 번 기다렸다가 그 구역으로 스크롤해요. */
function showModels(): void {
  try {
    window.history.replaceState(null, "", `/settings${MODELS_HASH}`);
  } catch {
    // The address stays /settings; the section is still on that screen.
  }
  let tries = 0;
  const look = () => {
    const el = document.getElementById(MODELS_HASH.slice(1));
    if (el) el.scrollIntoView({ block: "start" });
    else if (++tries < 10) setTimeout(look, 100);
  };
  look();
}

function SleepPill() {
  const { navigate } = useApp();
  return (
    <a
      href={`/settings${MODELS_HASH}`}
      className="moss-sleep"
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate({ name: "settings" });
        setTimeout(showModels, 0);
      }}
    >
      {MOSS_SLEEP_LINE}
    </a>
  );
}

export function usePanelState() {
  return useSyncExternalStore(subscribe, panelState);
}

export function MossHost() {
  const { page } = useApp();
  const awake = useAwake();
  const panel = usePanelState();
  // 어느 화면이든 이끼가 최소한 "지금 어느 화면의 어떤 주소인가"는 읽게 한다 (화면이 더 읽어 주면 합쳐져요)
  useMossScreen(page.name, { read: () => ({ 주소: { ...page } }), run: {} });
  const [hint, setHint] = useState(() => !alreadySaid());
  // 인사는 깨어 있을 때만 하고, 말한 것으로 적는 것도 그때만: 모델을 등록한 뒤 처음 만났을 때 한 번 말해요
  useEffect(() => {
    if (hint && awake) markSaid();
  }, [hint, awake]);
  useEffect(() => {
    if (panel.open) setHint(false);
  }, [panel.open]);
  useOpenKeys(awake);
  // 아래 막대가 있는 화면에서는 버튼이 막대 위로 올라가요 (REQ-104)
  useEffect(() => watchBottomBars(), []);
  const high = page.name === "world" || page.name === "scenario";
  return (
    <>
      {awake && panel.open && <MossPanel focusSeq={panel.focusSeq} />}
      {!(awake && panel.open) && (
        <div className={`moss-launch${high ? " high" : ""}`}>
          {!awake ? (
            <SleepPill />
          ) : (
            <>
              {hint && <span className="moss-hint">처음이세요? 같이 만들어요</span>}
              <button
                type="button"
                className="moss-btn"
                onClick={() => openMoss()}
                aria-label="이끼 열기"
                title="이끼 (/ 또는 Cmd+K)"
              >
                이끼
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
