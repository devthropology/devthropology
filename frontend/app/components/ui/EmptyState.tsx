import React from "react";

interface EmptyStateProps {
  message: string;
  className?: string;
}

export function EmptyState({ message, className = "" }: EmptyStateProps) {
  return (
    <div className={`flex justify-center p-4 ${className}`}>
      <p className="text-gray-300">{message}</p>
    </div>
  );
}
