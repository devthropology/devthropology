import { cn } from "../../lib/utils";
import type { ReactNode } from "react";

interface PageContainerProps {
  children: ReactNode;
  /** Additional classes to apply */
  className?: string;
}

/**
 * Optional convenience wrapper for page content.
 *
 * NOTE: As of the layout refactor, the parent layout in app.tsx already
 * provides consistent padding (px-4 py-6 md:px-6 lg:px-8) and flex-col
 * fill behavior to all routes. Pages automatically fill the available
 * vertical space via `flex-1 flex flex-col` on the Outlet wrapper.
 *
 * Use this component only if you need an *additional* inner wrapper,
 * for example inside a layout that has its own sub-routing.
 *
 * For most pages, just use `flex-1` on your root div to fill height:
 *   <div className="flex-1 flex flex-col">...</div>
 */
export function PageContainer({ children, className }: PageContainerProps) {
  return <div className={cn("flex-1 flex flex-col", className)}>{children}</div>;
}

interface PageHeaderProps {
  children: ReactNode;
  /** Additional classes to apply */
  className?: string;
  /** Right-side content (filters, actions, etc.) */
  actions?: ReactNode;
}

/**
 * PageHeader provides consistent header styling with optional actions.
 */
export function PageHeader({ children, className, actions }: PageHeaderProps) {
  return (
    <div className={cn("flex-shrink-0 border-b border-white/10", className)}>
      <div className="flex h-16 items-center justify-between gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>
        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </div>
    </div>
  );
}
