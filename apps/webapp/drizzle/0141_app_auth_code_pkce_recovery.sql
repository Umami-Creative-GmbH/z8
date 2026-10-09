-- Recover the PKCE column declared in the schema but absent from the SQL chain.
-- Legacy codes stay NULL and cannot be exchanged without a stored challenge.
ALTER TABLE "public"."app_auth_code"
  ADD COLUMN IF NOT EXISTS "code_challenge" text;
