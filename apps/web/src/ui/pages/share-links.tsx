/**
 * Sharing one experiment (REQ-038, ADR-0174, ADR-0198): the one place for it. A link is made here with its life chosen (30 days
 * unless said otherwise), and the experiment's links are listed and taken back here. This is one of the two screens drawn with
 * Astryx (debt TD-0007); it is opened lazily, so none of the design system is in the first screen.
 */
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import type { ExperimentView, ShareListItem } from "@terrarium/core/contract";
import { useState } from "react";
import { dateText } from "../../logic";
import { AstryxScope } from "../astryx";
import { useAction, useApp, useAsync } from "../context";
import { Failure, Loading } from "../kit";
import { useOwnerName } from "../scope";

/** How long a new link opens, in days; the server's own default is the first (30). */
const LIFETIMES = [
  { value: "1", label: "1일" },
  { value: "7", label: "7일" },
  { value: "30", label: "30일 (기본)" },
  { value: "90", label: "90일" },
  { value: "365", label: "1년" },
];

export const DEFAULT_DAYS = 30;

/** The link taken, then its words: what was copied and until when. */
export const copiedWords = (days: number) =>
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
  const ownerOf = useOwnerName();
  const until = link.expiresAt ? `${dateText(link.expiresAt)}까지` : "기간 없음";
  const take = async () => {
    const done = await run(
      () => api.call("deleteShare", { params: { token: link.token } }),
      "링크를 끊었어요. 이 링크로는 더 열리지 않아요",
    );
    if (done) onGone();
  };
  return (
    <li className="share-row">
      <span className="share-row-text">
        <Text size="sm">
          {dateText(link.createdAt)}에 만든 링크 · {until}
        </Text>
        <Text size="sm" color="secondary">
          {ownerOf(link.createdBy)}
        </Text>
      </span>
      <span className="share-row-actions">
        <Button
          data-moss-skip="공유 대화상자 안"
          variant="secondary"
          size="sm"
          label="복사"
          aria-label={`${dateText(link.createdAt)}에 만든 링크 복사`}
          onClick={() => void copy(link.url, "링크를 복사했어요")}
        />
        <Button
          data-moss-skip="공유 대화상자 안"
          variant="destructive"
          size="sm"
          label="끊기"
          isLoading={busy}
          aria-label={`${dateText(link.createdAt)}에 만든 링크 끊기`}
          onClick={() => void take()}
        />
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
  if (list.data.length === 0)
    return (
      <Text size="sm" color="secondary">
        아직 열어 둔 링크가 없어요.
      </Text>
    );
  return (
    <ul className="share-list">
      {list.data.map((link) => (
        <LinkRow key={link.token} link={link} onGone={() => setGone((n) => n + 1)} />
      ))}
    </ul>
  );
}

function Body({ view }: { readonly view: ExperimentView }) {
  const { api } = useApp();
  const { busy, run } = useAction();
  const copy = useCopy();
  const [days, setDays] = useState(String(DEFAULT_DAYS));
  const [made, setMade] = useState(0);
  const id = view.experiment.id;
  // Only the experiment's maker and admins make and take back links (the same people who change who can see it).
  if (view.canChangeScope === false)
    return <Text size="sm">링크는 이 실험을 만든 사람과 관리자만 만들고 끊을 수 있어요.</Text>;
  const make = async () => {
    const share = await run(() =>
      api.call("createShare", { params: { id }, body: { expiresInDays: Number(days) } }),
    );
    if (!share) return;
    await copy(share.url, copiedWords(Number(days)));
    setMade((n) => n + 1);
  };
  return (
    <div className="share-body">
      <Text size="sm" color="secondary">
        링크를 받은 사람은 로그인 없이 이 실험의 보고서를 볼 수 있어요. 누가 볼 수 있나요와는
        따로예요.
      </Text>
      <Selector
        label="얼마 동안 열어 둘까요"
        description="기간이 끝나면 링크가 저절로 닫혀요. 끊으면 바로 닫혀요."
        options={LIFETIMES}
        value={days}
        onChange={setDays}
      />
      <Button
        data-moss-skip="공유 대화상자 안"
        variant="primary"
        label="링크 만들어 복사"
        isLoading={busy}
        onClick={() => void make()}
      />
      <Text as="h3" weight="semibold">
        이 실험의 링크
      </Text>
      <Links id={id} version={made} />
    </div>
  );
}

export function ShareDialog({
  view,
  onClose,
}: {
  readonly view: ExperimentView;
  readonly onClose: () => void;
}) {
  return (
    <AstryxScope>
      <Dialog isOpen onOpenChange={(open) => !open && onClose()} width={480} purpose="form">
        <DialogHeader title="공유 링크" onOpenChange={(open) => !open && onClose()} />
        <Body view={view} />
      </Dialog>
    </AstryxScope>
  );
}

export default ShareDialog;
