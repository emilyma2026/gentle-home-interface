export function confirmedLiveFacts(state: Record<string, unknown>): Array<{ id: string; text: string; question: string }>;
export function handleLiveRequest(request: Request, env?: Record<string, unknown>, fetchImpl?: typeof fetch): Promise<Response>;
