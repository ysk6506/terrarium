/**
 * The speech bubble over a person of the server room (REQ-074): one line for a few seconds after a click.
 * It follows the head on the screen as the camera moves, without drawing the page again for each frame.
 */
import { useEffect, useRef, useState } from "react";
import type { Say } from "./crew-stage";
import type { WorldView } from "./view";

export function CrewBubble({ view }: { readonly view: WorldView }) {
  const [say, setSay] = useState<Say>();
  const ref = useRef<HTMLOutputElement>(null);
  useEffect(() => {
    const offs = [view.crew.onSay(setSay), view.animals.onSay(setSay)];
    return () => {
      for (const off of offs) off();
    };
  }, [view]);
  useEffect(() => {
    const el = ref.current;
    if (!say || !el) return;
    const place = () => {
      const at = say.at();
      el.style.left = `${at.x}px`;
      el.style.top = `${at.y}px`;
      el.style.visibility = at.visible ? "visible" : "hidden";
    };
    place();
    return view.onRender(place);
  }, [say, view]);
  if (!say) return null;
  return (
    <output ref={ref} className="crew-bubble">
      {say.text}
    </output>
  );
}
