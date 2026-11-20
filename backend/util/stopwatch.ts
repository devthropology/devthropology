import prettyMilliseconds from "pretty-ms";

export class Stopwatch {
  private timestamps: Map<string, number> = new Map();
  private durations: Map<string, number> = new Map();
  private currentOperation: string | null = null;
  private readonly startTimestamp: number;

  constructor() {
    this.startTimestamp = Date.now();
  }

  start(operation: string): void {
    const now = Date.now();
    if (this.currentOperation !== null) {
      this.end(this.currentOperation);
    }
    this.currentOperation = operation;
    this.timestamps.set(operation, now);
  }

  end(operation: string): void {
    const now = Date.now();
    if (this.timestamps.has(operation)) {
      const startTime = this.timestamps.get(operation)!;
      this.durations.set(operation, now - startTime);
    }
    this.currentOperation = null;
  }

  print(
    name: string,
    logger: (...args: unknown[]) => void = console.log,
    formatDuration: (durationMs: number) => string = (durationMs) =>
      prettyMilliseconds(durationMs),
  ): void {
    if (this.currentOperation !== null) {
      this.end(this.currentOperation);
    }

    const totalElapsed = Date.now() - this.startTimestamp;
    this.durations.set("Total", totalElapsed);
    const lines: string[] = [];
    lines.push(`${name}:`);

    // Get the longest operation name for tab calculations
    let longestKeyLength = 0;
    this.durations.forEach((_, key) => {
      if (key.length > longestKeyLength) longestKeyLength = key.length;
    });

    const spacesBetween = longestKeyLength + 4; // add 2 more spaces for better readability
    this.durations.forEach((value, key) => {
      const msg = `  ${key}${" ".repeat(spacesBetween - key.length)}${formatDuration(
        value,
      )}`;
      lines.push(msg);
    });

    logger(lines.join("\n"));
  }
}
