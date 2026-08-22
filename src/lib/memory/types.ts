export const FACT_CATEGORIES = [
  "person",
  "preference",
  "routine",
  "event",
  "response_script",
  "other",
] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

export type FactStatus = "pending" | "active" | "stale" | "rejected";

export type ExtractionSource = "family_note" | "elder_chat";

export interface FamilyFact {
  id: string;
  family_id: string;
  category: FactCategory;
  text: string;
  status: FactStatus;
  confidence: number;
  is_core: boolean;
  source: "manual" | "extracted";
  source_note: string | null;
  origin: ExtractionSource;
  created_at: string;
  updated_at: string;
}

export interface MatchedFact {
  id: string;
  text: string;
  category: FactCategory;
  confidence: number;
  is_core: boolean;
  similarity: number;
}

export const DUE_HINTS = ["today", "tomorrow", "this_week", "unspecified"] as const;
export type DueHint = (typeof DUE_HINTS)[number];

export type TodoStatus = "pending" | "active" | "done" | "rejected";

export interface FamilyTodo {
  id: string;
  family_id: string;
  text: string;
  status: TodoStatus;
  due_hint: DueHint;
  source: "manual" | "extracted";
  source_note: string | null;
  origin: ExtractionSource;
  created_at: string;
  updated_at: string;
}
