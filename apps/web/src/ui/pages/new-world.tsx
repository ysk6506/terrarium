/**
 * The new world dialog (REQ-077, ADR-0083). It first asks which world comes out — "사업장 그대로" (recommended, the
 * first focus) or "작게 시작" — not by which method. Each card has a picture and one line of result; choosing one
 * shows only that card's form. Opened lazily: the campus planner it measures with stays out of the first screen.
 */
import { useState } from "react";
import { Button, Dialog } from "../kit";
import { SmallForm } from "./new-site-form";
import { CampusForm } from "./world-forms";

type Way = "campus" | "small";

/** A campus from above: a few buildings on a plot. */
function CampusPicture() {
  return (
    <svg
      className="world-card-art"
      viewBox="0 0 120 72"
      role="img"
      aria-label="건물이 여러 동 있는 사업장"
    >
      <rect className="art-ground" x="2" y="2" width="116" height="68" rx="6" />
      <rect className="art-building" x="12" y="12" width="34" height="20" rx="2" />
      <rect className="art-building" x="52" y="12" width="22" height="20" rx="2" />
      <rect className="art-building" x="80" y="12" width="28" height="30" rx="2" />
      <rect className="art-building" x="12" y="40" width="46" height="20" rx="2" />
      <rect className="art-building" x="66" y="48" width="26" height="12" rx="2" />
    </svg>
  );
}

/** One building with one room in it. */
function SmallPicture() {
  return (
    <svg
      className="world-card-art"
      viewBox="0 0 120 72"
      role="img"
      aria-label="건물 하나와 서버룸 하나"
    >
      <rect className="art-ground" x="2" y="2" width="116" height="68" rx="6" />
      <rect className="art-building" x="34" y="14" width="52" height="40" rx="3" />
      <rect className="art-room" x="42" y="22" width="36" height="24" rx="2" />
      <rect className="art-rack" x="46" y="27" width="6" height="14" />
      <rect className="art-rack" x="55" y="27" width="6" height="14" />
      <rect className="art-rack" x="64" y="27" width="6" height="14" />
    </svg>
  );
}

function WayCards({ onPick }: { readonly onPick: (way: Way) => void }) {
  return (
    <div className="world-cards">
      <button type="button" className="world-card" onClick={() => onPick("campus")}>
        <CampusPicture />
        <span className="world-card-head">
          <b>사업장 그대로</b>
          <span className="tag">추천</span>
        </span>
        <span className="small muted">
          실제 크기 그대로 만들어요. 화성사업장은 랙이 10,000대가 넘어요.
        </span>
      </button>
      <button type="button" className="world-card" onClick={() => onPick("small")}>
        <SmallPicture />
        <span className="world-card-head">
          <b>작게 시작</b>
        </span>
        <span className="small muted">서버룸 하나짜리 작은 사업장이에요. 직접 키워 가요.</span>
      </button>
    </div>
  );
}

export default function NewWorldDialog({ onClose }: { readonly onClose: () => void }) {
  const [way, setWay] = useState<Way>();
  return (
    <Dialog title="어떤 세계를 만들까요?" onClose={onClose} wide={way !== undefined}>
      <div className="stack">
        {way === undefined && <WayCards onPick={setWay} />}
        {way !== undefined && (
          <div>
            <Button size="small" kind="quiet" icon="back" onClick={() => setWay(undefined)}>
              다시 고르기
            </Button>
          </div>
        )}
        {way === "campus" && <CampusForm onDone={onClose} />}
        {way === "small" && <SmallForm onDone={onClose} />}
      </div>
    </Dialog>
  );
}
