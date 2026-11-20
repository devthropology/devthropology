export function isTransientDatabaseConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    if (typeof error === "string") {
      return (
        error.includes("connect ECONNREFUSED") ||
        error.includes("the database system is starting up") ||
        error.includes("the database system is not yet accepting connections")
      );
    }
    return false;
  }

  const err = error as {
    code?: string;
    message?: string;
    cause?: unknown;
  };

  return (
    (typeof err.code === "string" &&
      ([
        "ECONNREFUSED",
        "ECONNRESET",
        "ETIMEDOUT",
        "EPIPE",
        "ENOTFOUND",
        "EAI_AGAIN",
        "CONNECT_TIMEOUT",
        "CONNECTION_CLOSED",
        "CONNECTION_ENDED",
        "CONNECTION_DESTROYED",
        "57P01",
        "57P02",
        "57P03",
        "53300",
      ].includes(err.code) ||
        // SQLSTATE class 08: connection exceptions.
        /^08[A-Z0-9]{3}$/.test(err.code))) ||
    err.message?.includes("connect ECONNREFUSED") === true ||
    err.message?.includes("the database system is starting up") === true ||
    err.message?.includes(
      "the database system is not yet accepting connections",
    ) === true ||
    isTransientDatabaseConnectionError(err.cause)
  );
}
