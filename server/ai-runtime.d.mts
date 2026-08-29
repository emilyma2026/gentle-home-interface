export type AIEnvironment = Record<string, unknown>;

export interface AIInput {
  system?: string;
  user: string;
  json?: boolean;
}

export interface AIOutput {
  provider: "gemini" | "openai";
  model: string;
  text: string;
}

export function pickProvider(
  env?: AIEnvironment,
): { name: "gemini" | "openai"; key: string; model: string } | null;

export function runAI(
  input: AIInput,
  env?: AIEnvironment,
  fetchImpl?: typeof fetch,
): Promise<AIOutput>;

export function handleAIRequest(
  request: Request,
  env?: AIEnvironment,
  fetchImpl?: typeof fetch,
): Promise<Response>;
