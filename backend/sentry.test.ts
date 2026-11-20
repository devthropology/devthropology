import { test } from "vitest";
import { strictEqual } from "node:assert/strict";
import process from "node:process";
import { runCommand } from "./util/runCommand.ts";

test("Sentry cannot consume startup or fatal errors while its transport is stalled", async () => {
  // Real Node SDK/event dispatch in child processes. Telemetry stays on loopback.
  for (const event of ["unhandledRejection", "uncaughtException"]) {
    for (const startup of [true, false]) {
      const result = await runCommand(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          `
          import { strictEqual } from "node:assert/strict";
          import { createServer } from "node:http";
          import { once } from "node:events";
          import process from "node:process";
          import { initSentry, captureException, flushSentry } from ${JSON.stringify(
            new URL("./sentry.ts", import.meta.url).href,
          )};
          import { isTransientDatabaseConnectionError } from ${JSON.stringify(
            new URL(
              "./util/isTransientDatabaseConnectionError.ts",
              import.meta.url,
            ).href,
          )};

          // A swallowed error or unbounded flush must fail, not hang CI.
          setTimeout(() => process.exit(99), 5000);
          let transportStarted;
          const stalled = new Promise(resolve => { transportStarted = resolve; });
          const server = createServer((request, _response) => {
            request.resume();
            transportStarted();
            // Intentionally never respond: exercise the real HTTP transport.
          });
          server.listen(0, "127.0.0.1");
          await once(server, "listening");
          process.env.SENTRY_DSN =
            "http://public@127.0.0.1:" + server.address().port + "/1";

          const rejectionListeners = process.listenerCount("unhandledRejection");
          const exceptionListeners = process.listenerCount("uncaughtException");
          initSentry();
          strictEqual(process.listenerCount("unhandledRejection"), rejectionListeners);
          strictEqual(process.listenerCount("uncaughtException"), exceptionListeners);
          captureException(new Error("keep the transport busy"));
          await stalled;

          process.on(${JSON.stringify(event)}, (reason) => {
            void (async () => {
              const suppressed = isTransientDatabaseConnectionError(reason);
              strictEqual(suppressed, ${startup});
              if (!suppressed) {
                captureException(reason);
                await flushSentry(25);
              }
              process.exit(suppressed ? 18 : 17);
            })().catch((error) => {
              process.stderr.write(String(error));
              process.exit(98);
            });
          });
          setTimeout(() => {
            const error = ${startup}
              ? Object.assign(new Error("database starting"), { code: "57P03" })
              : new Error("fatal sentinel");
            if (${JSON.stringify(event)} === "unhandledRejection") {
              void Promise.reject(error);
            } else {
              throw error;
            }
          }, 0);
        `,
        ],
        {
          env: { SENTRY_TRACES_SAMPLE_RATE: "0" },
        },
      );
      strictEqual(
        result.code,
        startup ? 18 : 17,
        result.stdout + result.stderr,
      );
    }
  }
});
