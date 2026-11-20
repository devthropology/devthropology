import React from "react";

interface SyncLogFormatterProps {
  logMessage: string;
}

/**
 * A component that formats log messages with appropriate styling.
 * Handles both structured and unstructured log messages from the sync process.
 */
export const SyncLogFormatter: React.FC<SyncLogFormatterProps> = ({ logMessage }) => {
  // Apply styling based on the content
  let className = "text-gray-300";

  // Handle different types of log messages
  if (logMessage.includes("Starting sync")) {
    className = "text-blue-300";
  } else if (logMessage.includes("Starting backfill")) {
    className = "text-blue-400";
  } else if (logMessage.includes("Completed backfill")) {
    className = "text-green-400";
  } else if (logMessage.includes("Sync completed successfully")) {
    className = "text-green-400 font-semibold";
  } else if (logMessage.includes("Stream closing normally")) {
    className = "text-gray-400";
  } else if (logMessage.startsWith("Issue")) {
    className = "text-blue-400";
  } else if (logMessage.startsWith("Skipped")) {
    className = "text-yellow-400";
  } else if (logMessage.includes("User activity")) {
    className = "text-purple-400";
  } else if (logMessage.includes("Remaining API calls")) {
    className = "text-cyan-400";
  } else if (logMessage.includes("Records processed")) {
    className = "text-green-400 font-semibold";
  } else if (
    logMessage.includes("Error") ||
    logMessage.includes("error") ||
    logMessage.includes("failed")
  ) {
    className = "text-red-400";
  } else if (logMessage.includes("Connection to server lost")) {
    className = "text-red-500 font-semibold";
  }

  // Format the message with proper indentation
  return <pre className={`${className} whitespace-pre-wrap font-mono`}>{logMessage || ""}</pre>;
};

export default SyncLogFormatter;
