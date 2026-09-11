-- Store server credentials (tokens) per agent, separate from config JSON
ALTER TABLE agents ADD COLUMN IF NOT EXISTS credentials JSONB NOT NULL DEFAULT '{}';
