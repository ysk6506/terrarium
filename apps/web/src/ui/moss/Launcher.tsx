/**
 * 떠 있는 "이끼" 버튼과 키 (REQ-103, ADR-0124): 오른쪽 아래에 조용히 있다가, 처음 온 사람에게만 한 번 "처음이세요? 같이 만들어요"라고
 * 말한다(이 브라우저에 기억, 읽기·쓰기는 try/catch). 그 뒤로는 누가 누를 때까지 아무 말도 하지 않는다. 모델이 없으면 설정으로 가는 글이에요.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { openMoss, panelState, subscribe, useMossScreen } from "../../moss";
import { Go, useApp, useAsync } from "../context";
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

function useOpenKeys(): void {
  useEffect(() => {
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
  }, []);
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
    window.addEventListener("terrarium:models-changed", again);
    return () => window.removeEventListener("terrarium:models-changed", again);
  }, []);
  return (list.data ?? []).some((m) => m.isDefault);
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
  useEffect(() => {
    if (hint) markSaid();
  }, [hint]);
  useEffect(() => {
    if (panel.open) setHint(false);
  }, [panel.open]);
  useOpenKeys();
  const high = page.name === "world" || page.name === "scenario";
  return (
    <>
      {panel.open && <MossPanel awake={awake} focusSeq={panel.focusSeq} />}
      {!panel.open && (
        <div className={`moss-launch${high ? " high" : ""}`}>
          {!awake ? (
            <Go to={{ name: "settings" }} className="moss-sleep">
              모델을 등록하면 이끼가 깨어나요
            </Go>
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
