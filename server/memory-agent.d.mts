type Env = Record<string, unknown>;

export interface ExtractedFact {
  text: string;
  category: "person" | "preference" | "routine" | "event" | "response_script" | "other";
  confidence: number;
}
export interface ExtractedTodo {
  text: string;
  due_hint: "today" | "tomorrow" | "this_week" | "unspecified";
  confidence: number;
}
export interface ExtractionResult {
  runtime: "daytona" | "direct" | "local-fallback" | "none";
  sandboxId?: string;
  reuse?: boolean;
  previewLink?: string;
  facts: ExtractedFact[];
  todos: ExtractedTodo[];
  dropped: Array<{ text: string; reason: string }>;
  steps: Array<Record<string, unknown>>;
}

export const EXTRACT_SYSTEM: string;
export function extractInSandbox(note: string, env?: Env): Promise<ExtractionResult>;
export function extractDirect(
  note: string,
  env?: Env,
  fetchImpl?: typeof fetch,
): Promise<ExtractionResult>;
export function memoryAgentHandler(env?: Env): (req: unknown, res: unknown) => Promise<void>;
export function handleMemoryExtract(
  request: Request,
  env?: Env,
  fetchImpl?: typeof fetch,
): Promise<Response>;
