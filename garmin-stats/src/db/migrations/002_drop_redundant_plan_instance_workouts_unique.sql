-- plan_instance_workouts already enforces (instance_id, workout_id) uniqueness via its
-- PRIMARY KEY. The additional DEFERRABLE UNIQUE constraint on the same columns duplicated
-- that guarantee and made ON CONFLICT (instance_id, workout_id) ambiguous: Postgres refuses
-- to use a deferrable constraint as an upsert arbiter, so every plan-instance day upsert
-- failed with "ON CONFLICT does not support deferrable unique constraints/exclusion
-- constraints as arbiters". The deferred-constraint requirement for slot swaps belongs to
-- plan_instance_days (see its own DEFERRABLE UNIQUE), not to plan_instance_workouts.
ALTER TABLE plan_instance_workouts
  DROP CONSTRAINT plan_instance_workouts_instance_id_workout_id_key;
