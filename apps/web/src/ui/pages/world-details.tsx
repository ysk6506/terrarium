/**
 * "더 정하기" (REQ-077, ADR-0083): the numbers that are left once a site and a scale are chosen, folded away and
 * in three groups — buildings, server rooms, servers — each with a line in plain words. What the generator keeps
 * for itself (how much is modelled server by server, the cooling and the makers) is not asked at all.
 */
import type { CampusSpec } from "@terrarium/core/sources/worldgen";
import { worldScale } from "../../logic";
import { NumberField, SelectField, TextField } from "../kit";

interface DetailsProps {
  readonly spec: CampusSpec;
  readonly onChange: (changes: Partial<CampusSpec>) => void;
  readonly name: string;
  readonly onName: (name: string) => void;
  readonly placeholder: string;
}

function Group({
  group,
  spec,
  onChange,
}: {
  readonly group: worldScale.DetailGroup;
  readonly spec: CampusSpec;
  readonly onChange: DetailsProps["onChange"];
}) {
  return (
    <fieldset className="detail-group">
      <legend>{group.title}</legend>
      <div className="grid-2">
        {group.fields.map((f) => (
          <NumberField
            key={f.key}
            label={f.label}
            unit={f.unit}
            min={f.min}
            max={f.max}
            step={1}
            help={f.help}
            value={worldScale.shownValue(f, spec)}
            onChange={(v) => v !== undefined && onChange({ [f.key]: worldScale.keptValue(f, v) })}
          />
        ))}
        {group.title === "서버" && (
          <SelectField
            label="전기를 받는 방법"
            value={spec.powerRedundancy}
            options={worldScale.POWER_CHOICES}
            help="두 갈래면 한쪽이 끊겨도 서버가 꺼지지 않아요."
            onChange={(v) => onChange({ powerRedundancy: v as CampusSpec["powerRedundancy"] })}
          />
        )}
      </div>
    </fieldset>
  );
}

export function WorldDetails({ spec, onChange, name, onName, placeholder }: DetailsProps) {
  return (
    <details className="fold detail-fold">
      <summary>더 정하기</summary>
      <div className="stack" style={{ marginTop: 12 }}>
        {worldScale.DETAIL_GROUPS.map((g) => (
          <Group key={g.title} group={g} spec={spec} onChange={onChange} />
        ))}
        <fieldset className="detail-group">
          <legend>이름과 번호</legend>
          <div className="grid-2">
            <TextField
              label="세계 이름"
              value={name}
              placeholder={placeholder}
              maxLength={80}
              onChange={onName}
            />
            <NumberField
              label="같은 세계 다시 만들기 번호"
              value={spec.seed}
              min={0}
              step={1}
              help="같은 번호로 만들면 똑같은 세계가 나와요."
              onChange={(v) => v !== undefined && onChange({ seed: Math.max(0, Math.round(v)) })}
            />
          </div>
        </fieldset>
      </div>
    </details>
  );
}
