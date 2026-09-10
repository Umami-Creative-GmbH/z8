-- Better Auth 1.7.3 identifies accounts by provider_id and account_id again.
-- Refuse ambiguous identities rather than choosing or merging a user's account.
DO $account_provider_key_check$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "account"
    GROUP BY "provider_id", "account_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate provider-scoped account identities; resolve trusted provider mappings before retrying';
  END IF;
END;
$account_provider_key_check$;
--> statement-breakpoint
DROP INDEX IF EXISTS "account_issuer_accountId_uidx";
--> statement-breakpoint
ALTER TABLE "account" DROP COLUMN IF EXISTS "issuer";
