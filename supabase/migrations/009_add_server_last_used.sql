-- Migration 009: Add server_last_used JSONB column to agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS server_last_used JSONB NOT NULL DEFAULT '{}';
