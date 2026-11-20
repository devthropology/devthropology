#!/usr/bin/env node
import { tsImport } from "tsx/esm/api";

// Resolve TypeScript and its loader from this installation, not the caller's cwd.
const { main } = await tsImport("./devthropology.ts", import.meta.url);
await main();
