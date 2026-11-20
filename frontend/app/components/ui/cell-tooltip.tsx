import { useRef, useState, type ReactNode } from "react";

/**
 * A tooltip wrapper for table cells that uses fixed positioning
 * to escape overflow-hidden on parent TableCell elements.
 *
 * Usage:
 *   <CellTooltip tooltip={<>Full details here</>}>
 *     <span>Truncated text...</span>
 *   </CellTooltip>
 */
export function CellTooltip({
  children,
  tooltip,
  align = "left",
  className = "",
}: {
  children: ReactNode;
  tooltip: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, right: 0 });
  const ref = useRef<HTMLDivElement>(null);

  const onEnter = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) {
      setPos({
        top: rect.top - 4,
        left: rect.left,
        right: window.innerWidth - rect.right,
      });
    }
    setShow(true);
  };

  return (
    <div ref={ref} onMouseEnter={onEnter} onMouseLeave={() => setShow(false)} className={className}>
      {children}
      {show && (
        <div
          style={{
            position: "fixed",
            top: pos.top,
            ...(align === "right" ? { right: pos.right } : { left: pos.left }),
            transform: "translateY(-100%)",
          }}
          className="px-2 py-1 bg-gray-800 text-white text-xs rounded pointer-events-none whitespace-nowrap z-50 max-w-md"
        >
          {tooltip}
        </div>
      )}
    </div>
  );
}
