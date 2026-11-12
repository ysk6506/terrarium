/**
 * The audit log over HTTP (ADR-0193, permissions.md section 6): what a listing asks, what it answers, and the words a
 * screen shows for every action and reason. The words are closed lists in core.experiments; a test fails if one has no label.
 */
import {
  AUDIT_ACTIONS,
  AUDIT_OUTCOMES,
  type AuditAction,
  type AuditEntry,
  type AuditOutcome,
  type AuditReason,
} from "@terrarium/core/experiments";
import { z } from "zod";

export const AUDIT_PAGE_DEFAULT = 50;
export const AUDIT_PAGE_MAX = 200;
/** A file for downloading holds the newest matches up to this many; a time range narrows it. */
export const AUDIT_EXPORT_MAX = 50_000;

const blank = (v: unknown) => (v === "" ? undefined : v);
const text = (max: number) => z.preprocess(blank, z.string().max(max).optional());
const when = z.preprocess(
  blank,
  z
    .string()
    .max(40)
    .refine(
      (v) => Number.isFinite(Date.parse(v)),
      "시각은 2026-11-01T09:00:00+09:00 같은 꼴로 적어 주세요",
    )
    .optional(),
);

/** The filters of a listing. Every one is optional; together they all must hold. */
export const AuditQuery = z
  .object({
    from: when,
    to: when,
    subject: text(100),
    action: z.preprocess(blank, z.enum(AUDIT_ACTIONS).optional()),
    resourceKind: text(40),
    resourceId: text(100),
    outcome: z.preprocess(blank, z.enum(AUDIT_OUTCOMES).optional()),
    limit: z.preprocess(blank, z.coerce.number().int().min(1).max(AUDIT_PAGE_MAX).optional()),
    cursor: z.preprocess(
      blank,
      z
        .string()
        .regex(/^\d{1,15}$/, "다음 쪽 표시가 올바르지 않아요")
        .optional(),
    ),
  })
  .strict();
export type AuditQueryParams = z.infer<typeof AuditQuery>;

/** The export takes the same filters but no page: it is the newest matches in one file. */
export const AuditExportQuery = AuditQuery.omit({ limit: true, cursor: true }).strict();

/** The limited view of a person's own things: no subject filter, only what happened to what they own. */
export const AuditMineQuery = AuditQuery.omit({ subject: true }).strict();

/** One entry as a screen needs it: the entry, and the words for its action and reason. */
export interface AuditEntryView extends Omit<AuditEntry, "seq"> {
  readonly id: string;
  /** The key a translated screen looks the action up by. */
  readonly labelKey: string;
  /** The action in words, now. */
  readonly label: string;
  readonly reasonLabel?: string;
}

export interface AuditPageView {
  readonly entries: readonly AuditEntryView[];
  /** Pass as `cursor` for the next page. */
  readonly next?: string;
}

/** What the maker of a thing sees of what was done to it: who, when, what, and how it ended. Nothing else. */
export interface AuditOwnView {
  readonly id: string;
  readonly at: string;
  readonly who: { readonly id: string; readonly name: string };
  readonly action: AuditAction;
  readonly labelKey: string;
  readonly label: string;
  readonly outcome: AuditOutcome;
  /** Which of their things: the kind, id and name it had then. */
  readonly resource: { readonly kind: string; readonly id?: string; readonly name?: string };
}

export interface AuditOwnPageView {
  readonly entries: readonly AuditOwnView[];
  readonly next?: string;
}

/** What each action is called, as a plain noun phrase that reads the same whether the try went through or was refused. */
export const AUDIT_LABELS: Readonly<Record<AuditAction, string>> = {
  "auth.sign_in": "로그인",
  "access.denied": "허락되지 않은 일 해 보기",
  "world.create": "세계 만들기",
  "world.generate": "세계 짓기",
  "world.import": "현실에서 세계 가져오기",
  "world.update": "세계 고치기",
  "world.physics_update": "세계의 물리 고치기",
  "world.delete": "세계 지우기",
  "world.like": "세계에 좋아요 누르기",
  "world.unlike": "세계의 좋아요 취소하기",
  "world.read": "관리자가 다른 사람의 세계 열어 보기",
  "scenario.create": "시나리오 만들기",
  "scenario.update": "시나리오 고치기",
  "scenario.delete": "시나리오 지우기",
  "scenario.calibrate": "시나리오 점검하기",
  "scenario.process_update": "지금 하는 방식 표 적기",
  "scenario.read": "관리자가 다른 사람의 시나리오 열어 보기",
  "experiment.start": "실험 시작하기",
  "experiment.fork": "조건만 바꿔 실험 다시 시작하기",
  "experiment.add_runs": "실험에 실행 더하기",
  "experiment.cancel": "실험 멈추기",
  "experiment.read": "관리자가 다른 사람의 실험 열어 보기",
  "run.escalation_answer": "넘긴 일에 답하기",
  "run.read": "관리자가 다른 사람의 실행 열어 보기",
  "share.create": "공유 링크 만들기",
  "share.revoke": "공유 링크 끊기",
  "share.list": "공유 링크 목록 열어 보기",
  "connection.create": "연결 만들기",
  "connection.update": "연결 고치기",
  "connection.delete": "연결 끊기",
  "connection.try": "연결에 말 걸어 보기",
  "connection.check": "연결 다시 확인하기",
  "connection.keep": "연결을 계속 쓰기로 하기",
  "connection.agent_version_add": "에이전트 버전 더하기",
  "connection.agent_version_update": "에이전트 버전 고치기",
  "connection.agent_version_delete": "에이전트 버전 지우기",
  "connection.read": "관리자가 다른 사람의 연결 열어 보기",
  "model.create": "모델 등록하기",
  "model.update": "모델 등록 고치기",
  "model.delete": "모델 등록 지우기",
  "model.check": "모델 연결 확인하기",
  "model.set_default": "모두의 기본 모델 정하기",
  "model.read": "관리자가 다른 사람의 모델 등록 열어 보기",
  "preset.save": "자주 쓰는 설정 저장하기",
  "preset.import": "자주 쓰는 설정 옮겨 오기",
  "preset.rename": "자주 쓰는 설정 이름 바꾸기",
  "preset.delete": "자주 쓰는 설정 지우기",
  "preset.restore": "지운 설정 되돌리기",
  "service_card.create": "서비스 카드 만들기",
  "service_card.update": "서비스 카드 고치기",
  "service_card.copy": "서비스 카드 복사하기",
  "service_card.delete": "서비스 카드 지우기",
  "scope.change": "누가 볼 수 있는지 바꾸기",
  "audit.read": "감사 기록 열어 보기",
  "audit.export": "감사 기록 내려받기",
  "audit.read_own": "내 것에 있던 일 열어 보기",
  "audit.sweep": "오래된 감사 기록 정리하기",
  "audit.limit": "로그인 전 실패 기록이 상한에 닿음",
};

/** Why a try was refused or failed, in words a person can act on. */
export const AUDIT_REASON_LABELS: Readonly<Record<AuditReason, string>> = {
  unauthenticated: "로그인하지 않은 요청이에요",
  proxy_secret_missing: "프록시의 비밀 값 없이 왔어요",
  proxy_secret_wrong: "프록시의 비밀 값이 맞지 않았어요",
  proxy_login_missing: "프록시가 로그인 ID를 알려 주지 않았어요",
  not_admin: "관리자만 할 수 있는 일이에요",
  not_owner: "만든 사람이나 관리자만 할 수 있는 일이에요",
  not_allowed: "이 사람에게는 허락되지 않은 일이에요",
  not_visible: "볼 수 없는 것이었어요",
  invalid_input: "입력이 올바르지 않았어요",
  not_found: "찾는 것이 없었어요",
  conflict: "그사이 다른 변경이 있었어요",
  unavailable: "연결된 서비스에 닿지 못했어요",
  error: "서버에서 문제가 생겼어요",
};

export const labelKeyOf = (action: AuditAction): string => `audit.action.${action}`;
