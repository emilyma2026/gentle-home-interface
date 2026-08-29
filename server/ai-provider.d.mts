export { pickProvider, runAI } from "./ai-runtime.mjs";

export function loadDotEnv(base?: string): Record<string, string>;
export function serverEnv(base?: string): Record<string, string | undefined>;
export function aiHandler(
  env?: Record<string, string | undefined>,
): (request: unknown, response: unknown) => Promise<void>;
