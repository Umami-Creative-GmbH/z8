-- MCP server (#795): the key request log records whether a request came
-- through the Public API (`api`) or the MCP server (`mcp`). Every earlier
-- row is a Public API request.
ALTER TABLE "public_api_request_log" ADD COLUMN IF NOT EXISTS "channel" text DEFAULT 'api' NOT NULL;--> statement-breakpoint
ALTER TABLE "public_api_request_log" DROP CONSTRAINT IF EXISTS "public_api_request_log_channel_check";--> statement-breakpoint
ALTER TABLE "public_api_request_log" ADD CONSTRAINT "public_api_request_log_channel_check" CHECK ("channel" in ('api', 'mcp'));
