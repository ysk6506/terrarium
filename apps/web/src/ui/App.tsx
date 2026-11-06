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
  expiringNotice,
  hrefOf,
  type Identity,
  nameProblem,
  type Page,
  parseLocation,
  SECTIONS,
  SETTINGS_SECTION,
  sectionOf,
  titleOf,
  world3d,
} from "../logic";
import { AppContext, type AppServices, Go, type ToastTone, useApp, useAsync } from "./context";
import { Icon, Mark } from "./icons";
import { Button, Dialog, Loading, Note, TextField } from "./kit";
import { ExperimentsPage } from "./pages/experiments";
import { HomePage } from "./pages/home";
import { ScenariosPage } from "./pages/scenarios";
import { WorldsPage } from "./pages/worlds";

// The 3D builder and the flow editor bring three.js and React Flow; they load when opened (REQ-036).
const WorldBuilderPage = lazy(() => import("./builder/WorldBuilderPage"));
const ScenarioEditorPage = lazy(() => import("./scenario/ScenarioEditorPage"));

// Screens the first visit does not need come down when opened: the home page is the budgeted one (700 kB).
const AgentVersionsPage = lazy(() =>
  import("./pages/agent-versions").then((m) => ({ default: m.AgentVersionsPage })),
);
const OperationGuidePage = lazy(() =>
  import("./pages/operation-guide").then((m) => ({ default: m.OperationGuidePage })),
);
const BenchmarksPage = lazy(() =>
  import("./pages/benchmarks").then((m) => ({ default: m.BenchmarksPage })),
);
const ConnectionsPage = lazy(() =>
  import("./pages/connections").then((m) => ({ default: m.ConnectionsPage })),
);
const ExperimentPage = lazy(() =>
  import("./pages/experiment").then((m) => ({ default: m.ExperimentPage })),
);
const NewExperimentPage = lazy(() =>
  import("./pages/new-experiment").then((m) => ({ default: m.NewExperimentPage })),
);
const RunPage = lazy(() => import("./pages/run").then((m) => ({ default: m.RunPage })));
const SettingsPage = lazy(() =>
  import("./pages/settings").then((m) => ({ default: m.SettingsPage })),
);

const ICONS: Readonly<Record<string, string>> = {
  home: "home",
  worlds: "world",
  scenarios: "scenario",
  experiments: "experiment",
  benchmarks: "benchmark",
  connections: "plug",
  settings: "gear",
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
    default:
      return otherView(page);
  }
}

/** The rest of the screens: benchmarks, connections, and an address that is nothing. */
function otherView(
  page: Extract<
    Page,
    {
      name:
        | "benchmarks"
        | "connections"
        | "agentVersions"
        | "operationGuide"
        | "settings"
        | "notFound";
    }
  >,
): ReactNode {
  switch (page.name) {
    case "benchmarks":
      return <BenchmarksPage />;
    case "connections":
      return <ConnectionsPage />;
    case "agentVersions":
      return <AgentVersionsPage connectionId={page.connectionId} agentId={page.agentId} />;
    case "operationGuide":
      return <OperationGuidePage />;
    case "settings":
      return <SettingsPage />;
    case "notFound":
      return <NotFound path={page.path} />;
  }
}

/** Connections of the viewer's that will be removed soon for lack of use, on every page (REQ-051). */
function ExpiryBanner() {
  const { meta, page } = useApp();
  const text = expiringNotice(meta?.expiring);
  if (!text || page.name === "world" || page.name === "scenario") return null;
  return (
    <div className="expiry-banner">
      <Note tone="warn">
        {text}
        {page.name !== "connections" && (
          <>
            {" — "}
            <Go to={{ name: "connections" }}>연결 화면으로 가기</Go>
          </>
        )}
      </Note>
    </div>
  );
}

function NotFound({ path }: { readonly path: string }) {
  return (
    <div className="page">
      <h1>없는 화면이에요</h1>
      <p className="lede" style={{ margin: "10px 0 20px" }}>
        <code>{path}</code>에 해당하는 화면이 없어요. 주소가 바뀌었거나 지워졌을 수 있어요.
      </p>
      <Go to={{ name: "home" }}>홈으로 가기</Go>
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
      title="누구인지 알려 주세요"
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
          help="실험과 세계에 만든 사람으로 남고, 벤치마크에 함께 보여요. 이 브라우저에 기억해 둬요."
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
  const [detail, setDetail] = useState<string>();
  const leaveGuard = useRef<(() => string | undefined) | undefined>(undefined);
  const setLeaveGuard = useCallback((guard: (() => string | undefined) | undefined) => {
    leaveGuard.current = guard;
  }, []);
  useEffect(() => {
    const back = () => {
      setDetail(undefined);
      setPage(parseLocation(location.pathname, location.search));
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  useEffect(() => {
    document.title = titleOf(page, detail);
  }, [page, detail]);
  const navigate = useCallback((next: Page, options: { replace?: boolean } = {}) => {
    const question = leaveGuard.current?.();
    if (question && !window.confirm(question)) return;
    leaveGuard.current = undefined;
    const href = hrefOf(next);
    if (options.replace) history.replaceState(null, "", href);
    else history.pushState(null, "", href);
    setDetail(undefined);
    setPage(next);
    document.querySelector(".main")?.scrollTo({ top: 0 });
  }, []);
  return { page, navigate, setLeaveGuard, setTitle: setDetail };
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
      <Go
        to={SETTINGS_SECTION.page}
        className="rail-link"
        aria-current={section === SETTINGS_SECTION.key ? "page" : undefined}
      >
        <Icon name={ICONS[SETTINGS_SECTION.key] as string} size={22} />
        {SETTINGS_SECTION.label}
      </Go>
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
  const { page, navigate, setLeaveGuard, setTitle } = useNavigation();
  const mainId = useId();
  const { toasts, toast } = useToasts();
  useEffect(() => {
    const lowered = () => toast(world3d.QUALITY_NOTICE);
    window.addEventListener(world3d.QUALITY_EVENT, lowered);
    return () => window.removeEventListener(world3d.QUALITY_EVENT, lowered);
  }, [toast]);
  const [asking, setAsking] = useState(false);
  const [, setNameVersion] = useState(0);
  const meta = useAsync((signal) => api.call("meta", { signal }), []);
  useEffect(() => {
    if (meta.data?.user.source === "anonymous" && !identity.name) setAsking(true);
  }, [meta.data, identity]);

  const proxied = meta.data?.user.source === "proxy" || meta.data?.user.source === "sso";
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
      setTitle,
    }),
    [api, identity, page, navigate, meta.data, meta.reload, toast, me, setLeaveGuard, setTitle],
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
            <ExpiryBanner />
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
