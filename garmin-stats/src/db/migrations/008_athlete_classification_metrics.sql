ALTER TABLE user_settings
  ADD COLUMN current_easy_pace_sec_per_km INTEGER CHECK (current_easy_pace_sec_per_km IS NULL OR current_easy_pace_sec_per_km > 0),
  ADD COLUMN current_race_pace_sec_per_km INTEGER CHECK (current_race_pace_sec_per_km IS NULL OR current_race_pace_sec_per_km > 0),
  ADD COLUMN current_long_run_target_m INTEGER CHECK (current_long_run_target_m IS NULL OR current_long_run_target_m > 0);
