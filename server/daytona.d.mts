type Env = Record<string, unknown>;

export interface SandboxRunResult {
  mode: "reuse" | "ephemeral";
  sandboxId: string;
  exitCode: number;
  result: string;
}

export class MissingDaytonaKeyError extends Error {
  code: "NO_DAYTONA_KEY";
}

export function getDaytonaClient(env: Env): Promise<unknown>;
export function acquireSandbox(
  daytona: unknown,
  env: Env,
): Promise<{
  sandbox: {
    id: string;
    process: { codeRun(code: string): Promise<{ exitCode: number; result: string }> };
  };
  reuse: boolean;
}>;
export function releaseSandbox(sandbox: unknown, reuse: boolean): Promise<void>;
export function runInSandbox(code: string, env?: Env): Promise<SandboxRunResult>;
export function daytonaHandler(env?: Env): (req: unknown, res: unknown) => Promise<void>;
