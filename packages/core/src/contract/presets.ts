/** 저장해 둔 것(ADR-0092 결정 3, ADR-0112): 지시문·툴 묶음·절차서를 이름 붙여 서버에 둔다. 만든 사람 것이고 세계·시나리오와 무관해요. */
import {
  PRESET_BODY_MAX,
  PRESET_KINDS,
  PRESET_NAME_MAX,
  type PresetKind,
} from "@terrarium/core/experiments";
import { z } from "zod";

const Kind = z.enum(PRESET_KINDS as unknown as [string, ...string[]]);
const Name = z.string().trim().min(1).max(PRESET_NAME_MAX);

/** 저장 — 같은 종류에서 같은 이름이면 그 내용을 바꿔요. */
export const SavePresetBody = z
  .object({ kind: Kind, name: Name, body: z.string().min(1).max(PRESET_BODY_MAX) })
  .strict();

/** 이름 바꾸기. */
export const RenamePresetBody = z.object({ name: Name }).strict();

/** 이 브라우저에 있던 것을 서버로 한 번 옮길 때. 같은 종류·이름이 이미 있으면 건너뛰어요. */
export const ImportPresetsBody = z
  .object({
    items: z
      .array(
        z
          .object({
            kind: Kind,
            name: Name,
            body: z.string().min(1).max(PRESET_BODY_MAX),
            createdAt: z.string().max(40).optional(),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();

export const PresetQuery = z.object({ kind: Kind.optional() }).strict();

export type SavePresetRequest = z.output<typeof SavePresetBody>;
export type RenamePresetRequest = z.output<typeof RenamePresetBody>;
export type ImportPresetsRequest = z.output<typeof ImportPresetsBody>;

export type { PresetKind } from "@terrarium/core/experiments";

/** 저장해 둔 것 하나. */
export interface PresetView {
  readonly id: string;
  readonly kind: PresetKind;
  readonly name: string;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly deletedAt?: string;
}

/** 목록: 지금 쓰는 것과, 7일 안에 되돌릴 수 있게 지운 것. */
export interface PresetListView {
  readonly presets: readonly PresetView[];
  readonly deleted: readonly PresetView[];
}
