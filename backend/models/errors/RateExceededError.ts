export class RateExceededError extends Error {
  constructor(headerReset: string) {
    super(
      `Rate limit exceeded, reset at ${new Date(
        (headerReset as unknown as number) * 1000,
      ).toLocaleTimeString()}`,
    );
  }
}
