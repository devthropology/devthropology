import { Loader2 } from "lucide-react";
import React from "react";
import { useLocation, useNavigation } from "react-router";
import { useSpinDelay } from "../../utils/useSpinDelay";

/**
 * Displays a full-page overlay spinner only during route changes.
 * Uses a small spin-delay to avoid flicker on fast transitions.
 */
export function RouteLoadingOverlay() {
  const location = useLocation();
  const navigation = useNavigation();
  const isRouteChange =
    navigation.state === "loading" && navigation.location?.pathname !== location.pathname;
  const show = useSpinDelay(isRouteChange, { delay: 150, minDuration: 250 });

  if (!show) return null;

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-gray-900/80"
      aria-live="polite"
      aria-busy="true"
      role="status"
    >
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      <span className="sr-only">Loading next page…</span>
    </div>
  );
}
