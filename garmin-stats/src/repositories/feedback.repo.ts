/**
 * repositories/feedback.repo.ts
 * Data access for anonymous visitor feedback (HRA-226) — a write-only insert,
 * no list/read route exists (out of scope for this Story).
 */
import type { DatabaseSync } from "node:sqlite";
import type { FeedbackRow } from "../db.ts";

export interface NewFeedback {
  freeText: string | null;
  pricingChoice: string | null;
  pricingWhyNotFreeText: string | null;
  featureInterest: string[] | null;
  featureInterestOtherFreeText: string | null;
}

export function createFeedbackRepo(db: DatabaseSync) {
  const insert = db.prepare(`
    INSERT INTO feedback (free_text, pricing_choice, pricing_why_not_free_text, feature_interest, feature_interest_other_free_text)
    VALUES ($free_text, $pricing_choice, $pricing_why_not_free_text, $feature_interest, $feature_interest_other_free_text)
  `);
  const findById = db.prepare("SELECT * FROM feedback WHERE id = ?");

  return {
    create: (f: NewFeedback): FeedbackRow => {
      const info = insert.run({
        $free_text: f.freeText,
        $pricing_choice: f.pricingChoice,
        $pricing_why_not_free_text: f.pricingWhyNotFreeText,
        $feature_interest: f.featureInterest ? JSON.stringify(f.featureInterest) : null,
        $feature_interest_other_free_text: f.featureInterestOtherFreeText,
      });
      return findById.get(Number(info.lastInsertRowid)) as unknown as FeedbackRow;
    },
  };
}

export type FeedbackRepo = ReturnType<typeof createFeedbackRepo>;
