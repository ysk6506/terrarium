/** Hooks that read the browser (the logic that decides what to do with them lives in ../logic). */
import { useEffect, useState } from "react";

/** Whether a media query matches now, and again whenever it changes. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}
