/**
 * The glyph of each kind of equipment, standing on its tile (REQ-078, ADR-0084): small isometric boxes, as in the
 * approved mock-up. Every glyph is drawn around the middle of the tile's base, y up being negative. Colours come
 * from classes (`tone-*`) that read the theme's tokens, so the dark theme needs nothing here.
 */
import type { TopoKind, TopoState } from "@terrarium/core/topology";

type Tone = "steel" | "dark" | "green" | "blue" | "olive";

interface BoxProps {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly d: number;
  readonly z: number;
  readonly tone: Tone;
}

/** A box standing on the point (x, y): width w, depth d, height z, as seen from above and to the side. */
function Box({ x, y, w, d, z, tone }: BoxProps) {
  const hw = w / 2;
  const hd = d / 2;
  return (
    <g className={`tone-${tone}`}>
      <polygon
        className="pl"
        points={`${x - hw},${y} ${x},${y + hd} ${x},${y + hd - z} ${x - hw},${y - z}`}
      />
      <polygon
        className="pr"
        points={`${x + hw},${y} ${x},${y + hd} ${x},${y + hd - z} ${x + hw},${y - z}`}
      />
      <polygon
        className="pt"
        points={`${x},${y - hd - z} ${x + hw},${y - z} ${x},${y + hd - z} ${x - hw},${y - z}`}
      />
    </g>
  );
}

const Led = ({
  x,
  y,
  state,
}: {
  readonly x: number;
  readonly y: number;
  readonly state: TopoState;
}) => <rect className={`led led-${state}`} x={x} y={y} width={2.4} height={2} />;

interface GlyphProps {
  readonly state: TopoState;
}

const Chiller = () => (
  <>
    <Box x={0} y={6} w={34} d={20} z={22} tone="steel" />
    <ellipse className="fan" cx={0} cy={-12} rx={9} ry={5} />
    <ellipse className="fan-hub" cx={0} cy={-12} rx={4} ry={2.2} />
  </>
);

const Crah = ({ state }: GlyphProps) => (
  <>
    <Box x={0} y={8} w={24} d={16} z={34} tone="steel" />
    {[0, 1, 2, 3].map((i) => (
      <line key={i} className="louvre" x1={-10} y1={-6 + i * 5} x2={-1} y2={-1.5 + i * 5} />
    ))}
    <Led x={2} y={-22} state={state} />
  </>
);

const Cdu = ({ state }: GlyphProps) => (
  <>
    <Box x={0} y={8} w={22} d={14} z={28} tone="steel" />
    <Box x={0} y={-6} w={12} d={8} z={6} tone="blue" />
    <Led x={2} y={-16} state={state} />
  </>
);

const Room = () => (
  <>
    <Box x={0} y={8} w={54} d={30} z={8} tone="green" />
    {[0, 1, 2].map((i) => (
      <Box key={i} x={-14 + i * 12} y={6} w={14} d={6} z={10} tone="dark" />
    ))}
  </>
);

const Rack = ({ state }: GlyphProps) => (
  <>
    <Box x={0} y={8} w={14} d={9} z={30} tone="dark" />
    {[0, 1, 2, 3, 4].map((i) => (
      <Led key={i} x={-5} y={-18 + i * 4} state={state === "alarm" && i > 2 ? "alarm" : "ok"} />
    ))}
  </>
);

const Racks = ({ state }: GlyphProps) => (
  <>
    {[2, 1, 0].map((i) => (
      <Box key={i} x={-8 + i * 8} y={8} w={12} d={8} z={26} tone="dark" />
    ))}
    <Led x={-11} y={-14} state="ok" />
    <Led x={-3} y={-10} state="ok" />
    <Led x={5} y={-6} state={state === "alarm" || state === "fault" ? state : "ok"} />
  </>
);

const Server = ({ state }: GlyphProps) => (
  <>
    <Box x={0} y={6} w={26} d={13} z={5} tone="steel" />
    <Led x={-9} y={-1} state={state} />
  </>
);

const Servers = ({ state }: GlyphProps) => (
  <>
    {[0, 1, 2].map((i) => (
      <Box key={i} x={0} y={8 - i * 5} w={24} d={12} z={3.5} tone="steel" />
    ))}
    <Led x={-9} y={-4} state={state} />
  </>
);

const Feed = () => (
  <>
    <Box x={0} y={8} w={30} d={18} z={18} tone="steel" />
    <ellipse className="fan" cx={-6} cy={-14} rx={4} ry={2.4} />
    <ellipse className="fan" cx={6} cy={-14} rx={4} ry={2.4} />
  </>
);

const Generator = () => (
  <>
    <Box x={0} y={8} w={38} d={16} z={16} tone="olive" />
    <Box x={12} y={-6} w={5} d={4} z={14} tone="dark" />
  </>
);

const Ups = ({ state }: GlyphProps) => (
  <>
    <Box x={0} y={8} w={26} d={16} z={28} tone="steel" />
    <Box x={-4} y={4} w={10} d={6} z={4} tone="green" />
    <Led x={4} y={-16} state={state} />
  </>
);

const Panel = ({ state }: GlyphProps) => (
  <>
    <Box x={0} y={8} w={20} d={10} z={32} tone="steel" />
    <line className="louvre" x1={-8} y1={-10} x2={-8} y2={-26} />
    <Led x={3} y={-22} state={state} />
  </>
);

const Pdu = ({ state }: GlyphProps) => (
  <>
    <Box x={0} y={8} w={9} d={6} z={30} tone="dark" />
    {[0, 1, 2, 3].map((i) => (
      <Led key={i} x={-4} y={-20 + i * 5} state={state} />
    ))}
  </>
);

const Switch = ({ state }: GlyphProps) => (
  <>
    <Box x={0} y={6} w={36} d={14} z={6} tone="steel" />
    {[0, 1, 2, 3, 4, 5].map((i) => (
      <Led key={i} x={-13 + i * 4} y={-3} state={i === 5 ? state : "ok"} />
    ))}
  </>
);

const Storage = ({ state }: GlyphProps) => (
  <>
    {[0, 1, 2].map((i) => (
      <Box key={i} x={0} y={8 - i * 7} w={26} d={14} z={6} tone="blue" />
    ))}
    <Led x={-9} y={-12} state={state} />
  </>
);

const Vm = () => <Box x={0} y={4} w={16} d={10} z={14} tone="blue" />;

const Cluster = () => (
  <>
    <Box x={-8} y={8} w={14} d={8} z={12} tone="blue" />
    <Box x={8} y={8} w={14} d={8} z={12} tone="blue" />
    <Box x={0} y={0} w={14} d={8} z={12} tone="blue" />
  </>
);

type Glyph = (p: GlyphProps) => React.ReactNode;

const SINGLE: Readonly<Record<TopoKind, Glyph>> = {
  feed: Feed,
  generator: Generator,
  ups: Ups,
  panel: Panel,
  pdu: Pdu,
  chiller: Chiller,
  cdu: Cdu,
  crah: Crah,
  room: Room,
  rack: Rack,
  server: Server,
  switch: Switch,
  storage: Storage,
  vm: Vm,
  cluster: Cluster,
};

/** Many of a kind: racks stand in a row, servers in a stack; the rest are the single glyph on a stack of bases. */
const MANY: Partial<Record<TopoKind, Glyph>> = { rack: Racks, server: Servers };

export function Glyph({
  kind,
  group,
  state,
}: {
  readonly kind: TopoKind;
  readonly group: boolean;
  readonly state: TopoState;
}) {
  const Draw = (group ? MANY[kind] : undefined) ?? SINGLE[kind];
  return <Draw state={state} />;
}
