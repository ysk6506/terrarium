/** core.oracle: scoring an agent run against the scenario's scoring sheet (REQ-007, REQ-037). */

export {
  analyzeHandoffs,
  type HandoffFault,
  type HandoffInput,
  type HandoffReport,
  type HandoffRow,
  NEEDLESS_CAP,
  NEEDLESS_PENALTY,
} from "./handoff";
export {
  type DiagnosisFacts,
  END_REASON_LABELS,
  type EndReason,
  endReasonLabel,
  hoursText,
  investigationCalls,
  type OperationEnd,
  ORACLE_VERSION,
  PASS_MARK,
  type RunOutcome,
  type Score,
  type ScoreItem,
  type Scoring,
  score,
  type Verdict,
} from "./oracle";
export {
  analyzeRecovery,
  type RecoveryReport,
  type ServiceHarm,
  serviceHarms,
  WORSEN_WINDOW_S,
} from "./recovery";
export {
  FULL_ORDER_S,
  FULL_RECOVERY_S,
  RECOVERY_WEIGHTS,
  ramp,
  ZERO_ORDER_S,
  ZERO_RECOVERY_S,
} from "./recovery-score";
