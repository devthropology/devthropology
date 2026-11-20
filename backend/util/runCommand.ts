import { spawn } from "node:child_process";
import { env } from "node:process";

/** Run without a shell, inheriting the environment and capturing text output. */
export function runCommand(
  command: string,
  args: string[],
  options: { env?: Record<string, string>; discardStdout?: boolean } = {},
): Promise<{
  code: number | null;
  signal: string | null;
  success: boolean;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...env, ...options.env },
      // Drain both output streams even when stdout is discarded.
      stdio: "pipe",
    });
    child.stdin.end();
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      if (!options.discardStdout) stdout += chunk;
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    // Wait for closed streams, not just process exit, to retain all output.
    child.once("close", (code, signal) => {
      resolve({ code, signal, success: code === 0, stdout, stderr });
    });
  });
}
