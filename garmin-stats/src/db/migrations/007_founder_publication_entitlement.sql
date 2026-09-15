-- HRA-360: publication is opt-in and controlled exclusively by an explicit
-- entitlement. Existing ordinary users receive nothing; the deterministic
-- founder receives the initial MVP capability idempotently.
INSERT INTO users (id)
VALUES ('00000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_entitlements (user_id, entitlement)
VALUES ('00000000-0000-4000-8000-000000000001', 'can_publish_profile')
ON CONFLICT (user_id, entitlement) DO NOTHING;
