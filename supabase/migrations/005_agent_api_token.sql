ALTER TABLE agents ADD COLUMN IF NOT EXISTS api_token TEXT;
UPDATE agents SET api_token = gen_random_uuid()::TEXT WHERE api_token IS NULL;
ALTER TABLE agents ALTER COLUMN api_token SET NOT NULL;
ALTER TABLE agents ALTER COLUMN api_token SET DEFAULT gen_random_uuid()::TEXT;
