/**
 * What every screen shares: the API, who is looking, where we are, toasts, and the server's state.
 * Screens read it with useApp(); links go through <Go> so the address bar always tells the truth.
 */
import type { MetaView } from "@terrarium/core/contract";
import {
  type AnchorHTMLAttributes,
  createContext,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { type Api, type ApiError, hrefOf, type Identity, type Page } from "../logic";

export type ToastTone = "plain" | "bad";

export interface AppServices {
  readonly api: Api;
  readonly identity: Identity;
  readonly page: Page;
  navigate(page: Page, options?: { replace?: boolean }): void;
  readonly meta?: MetaView;
  reloadMeta(): void;
  toast(message: string, tone?: ToastTone): void;
  /** The viewer's name, as the server knows it. */
  readonly me?: string;
  askName(): void;
  /** While set, leaving the page asks first (unsaved work); returns the question to ask. */
  setLeaveGuard(guard: (() => string | undefined) | undefined): void;
}

export const AppContext = createContext<AppServices | null>(null);

export function useApp(): AppServices {
  const app = useContext(AppContext);
  if (!app) throw new Error("useApp outside <App>");
  return app;
}

export interface Async<T> {
  readonly data?: T;
  readonly error?: ApiError | Error;
  readonly loading: boolean;
  reload(): void;
  set(value: T): void;
}

/** Load something when the inputs change; cancels the old request, keeps the last data while reloading. */
export function useAsync<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): Async<T> {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({
    loading: true,
  });
  const [tick, setTick] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are the caller's inputs
  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    loader.current(controller.signal).then(
      (data) => !controller.signal.aborted && setState({ data, loading: false }),
      (error: Error) =>
        !controller.signal.aborted &&
        error.name !== "AbortError" &&
        setState((s) => ({ ...s, error, loading: false })),
    );
    return () => controller.abort();
  }, [...deps, tick]);
  return {
    ...state,
    reload: useCallback(() => setTick((t) => t + 1), []),
    set: useCallback((data: T) => setState({ data, loading: false }), []),
  };
}

/** The current time, ticking every `ms`, for "3분 전" labels. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

type GoProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  readonly to: Page;
  readonly children: ReactNode;
};

/** A link to a screen: a real href (open in a new tab works), navigated in place on a plain click. */
export function Go({ to, children, onClick, ...rest }: GoProps) {
  const { navigate } = useApp();
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={hrefOf(to)} onClick={click} {...rest}>
      {children}
    </a>
  );
}

/** Ask before leaving while `message` is set: other screens, reloads and closing the tab. */
export function useLeaveGuard(message: string | undefined): void {
  const { setLeaveGuard } = useApp();
  useEffect(() => {
    if (!message) return;
    setLeaveGuard(() => message);
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      setLeaveGuard(undefined);
      window.removeEventListener("beforeunload", unload);
    };
  }, [message, setLeaveGuard]);
}

/** A message for an error, whatever threw it. */
export const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Run an action, toast its failure, and say whether it worked. */
export function useAction() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(action: () => Promise<T>, done?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const result = await action();
        if (done) toast(done);
        return result;
      } catch (err) {
        toast(messageOf(err), "bad");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, run };
}
