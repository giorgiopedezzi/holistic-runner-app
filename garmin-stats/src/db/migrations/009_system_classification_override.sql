ALTER TABLE activities
  ADD COLUMN system_classification TEXT,
  ADD COLUMN system_explanation TEXT,
  ADD COLUMN manual_classification TEXT;

UPDATE activities
SET
  system_classification = CASE
    WHEN classification_method = 'ai' AND ai_classification IS NOT NULL THEN ai_classification
    WHEN classification_method = 'statistical' AND statistical_classification IS NOT NULL THEN statistical_classification
    ELSE COALESCE(
      statistical_classification,
      ai_classification,
      CASE WHEN user_feedback = 'approved' THEN final_classification END
    )
  END,
  system_explanation = CASE
    WHEN classification_method = 'ai' AND ai_classification IS NOT NULL THEN ai_explanation
    WHEN classification_method = 'statistical' AND statistical_classification IS NOT NULL THEN statistical_explanation
    WHEN statistical_classification IS NOT NULL THEN statistical_explanation
    WHEN ai_classification IS NOT NULL THEN ai_explanation
    ELSE NULL
  END,
  manual_classification = CASE
    WHEN user_feedback = 'rejected' THEN final_classification
    ELSE NULL
  END;
