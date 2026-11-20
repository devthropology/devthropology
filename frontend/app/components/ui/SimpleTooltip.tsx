import * as React from "react";
import { useState, useRef, useEffect } from "react";

interface SimpleTooltipProps {
  children: React.ReactNode;
  content: string;
  className?: string;
  position?: "center" | "left" | "right";
}

export function SimpleTooltip({
  children,
  content,
  className = "",
  position = "center",
}: SimpleTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const handleClickOutside = () => {
      setIsVisible(false);
    };

    if (isVisible) {
      document.addEventListener("click", handleClickOutside);

      // Check if tooltip would go off-screen and adjust
      if (triggerRef.current && tooltipRef.current) {
        const triggerRect = triggerRef.current.getBoundingClientRect();
        const tooltipWidth = tooltipRef.current.offsetWidth;
        const viewportWidth = window.innerWidth;

        // If near right edge, align to right
        if (triggerRect.right + tooltipWidth / 2 > viewportWidth - 20) {
          setAdjustedPosition("right");
        } else if (triggerRect.left - tooltipWidth / 2 < 20) {
          setAdjustedPosition("left");
        } else {
          setAdjustedPosition("center");
        }
      }
    }

    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, [isVisible, position]);

  const handleMouseEnter = () => {
    setIsVisible(true);
  };

  const handleMouseLeave = () => {
    setIsVisible(false);
  };

  const getPositionClasses = () => {
    switch (adjustedPosition) {
      case "left":
        return "left-0 translate-x-0";
      case "right":
        return "right-0 translate-x-0";
      case "center":
      default:
        return "left-1/2 -translate-x-1/2";
    }
  };

  return (
    <span
      ref={triggerRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
    >
      {children}
      {isVisible && content && (
        <span
          ref={tooltipRef}
          className={`absolute ${getPositionClasses()} top-full mt-1 z-[100] max-w-[260px] w-max bg-gray-800 text-white text-xs font-normal py-2 px-3 rounded shadow-lg border border-gray-700 whitespace-pre-line`}
          style={{
            wordWrap: "break-word",
            lineHeight: "1.4",
            fontFamily:
              "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          }}
        >
          {content}
        </span>
      )}
    </span>
  );
}
