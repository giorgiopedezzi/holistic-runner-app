/**
 * FeedbackTab.tsx (HRA-226)
 * One page, one form, one Submit — three independently-optional sections:
 * free-text feedback, a pricing poll, and a feature-interest poll. Anonymous
 * (no visitor identity captured), reachable even in DEMO_MODE (the backend
 * route is deliberately exempt from demoGuarded() — see http/router.ts).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { Card, Checkbox, Label } from "@/components/ui";
import type { PricingChoice, FeatureInterest } from "@/types/api";
import { notify } from "@/utils/toast";

const PRICING_OPTIONS: { value: PricingChoice; labelKey: string; fallback: string }[] = [
  { value: "free_only", labelKey: "feedback.pricing.freeOnly", fallback: "Free only" },
  { value: "3_5",       labelKey: "feedback.pricing.3to5",     fallback: "$3–5/mo" },
  { value: "8_12",      labelKey: "feedback.pricing.8to12",    fallback: "$8–12/mo" },
  { value: "15_plus",   labelKey: "feedback.pricing.15plus",   fallback: "$15+/mo (if coach features included)" },
];

const FEATURE_OPTIONS: { value: FeatureInterest; labelKey: string; fallback: string }[] = [
  { value: "multi_user_coach", labelKey: "feedback.features.multiUserCoach", fallback: "Multi-user/coach mode" },
  { value: "shared_groups",    labelKey: "feedback.features.sharedGroups",   fallback: "Shared groups" },
];

export function FeedbackTab() {
  const { t } = useTranslation();
  const [freeText, setFreeText] = useState("");
  const [pricingChoice, setPricingChoice] = useState<PricingChoice | null>(null);
  const [pricingWhyNot, setPricingWhyNot] = useState("");
  const [featureInterest, setFeatureInterest] = useState<FeatureInterest[]>([]);
  const [featureOther, setFeatureOther] = useState(false);
  const [featureOtherText, setFeatureOtherText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function toggleFeature(value: FeatureInterest, checked: boolean) {
    setFeatureInterest(prev => checked ? [...prev, value] : prev.filter(v => v !== value));
  }

  const hasAnything = freeText.trim().length > 0 || pricingChoice != null
    || featureInterest.length > 0 || (featureOther && featureOtherText.trim().length > 0);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await api.feedback.submit({
        free_text: freeText.trim() || undefined,
        pricing_choice: pricingChoice ?? undefined,
        pricing_why_not_free_text: pricingChoice === "free_only" ? (pricingWhyNot.trim() || undefined) : undefined,
        feature_interest: featureInterest.length > 0 ? featureInterest : undefined,
        feature_interest_other_free_text: featureOther ? (featureOtherText.trim() || undefined) : undefined,
      });
      setFreeText("");
      setPricingChoice(null);
      setPricingWhyNot("");
      setFeatureInterest([]);
      setFeatureOther(false);
      setFeatureOtherText("");
      notify(t("feedback.submitSuccess", "Thanks for the feedback!"), "success");
    } catch (e) {
      notify(e instanceof Error ? e.message : t("feedback.submitFailed", "Failed to submit feedback"), "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mb-4">
      <div className="hra-block-title mb-1">{t("nav.feedback", "Feedback")}</div>
      <div className="hra-text-secondary text-meta mb-4">
        {t("feedback.intro", "Tell us whether you'd pay for this app and what you'd want — at least one response below is required.")}
      </div>

      <div className="mb-5">
        <Label className="mb-1.5">{t("feedback.freeTextLabel", "General feedback")}</Label>
        <textarea
          value={freeText}
          onChange={e => setFreeText(e.target.value)}
          placeholder={t("feedback.freeTextPlaceholder", "What do you think of the app?")}
          rows={4}
          className="hra-border-strong hra-bg-card hra-text-primary w-full rounded-md p-2.5 text-body"
        />
      </div>

      <div className="mb-5">
        <Label className="mb-1.5">{t("feedback.pricingLabel", "Would you pay for this app?")}</Label>
        <div className="flex flex-col gap-2">
          {PRICING_OPTIONS.map(opt => (
            <label key={opt.value} className="flex items-center gap-2 text-body cursor-pointer">
              <input
                type="radio"
                name="pricing_choice"
                value={opt.value}
                checked={pricingChoice === opt.value}
                onChange={() => setPricingChoice(opt.value)}
              />
              {t(opt.labelKey, opt.fallback)}
            </label>
          ))}
        </div>
        {pricingChoice === "free_only" && (
          <input
            type="text"
            value={pricingWhyNot}
            onChange={e => setPricingWhyNot(e.target.value)}
            placeholder={t("feedback.pricingWhyNotPlaceholder", "Why wouldn't you pay? (optional)")}
            className="hra-border-strong hra-bg-card hra-text-primary w-full rounded-md p-2 mt-2 text-body"
          />
        )}
      </div>

      <div className="mb-5">
        <Label className="mb-1.5">{t("feedback.featuresLabel", "Which features interest you?")}</Label>
        <div className="flex flex-col gap-2">
          {FEATURE_OPTIONS.map(opt => (
            <label key={opt.value} className="flex items-center gap-2 text-body cursor-pointer">
              <Checkbox
                checked={featureInterest.includes(opt.value)}
                onCheckedChange={checked => toggleFeature(opt.value, checked)}
              />
              {t(opt.labelKey, opt.fallback)}
            </label>
          ))}
          <label className="flex items-center gap-2 text-body cursor-pointer">
            <Checkbox checked={featureOther} onCheckedChange={setFeatureOther} />
            {t("feedback.features.other", "Other")}
          </label>
        </div>
        {featureOther && (
          <input
            type="text"
            value={featureOtherText}
            onChange={e => setFeatureOtherText(e.target.value)}
            placeholder={t("feedback.featureOtherPlaceholder", "What else would you want? (optional)")}
            className="hra-border-strong hra-bg-card hra-text-primary w-full rounded-md p-2 mt-2 text-body"
          />
        )}
      </div>

      <button
        className="hra-btn"
        data-variant="cta"
        data-tone="green"
        onClick={handleSubmit}
        disabled={!hasAnything || submitting}
      >
        {submitting ? t("feedback.submittingEllipsis", "Submitting…") : t("feedback.submit", "Submit")}
      </button>
    </Card>
  );
}
