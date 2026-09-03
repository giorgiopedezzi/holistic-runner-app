/**
 * controllers/feedback.controller.ts
 * HTTP boundary for anonymous visitor feedback (HRA-226). Owns input
 * validation; persists via the repo directly (no service — same pattern as
 * date-ranges.controller.ts).
 */
import type { AppContext, Handler } from "../http/context.ts";
import { send } from "../http/respond.ts";
import { readJsonBody } from "../http/request.ts";
import { unprocessable } from "../http/problem.ts";

const PRICING_CHOICES = ["free_only", "3_5", "8_12", "15_plus"] as const;
const FEATURE_INTERESTS = ["multi_user_coach", "shared_groups", "curated_content_feed"] as const;
const APP_TYPE_CHOICES = ["cloud", "desktop"] as const;

type Body = Partial<{
  free_text: string;
  pricing_choice: string;
  pricing_why_not_free_text: string;
  feature_interest: string[];
  feature_interest_other_free_text: string;
  app_type_choice: string;
}>;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function createFeedbackController(ctx: AppContext) {
  const repo = ctx.repos.feedback;

  const create: Handler = async (req, res) => {
    const body = await readJsonBody<Body>(req);

    const hasFreeText = isNonEmptyString(body.free_text);
    const hasPricing = isNonEmptyString(body.pricing_choice);
    const hasPricingWhyNot = isNonEmptyString(body.pricing_why_not_free_text);
    const hasFeatureInterest = Array.isArray(body.feature_interest) && body.feature_interest.length > 0;
    const hasFeatureOther = isNonEmptyString(body.feature_interest_other_free_text);
    const hasAppType = isNonEmptyString(body.app_type_choice);

    if (!hasFreeText && !hasPricing && !hasPricingWhyNot && !hasFeatureInterest && !hasFeatureOther && !hasAppType) {
      throw unprocessable("At least one of free_text, pricing_choice, pricing_why_not_free_text, feature_interest, feature_interest_other_free_text, or app_type_choice must be provided.");
    }

    if (hasPricing && !PRICING_CHOICES.includes(body.pricing_choice as typeof PRICING_CHOICES[number])) {
      throw unprocessable(`pricing_choice must be one of: ${PRICING_CHOICES.join(", ")}.`);
    }

    if (hasFeatureInterest) {
      const invalid = (body.feature_interest as string[]).find(v => !FEATURE_INTERESTS.includes(v as typeof FEATURE_INTERESTS[number]));
      if (invalid) throw unprocessable(`feature_interest entries must be one of: ${FEATURE_INTERESTS.join(", ")}. Got "${invalid}".`);
    }

    if (hasAppType && !APP_TYPE_CHOICES.includes(body.app_type_choice as typeof APP_TYPE_CHOICES[number])) {
      throw unprocessable(`app_type_choice must be one of: ${APP_TYPE_CHOICES.join(", ")}.`);
    }

    const row = repo.create({
      freeText: hasFreeText ? body.free_text!.trim() : null,
      pricingChoice: hasPricing ? body.pricing_choice! : null,
      pricingWhyNotFreeText: hasPricingWhyNot ? body.pricing_why_not_free_text!.trim() : null,
      featureInterest: hasFeatureInterest ? body.feature_interest! : null,
      featureInterestOtherFreeText: hasFeatureOther ? body.feature_interest_other_free_text!.trim() : null,
      appTypeChoice: hasAppType ? body.app_type_choice! : null,
    });

    return send(res, row, 201);
  };

  return { create };
}
