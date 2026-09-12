// ── AI provider adapter (HRA-325) ─────────────────────────────────────────
// The one place the backend calls the configured external AI provider for
// plan-template generation, so every later Story (prompt composition, AI
// DSL generation) reuses one tested transport instead of each reinventing
// it. Plain `fetch`, no new runtime dependency — same external-API pattern
// as integrations/ollama.ts, but with Bearer auth against a chat-completions
// style endpoint (PLAN_TEMPLATE_AI_ENDPOINT/_API_KEY/_MODEL env vars).
//
// Out of scope here: the prompt content itself and DSL validation of the
// result — this module only sends {model, messages} and returns the
// assistant's raw text content.

import { loadConfig, requirePlanTemplateAiConfig } from "../config.ts";

// Backend timeout enforced on every call (AC: "a backend timeout is
// enforced and returns a controlled timeout error, not a hang"). Exported
// so tests can assert against the real value instead of a duplicated magic
// number.
export const TIMEOUT_MS = 30_000;

export type PlanTemplateAiErrorCode =
  | "missing-config"
  | "auth"
  | "rate-limit"
  | "timeout"
  | "network"
  | "http-error"
  | "empty-response"
  | "malformed-response";

// Distinguishable error codes (AC) instead of one generic "failed" — never
// interpolates the API key into `message` (AC: key never appears in a
// thrown error).
export class PlanTemplateAiError extends Error {
  readonly code: PlanTemplateAiErrorCode;
  constructor(code: PlanTemplateAiErrorCode, message: string) {
    super(message);
    this.name = "PlanTemplateAiError";
    this.code = code;
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: unknown } }[];
}

// Strips exactly one accidental outer markdown code fence (```lang\n...\n```
// or plain ```...```), leaving inner fences (e.g. inside an explanation)
// untouched.
function stripOuterCodeFence(text: string): string {
  const match = /^```[^\n]*\n([\s\S]*)\n```$/.exec(text.trim());
  return match ? match[1] : text;
}

export async function generatePlanTemplate(messages: ChatMessage[]): Promise<string> {
  let endpoint: string, apiKey: string, model: string;
  try {
    ({ endpoint, apiKey, model } = requirePlanTemplateAiConfig(loadConfig()));
  } catch {
    // AC: missing config is a controlled error, never a crash, and no
    // request is attempted — the original message is discarded since it
    // names which env var is missing, which is operator detail, not an
    // end-user-facing reason.
    throw new PlanTemplateAiError("missing-config", "AI generation unavailable");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages }),
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new PlanTemplateAiError("timeout", `AI provider request timed out after ${TIMEOUT_MS}ms`);
    }
    throw new PlanTemplateAiError("network", "AI provider unreachable");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new PlanTemplateAiError("auth", "AI provider rejected the configured API key");
    }
    if (res.status === 429) {
      throw new PlanTemplateAiError("rate-limit", "AI provider rate limit exceeded");
    }
    throw new PlanTemplateAiError("http-error", `AI provider returned HTTP ${res.status}`);
  }

  let data: ChatCompletionResponse;
  try {
    data = await res.json() as ChatCompletionResponse;
  } catch {
    throw new PlanTemplateAiError("malformed-response", "AI provider returned non-JSON output");
  }

  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new PlanTemplateAiError("malformed-response", "AI provider response is missing assistant content");
  }

  const stripped = stripOuterCodeFence(content).trim();
  if (stripped.length === 0) {
    throw new PlanTemplateAiError("empty-response", "AI provider returned an empty response");
  }

  return stripped;
}
