/** 화면이 이끼에게 자신을 등록하는 훅 (REQ-103, ADR-0124). */
import { useEffect, useRef } from "react";
import type { PageName } from "../logic";
import { bindScreen } from "./store";
import type { ScreenBinding } from "./types";

/**
 * 이 화면의 읽기와 동작 핸들러를 이끼에게 붙인다. 핸들러는 버튼이 쓰는 것과 같은 함수를 넘겨요.
 * 렌더마다 새로 만든 클로저를 넘겨도 되고, 이끼는 늘 가장 최근 것을 불러요.
 */
export function useMossScreen(route: PageName, binding: ScreenBinding): void {
  const latest = useRef(binding);
  latest.current = binding;
  const ids = Object.keys(binding.run).sort().join(",");
  useEffect(() => {
    const run: Record<string, ScreenBinding["run"][string]> = {};
    for (const id of ids === "" ? [] : ids.split(","))
      run[id] = (args) => latest.current.run[id]?.(args);
    return bindScreen(route, {
      ...(latest.current.read ? { read: () => latest.current.read?.() } : {}),
      run,
      summary: (id) => latest.current.summary?.(id),
    });
  }, [route, ids]);
}

/** 안쪽 컴포넌트가 자기 몫의 동작 핸들러만 더할 때 (읽기는 페이지가 맡아요). */
export function useMossActions(route: PageName, run: ScreenBinding["run"]): void {
  useMossScreen(route, { run });
}

/** 읽기만 붙이는 화면(목록 같은): 동작은 어디서나 쓰는 것뿐이에요. */
export function useMossRead(route: PageName, read: () => unknown): void {
  useMossScreen(route, { read, run: {} });
}
