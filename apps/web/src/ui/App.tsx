/**
 * The app shell: the navigation rail, the page for the current address, toasts, and asking people
 * their name once when no SSO proxy says who they are (ADR-0028).
 */
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Api,
  hrefOf,
  type Identity,
  nameProblem,
  type Page,
  parseLocation,
  SECTIONS,
  sectionOf,
  titleOf,
} from "../logic";
import { AppContext, type AppServices, Go, type ToastTone, useAsync } from "./context";
import { Icon, Mark } from "./icons";
import { Button, Dialog, Loading, TextField } from "./kit";
import { BenchmarksPage } from "./pages/benchmarks";
import { ExperimentPage } from "./pages/experiment";
import { ExperimentsPage } from "./pages/experiments";
import { HomePage } from "./pages/home";
import { NewExperimentPage } from "./pages/new-experiment";
import { RunPage } from "./pages/run";
import { ScenariosPage } from "./pages/scenarios";
import { WorldsPage } from "./pages/worlds";

// The 3D builder and the flow editor bring three.js and React Flow; they load when opened (REQ-036).
const WorldBuilderPage = lazy(() => import("./builder/WorldBuilderPage"));
const ScenarioEditorPage = lazy(() => import("./scenario/ScenarioEditorPage"));

const ICONS: Readonly<Record<string, string>> = {
  home: "home",
  worlds: "world",
  scenarios: "scenario",
  experiments: "experiment",
  benchmarks: "benchmark",
};

function pageView(page: Page): ReactNode {
  switch (page.name) {
    case "home":
      return <HomePage />;
    case "worlds":
      return <WorldsPage />;
    case "world":
      return <WorldBuilderPage id={page.id} />;
    case "scenarios":
      return <ScenariosPage />;
    case "scenario":
      return <ScenarioEditorPage id={page.id} />;
    case "experiments":
      return <ExperimentsPage />;
    case "newExperiment":
      return <NewExperimentPage />;
    case "experiment":
      return <ExperimentPage id={page.id} />;
    case "run":
      return <RunPage id={page.id} />;
    case "benchmarks":
      return <BenchmarksPage />;
    case "notFound":
      return <NotFound path={page.path} />;
  }
}

function NotFound({ path }: { readonly path: string }) {
  return (
    <div className="page">
      <h1>없는 화면이다</h1>
      <p className="lede" style={{ margin: "10px 0 20px" }}>
        <code>{path}</code>에 해당하는 화면이 없다. 주소가 바뀌었거나 지워진 것일 수 있다.
      </p>
      <Go to={{ name: "home" }}>홈으로 간다</Go>
    </div>
  );
}

function NameDialog({
  identity,
  onDone,
}: {
  readonly identity: Identity;
  readonly onDone: () => void;
}) {
  const [name, setName] = useState(identity.name ?? "");
  const [error, setError] = useState<string>();
  const save = () => {
    const problem = nameProblem(name);
    if (problem) return setError(problem);
    identity.set(name);
    onDone();
  };
  return (
    <Dialog
      title="누구인지 알려 준다"
      onClose={onDone}
      actions={
        <>
          <Button kind="quiet" onClick={onDone}>
            나중에
          </Button>
          <Button kind="primary" onClick={save}>
            이 이름 쓰기
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <TextField
          label="이름"
          value={name}
          onChange={(v) => {
            setName(v);
            setError(undefined);
          }}
          error={error}
          help="실험과 세계에 만든 사람으로 남고, 벤치마크에 함께 보인다. 이 브라우저에 기억해 둔다."
          maxLength={40}
          autoFocus
        />
      </form>
    </Dialog>
  );
}

interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
}

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const toast = useCallback((message: string, tone: ToastTone = "plain") => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "bad" ? 7000 : 4000);
  }, []);
  return { toasts, toast };
}

/** The address bar is the state: pages come from it, and going somewhere asks first when work is unsaved. */
function useNavigation() {
  const [page, setPage] = useState<Page>(() => parseLocation(location.pathname, location.search));
  const leaveGuard = useRef<(() => string | undefined) | undefined>(undefined);
  const setLeaveGuard = useCallback((guard: (() => string | undefined) | undefined) => {
    leaveGuard.current = guard;
  }, []);
  useEffect(() => {
    const back = () => setPage(parseLocation(location.pathname, location.search));
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  useEffect(() => {
    document.title = titleOf(page);
  }, [page]);
  const navigate = useCallback((next: Page, options: { replace?: boolean } = {}) => {
    const question = leaveGuard.current?.();
    if (question && !window.confirm(question)) return;
    leaveGuard.current = undefined;
    const href = hrefOf(next);
    if (options.replace) history.replaceState(null, "", href);
    else history.pushState(null, "", href);
    setPage(next);
    document.querySelector(".main")?.scrollTo({ top: 0 });
  }, []);
  return { page, navigate, setLeaveGuard };
}

function Rail({
  page,
  me,
  proxied,
  onName,
}: {
  readonly page: Page;
  readonly me?: string;
  readonly proxied: boolean;
  readonly onName: () => void;
}) {
  const section = sectionOf(page);
  return (
    <nav className="rail" aria-label="주 메뉴">
      <div className="rail-mark" title="테라리움">
        <Mark />
      </div>
      {SECTIONS.map((s) => (
        <Go
          key={s.key}
          to={s.page}
          className="rail-link"
          aria-current={section === s.key ? "page" : undefined}
        >
          <Icon name={ICONS[s.key] as string} size={22} />
          {s.label}
        </Go>
      ))}
      <div className="rail-spacer" />
      <button
        type="button"
        className="rail-user"
        onClick={onName}
        disabled={proxied}
        title={proxied ? "회사 로그인으로 확인된 이름" : "이름 바꾸기"}
      >
        {me ?? "이름 정하기"}
      </button>
    </nav>
  );
}

function Toasts({ toasts }: { readonly toasts: readonly Toast[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast${t.tone === "bad" ? " toast-bad" : ""}`}
          role={t.tone === "bad" ? "alert" : "status"}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

export function App({ api, identity }: { readonly api: Api; readonly identity: Identity }) {
  const { page, navigate, setLeaveGuard } = useNavigation();
  const mainId = useId();
  const { toasts, toast } = useToasts();
  const [asking, setAsking] = useState(false);
  const [, setNameVersion] = useState(0);
  const meta = useAsync((signal) => api.call("meta", { signal }), []);
  useEffect(() => {
    if (meta.data?.user.source === "anonymous" && !identity.name) setAsking(true);
  }, [meta.data, identity]);

  const proxied = meta.data?.user.source === "proxy";
  const me = proxied ? meta.data?.user.name : identity.name;
  const services: AppServices = useMemo(
    () => ({
      api,
      identity,
      page,
      navigate,
      ...(meta.data ? { meta: meta.data } : {}),
      reloadMeta: meta.reload,
      toast,
      ...(me ? { me } : {}),
      askName: () => setAsking(true),
      setLeaveGuard,
    }),
    [api, identity, page, navigate, meta.data, meta.reload, toast, me, setLeaveGuard],
  );
  return (
    <AppContext.Provider value={services}>
      <a className="skip-link" href={`#${mainId}`}>
        본문으로 건너뛰기
      </a>
      <div className="shell">
        <Rail
          page={page}
          {...(me ? { me } : {})}
          proxied={proxied}
          onName={() => !proxied && setAsking(true)}
        />
        <main className="main" id={mainId} tabIndex={-1}>
          <Suspense
            fallback={
              <div className="page">
                <Loading />
              </div>
            }
          >
            {pageView(page)}
          </Suspense>
        </main>
      </div>
      <Toasts toasts={toasts} />
      {asking && (
        <NameDialog
          identity={identity}
          onDone={() => {
            setAsking(false);
            setNameVersion((v) => v + 1);
          }}
        />
      )}
    </AppContext.Provider>
  );
}
