// Parsing rules adapted from @std/dotenv 0.225.5 (MIT), to preserve existing
// interpolation and quoting behavior without a Deno/JSR runtime dependency.
// Copyright 2018-2025 the Deno authors.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

import { readFile } from "node:fs/promises";
import { env } from "node:process";

const KEY_VALUE =
  /^\s*(?:export\s+)?(?<key>[^\s=#]+?)\s*=[ \t]*('\r?\n?(?<single>(.|\r\n|\n)*?)\r?\n?'|"\r?\n?(?<double>(.|\r\n|\n)*?)\r?\n?"|(?<unquoted>[^\r\n#]*)) *#*.*$/gm;
const EXPANSION =
  /(\${(?<braced>.+?)(:-(?<bracedDefault>.+))?}|(?<!\\)\$(?<bare>\w+)(:-(?<bareDefault>.+))?)/g;

/** Preserve file-first expansion, quoted literals, and forward references. */
export function parseEnv(
  text: string,
  environment: Record<string, string | undefined> = env,
): Record<string, string> {
  const parsed: Record<string, string> = Object.create(null);
  const unquotedKeys = new Set<string>();
  for (const match of text.matchAll(KEY_VALUE)) {
    const { key, single, double, unquoted } = match.groups!;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      console.warn(`Ignored invalid environment key: ${key}`);
      continue;
    }
    if (unquoted) unquotedKeys.add(key);
    parsed[key] =
      single !== undefined
        ? single
        : double !== undefined
          ? double.replace(
              /\\([nrt])/g,
              (_, char: string) => ({ n: "\n", r: "\r", t: "\t" })[char]!,
            )
          : unquoted.trim();
  }
  const expand = (value: string, resolving = new Set<string>()): string => {
    const expanded = value.replace(EXPANSION, (...args) => {
      const { braced, bare, bracedDefault, bareDefault } = args.at(-1);
      const key = braced || bare;
      const replacement = parsed[key] ?? environment[key];
      if (replacement === undefined) {
        // The previous loader stringifies a missing expansion as "undefined".
        return expand(bracedDefault || bareDefault || "undefined", resolving);
      }
      if (resolving.has(key)) {
        throw new Error("Cyclic environment variable expansion");
      }
      return expand(replacement, new Set([...resolving, key]));
    });
    return expanded !== value ? expand(expanded, resolving) : value;
  };
  // Expand against the original map, not partially expanded preceding entries.
  const result = { ...parsed };
  for (const key of unquotedKeys) result[key] = expand(parsed[key]);
  return result;
}

/** Load the repository .env without overriding existing variables. Explicit paths remain caller-relative. */
export async function loadEnv(
  path: string | URL = new URL("../../.env", import.meta.url),
): Promise<void> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (env[key] === undefined) env[key] = value;
  }
}
