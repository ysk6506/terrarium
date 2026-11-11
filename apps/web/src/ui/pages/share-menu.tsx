/**
 * Sharing one experiment (REQ-038, ADR-0174): the menu on the result page, and the dialog where the link's life is chosen
 * (30 days unless said otherwise) and the experiment's links are listed and taken back.
 */

import type { ExperimentView, ShareListItem } from "@terrarium/core/contract";
import { useState } from "react";
import { dateText } from "../../logic";
import { useAction, useApp, useAsync } from "../context";
import { SelectField } from "../fields";
import { Button, Dialog, Failure, Loading, MenuButton } from "../kit";

/** How long a new link opens, in days; the server's own default is the first (30). */
const LIFETIMES = [
  { days: 1, label: "1일" },
  { days: 7, label: "7일" },
  { days: 30, label: "30일 (기본)" },
  { days: 90, label: "90일" },
  { days: 365, label: "1년" },
] as const;

const DEFAULT_DAYS = 30;

/** The link taken, then its words: what was copied and until when. */
const copiedWords = (days: number) =>
  `링크를 복사했어요. 받은 사람은 로그인 없이 보고서를 볼 수 있고, ${days}일 뒤에 닫혀요`;

function useCopy() {
  const { toast } = useApp();
  return async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch {
      toast("복사하지 못했어요. 브라우저가 클립보드를 막고 있어요", "bad");
    }
  };
}

function LinkRow({ link, onGone }: { readonly link: ShareListItem; readonly onGone: () => void }) {
  const { api } = useApp();
  const { busy, run } = useAction();
  const copy = useCopy();
  const until = link.expiresAt ? `${dateText(link.expiresAt)}까지` : "기간 없음";
  const take = async () => {
    const done = await run(
      () => api.call("deleteShare", { params: { token: link.token } }),
      "링크를 끊었어요. 이 링크로는 더 열리지 않아요",
    );
    if (done) onGone();
  };
  return (
    <li className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
      <span className="small">
        {dateText(link.createdAt)}에 만든 링크 · {until}
        <span className="muted"> · {link.createdBy}</span>
      </span>
      <span className="row">
        <Button
          data-moss-skip="폼과 대화상자 안"
          size="small"
          onClick={() => void copy(link.url, "링크를 복사했어요")}
        >
          복사
        </Button>
        <Button
          data-moss-skip="폼과 대화상자 안"
          size="small"
          kind="danger"
          busy={busy}
          aria-label={`${dateText(link.createdAt)}에 만든 링크 끊기`}
          onClick={() => void take()}
        >
          끊기
        </Button>
      </span>
    </li>
  );
}

function Links({ id, version }: { readonly id: string; readonly version: number }) {
  const { api } = useApp();
  const [gone, setGone] = useState(0);
  const list = useAsync(
    (signal) => api.call("listShares", { params: { id }, signal }),
    [id, version, gone],
  );
  if (list.error) return <Failure error={list.error} />;
  if (!list.data) return <Loading />;
  if (list.data.length === 0) return <p className="muted small">아직 열어 둔 링크가 없어요.</p>;
  return (
    <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {list.data.map((link) => (
        <LinkRow key={link.token} link={link} onGone={() => setGone((n) => n + 1)} />
      ))}
    </ul>
  );
}

function ShareDialog({
  view,
  onClose,
}: {
  readonly view: ExperimentView;
  readonly onClose: () => void;
}) {
  const { api } = useApp();
  const { busy, run } = useAction();
  const copy = useCopy();
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [made, setMade] = useState(0);
  const id = view.experiment.id;
  // Only the experiment's maker and admins make and take back links (the same people who change who can see it).
  const mayShare = view.canChangeScope !== false;
  const make = async () => {
    const share = await run(() =>
      api.call("createShare", { params: { id }, body: { expiresInDays: days } }),
    );
    if (!share) return;
    await copy(share.url, copiedWords(days));
    setMade((n) => n + 1);
  };
  return (
    <Dialog
      title="공유 링크"
      onClose={onClose}
      actions={
        mayShare ? (
          <Button
            data-moss-skip="폼과 대화상자 안"
            kind="primary"
            busy={busy}
            onClick={() => void make()}
          >
            링크 만들어 복사
          </Button>
        ) : undefined
      }
    >
      {mayShare ? (
        <div className="stack">
          <SelectField
            label="얼마 동안 열어 둘까요"
            value={String(days)}
            options={LIFETIMES.map((l) => ({ value: String(l.days), label: l.label }))}
            onChange={(v) => setDays(Number(v))}
            help="기간이 끝나면 링크가 저절로 닫혀요. 끊으면 바로 닫혀요."
          />
          <h3 className="small">이 실험의 링크</h3>
          <Links id={id} version={made} />
        </div>
      ) : (
        <p className="small">링크는 이 실험을 만든 사람과 관리자만 만들고 끊을 수 있어요.</p>
      )}
    </Dialog>
  );
}

export function ShareMenu({ view }: { readonly view: ExperimentView }) {
  const { api, toast } = useApp();
  const copy = useCopy();
  const [managing, setManaging] = useState(false);
  const id = view.experiment.id;
  const shareLink = async () => {
    try {
      const share = await api.call("createShare", {
        params: { id },
        body: { expiresInDays: DEFAULT_DAYS },
      });
      await copy(share.url, copiedWords(DEFAULT_DAYS));
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "bad");
    }
  };
  const copyText = async () => {
    try {
      await copy(
        await api.call("experimentReport", { params: { id }, query: { format: "text" } }),
        "보고서 글을 복사했어요",
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "bad");
    }
  };
  return (
    <>
      <MenuButton
        label="공유"
        icon="share"
        items={[
          {
            label: "링크 복사",
            hint: "30일 동안 로그인 없이 보고서가 열려요",
            onSelect: () => void shareLink(),
          },
          {
            label: "링크 기간과 목록",
            hint: "기간을 고르고, 열어 둔 링크를 끊어요",
            onSelect: () => setManaging(true),
          },
          {
            label: "HTML 보고서 열기",
            hint: "한 파일로 저장해 메일에 붙일 수 있어요",
            onSelect: () =>
              window.open(
                api.url("experimentReport", { id }, { format: "html" }),
                "_blank",
                "noopener",
              ),
          },
          {
            label: "글로 복사",
            hint: "메신저에 붙여 넣기 좋아요",
            onSelect: () => void copyText(),
          },
        ]}
      />
      {managing && <ShareDialog view={view} onClose={() => setManaging(false)} />}
    </>
  );
}
