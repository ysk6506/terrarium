/**
 * The first question of a new world (ADR-0107 item 1): "무엇을 하려고 하세요?" with two doors and, under them, the worlds
 * saved before. The doors lead to "서비스부터" (three screens, no builder) and to the builder from the land up.
 */
import type { WorldSummary } from "@terrarium/core/experiments";
import { useState } from "react";
import { Go, useApp, useAsync } from "../context";
import { Button, Dialog } from "../kit";
import { SmallForm } from "./new-site-form";
import { CampusForm } from "./world-forms";

function Doors({
  onService,
  onBuild,
}: {
  readonly onService: () => void;
  readonly onBuild: () => void;
}) {
  return (
    <div className="we-doors">
      <button type="button" className="we-door" onClick={onService}>
        <div className="we-pic svc" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div>
          <h2>실험할 인프라가 필요해요</h2>
          <p>멈추면 안 되는 서비스를 고르면, 그걸 떠받치는 데이터센터를 대신 지어요.</p>
        </div>
        <div className="we-meta">
          <b>3분</b>· 질문 셋 · 바로 실험으로
        </div>
        <div className="we-go">서비스 고르기 →</div>
      </button>
      <button type="button" className="we-door" onClick={onBuild}>
        <div className="we-pic diy" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
        <div>
          <h2>데이터센터를 직접 지어요</h2>
          <p>부지를 사고 건물을 올리고 랙에 서버를 꽂아요. 실제 가격, 실제 크기예요.</p>
        </div>
        <div className="we-meta">
          <b>시간은 마음대로</b>· 부지 → 건물 → 서버룸 → 랙
        </div>
        <div className="we-go">부지 고르기 →</div>
      </button>
    </div>
  );
}

function Templates({ items }: { readonly items: readonly WorldSummary[] }) {
  if (items.length === 0) return null;
  return (
    <div className="stack" style={{ marginTop: 12 }}>
      {items.map((t) => (
        <div key={t.id} className="we-tpl">
          <b>{t.name}</b>
          <span className="muted small">내 템플릿 · {t.owner}</span>
          <span className="we-spacer" />
          <Go to={{ name: "newWorld", template: t.id }} className="btn btn-primary btn-small">
            그대로 만들기
          </Go>
          <Go to={{ name: "newWorld", template: t.id, change: true }} className="btn btn-small">
            조금 바꿔서
          </Go>
        </div>
      ))}
    </div>
  );
}

type Saved = "campus" | "build" | undefined;

export function WorldEntry({ onService }: { readonly onService: () => void }) {
  const { api, identity } = useApp();
  const templates = useAsync((signal) => api.call("listWorldTemplates", { signal }), []);
  const [open, setOpen] = useState<Saved>();
  const mine = (templates.data ?? []).filter((t) => t.owner === identity.name);
  return (
    <div className="we">
      <h1>무엇을 하려고 하세요?</h1>
      <p className="we-sub">나중에 바꿀 수 있어요.</p>
      <Doors onService={onService} onBuild={() => setOpen("build")} />
      <section className="we-saved" aria-label="저장해 둔 세계에서 시작">
        <h3>저장해 둔 세계에서 시작</h3>
        <div className="we-chips">
          <button type="button" className="we-chip" onClick={() => setOpen("campus")}>
            사업장 실측·표본<small>규모를 골라요</small>
          </button>
          <span className="we-chip" aria-live="polite">
            내 템플릿<small>{mine.length}개</small>
          </span>
        </div>
        <Templates items={mine} />
      </section>
      {open === "campus" && (
        <Dialog title="사업장 그대로 만들기" wide onClose={() => setOpen(undefined)}>
          <CampusForm onDone={() => setOpen(undefined)} />
        </Dialog>
      )}
      {open === "build" && (
        <Dialog title="어디에 지을까요?" onClose={() => setOpen(undefined)}>
          <SmallForm onDone={() => setOpen(undefined)} />
          <div className="row" style={{ marginTop: 8 }}>
            <Button kind="quiet" onClick={() => setOpen(undefined)}>
              그만두기
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
