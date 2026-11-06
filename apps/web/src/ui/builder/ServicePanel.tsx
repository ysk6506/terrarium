/**
 * Services in the right panel (REQ-086, ADR-0091): under a server or VM the line "떠받치는 서비스 n개" with each
 * service one tap away and a button to add one; for a service itself its kind and what it costs when it stops.
 * The cost figure is a guess and says so.
 */
import type { Entity, ServiceKind } from "@terrarium/core/world";
import { SERVICE_KIND_LABELS, SERVICE_KINDS, serviceDef } from "@terrarium/core/world";
import { builder, won } from "../../logic";
import { Button, NumberField, Segmented } from "../kit";
import type { Builder } from "./useBuilder";

export const carriesServices = (e: Entity): boolean =>
  e.kind === "server" || e.kind === "vm" || e.kind === "storage";

/** "떠받치는 서비스 n개", the services by name, and a way to add one. */
export function SupportedServices({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const services = builder.servicesOnPlace(b.state.index, entity.id);
  return (
    <div className="builder-block stack" data-testid="supported-services">
      <p className="small" style={{ fontWeight: 600 }}>
        {builder.supportLine(b.state.index, entity.id)}
      </p>
      {services.map((s) => (
        <Button key={s.id} size="small" kind="quiet" onClick={() => b.setSelected([s.id])}>
          {s.name}
        </Button>
      ))}
      <Button
        size="small"
        icon="plus"
        onClick={() => b.apply((bp) => builder.addService(bp, entity.id), "서비스를 더했어요")}
      >
        서비스 더하기
      </Button>
    </div>
  );
}

/** A service's own settings: kind and the harm of a stop (a guess unless someone sets it). */
export function ServiceFields({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const def = serviceDef(entity);
  const batch = def.kind === "batch";
  return (
    <div className="builder-block stack" data-testid="service-fields">
      <Segmented
        label="서비스 종류"
        value={def.kind}
        options={SERVICE_KINDS.map((k) => ({ value: k, label: SERVICE_KIND_LABELS[k] }))}
        onChange={(k: ServiceKind) =>
          b.apply((bp) => builder.setProp(bp, entity.id, "serviceKind", k))
        }
      />
      {batch ? (
        <NumberField
          label="멈추면 늦어지는 시간"
          value={def.harm.delayHours}
          min={0}
          unit="시간"
          onChange={(v) =>
            v !== undefined && b.apply((bp) => builder.setProp(bp, entity.id, "delayHours", v))
          }
        />
      ) : (
        <NumberField
          label="멈추면 시간당 피해(추정)"
          value={def.harm.perHourKrw}
          min={0}
          unit="원"
          help={
            def.harm.perHourKrw
              ? `한 시간에 ${won(def.harm.perHourKrw / 1_000_000)}쯤으로 어림한 값이에요`
              : undefined
          }
          onChange={(v) =>
            v !== undefined && b.apply((bp) => builder.setProp(bp, entity.id, "harmPerHourKrw", v))
          }
        />
      )}
      <p className="tiny muted">이 피해 값은 어림한 추정이에요. 실제 사업장에 맞게 고쳐 주세요.</p>
    </div>
  );
}
