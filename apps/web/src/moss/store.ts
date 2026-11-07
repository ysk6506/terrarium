/**
 * 이끼가 화면과 주고받는 곳 (REQ-103, ADR-0124): 지금 떠 있는 화면이 붙여 둔 읽기·핸들러, 그리고 옆 패널이 열렸는지와
 * 미리 채운 질문. React 밖의 작은 저장소라 `MossAsk`(어느 화면에나 있다)와 패널(앱 바깥 껍질)이 서로를 몰라도 돼요.
 */
import type { PageName } from "../logic";
import type { ScreenBinding } from "./types";

type Listener = () => void;

/** 한 라우트에 여러 조각이 붙을 수 있다: 페이지는 읽기를, 안쪽 컴포넌트는 자기 동작을 더한다. */
const bindings = new Map<PageName, Set<ScreenBinding>>();
const listeners = new Set<Listener>();

export interface PanelState {
  readonly open: boolean;
  /** 열 때 채워 둔 질문. `send`이면 바로 물어요(모델이 있을 때). `seq`는 같은 질문을 또 눌러도 새 요청으로 알아보게 해요. */
  readonly pending?: { readonly seq: number; readonly question: string; readonly send: boolean };
  /** 입력칸에 초점을 달라는 요청이 몇 번 왔는가 (Cmd+K, `/`). */
  readonly focusSeq: number;
}

let panel: PanelState = { open: false, focusSeq: 0 };
let seq = 0;

const emit = () => {
  for (const l of [...listeners]) l();
};

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** 화면이 켜지면 붙이고, 꺼지면 떼는 함수를 돌려줘요. */
export function bindScreen(route: PageName, binding: ScreenBinding): () => void {
  const set = bindings.get(route) ?? new Set<ScreenBinding>();
  set.add(binding);
  bindings.set(route, set);
  emit();
  return () => {
    set.delete(binding);
    if (set.size === 0) bindings.delete(route);
    emit();
  };
}

const all = (): ScreenBinding[] => [...bindings.values()].flatMap((s) => [...s]);

/** 동작 id를 아는 화면의 핸들러. 아이디는 등록부 전체에서 하나라서 어느 화면 것인지 따로 묻지 않아요. */
export function findHandler(id: string): ScreenBinding["run"][string] | undefined {
  return all().find((b) => b.run[id])?.run[id];
}

export function summaryFor(id: string): string | undefined {
  return all()
    .find((b) => b.run[id])
    ?.summary?.(id);
}

/** 핸들러가 붙을 때까지 기다린다: 화면을 옮긴 직후 그 화면의 동작을 쓸 때. */
export function waitForHandler(
  id: string,
  ms = 4000,
): Promise<ScreenBinding["run"][string] | undefined> {
  const now = findHandler(id);
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = (h: ScreenBinding["run"][string] | undefined) => {
      off();
      clearTimeout(timer);
      resolve(h);
    };
    const off = subscribe(() => {
      const h = findHandler(id);
      if (h) done(h);
    });
    const timer = setTimeout(() => done(undefined), ms);
  });
}

/** 라우트의 읽기: 읽기를 가진 조각들이 읽은 객체를 합쳐요(페이지는 본문을, 안쪽 컴포넌트는 자기 구역을). */
export function readScreen(route: PageName): unknown {
  const parts = [...(bindings.get(route) ?? [])].flatMap((b) => (b.read ? [b.read()] : []));
  const objects = parts.filter(
    (p): p is object => typeof p === "object" && p !== null && !Array.isArray(p),
  );
  return objects.length > 1 ? Object.assign({}, ...objects) : (parts[0] ?? {});
}

export const panelState = (): PanelState => panel;

function set(next: PanelState): void {
  panel = next;
  emit();
}

/** 패널을 연다. 질문을 주면 입력칸에 채우고, `send`면 바로 보내요. */
export function openMoss(options: { question?: string; send?: boolean } = {}): void {
  set({
    open: true,
    focusSeq: panel.focusSeq + (options.question ? 0 : 1),
    ...(options.question
      ? { pending: { seq: ++seq, question: options.question, send: options.send ?? false } }
      : {}),
  });
}

export function closeMoss(): void {
  set({ open: false, focusSeq: panel.focusSeq });
}

export function consumePending(): void {
  const { pending: _gone, ...rest } = panel;
  panel = rest;
}
