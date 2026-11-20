import { useEffect, useState } from "react";

type Options = { delay?: number; minDuration?: number };

/**
 * Small UX helper to avoid spinner flicker on quick transitions.
 * - Shows after `delay` ms
 * - Stays visible for at least `minDuration` ms once shown
 */
export function useSpinDelay(active: boolean, opts: Options = {}) {
  const { delay = 150, minDuration = 250 } = opts;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let showT: number | undefined;
    let hideT: number | undefined;

    if (active) {
      showT = setTimeout(() => setVisible(true), delay) as unknown as number;
    } else {
      if (visible) {
        hideT = setTimeout(() => setVisible(false), minDuration) as unknown as number;
      } else {
        setVisible(false);
      }
    }

    return () => {
      if (showT) clearTimeout(showT);
      if (hideT) clearTimeout(hideT);
    };
  }, [active, delay, minDuration, visible]);

  return visible;
}
