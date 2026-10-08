#!/usr/bin/env node
import { register } from "tsx/esm/api";

register();
const { afkLoop } = await import("../loop/cli.ts");
try {
  await afkLoop(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
