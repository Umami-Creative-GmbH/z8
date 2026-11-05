-- No backfill: a display name, operational geography or billing address is not
-- confirmed legal identity. An absent row represents an empty profile.
CREATE TABLE "organization_profile" (
  "organization_id" text PRIMARY KEY REFERENCES "organization"("id") ON DELETE CASCADE,
  "legal_company_name" text NOT NULL DEFAULT '',
  "address_line_1" text NOT NULL DEFAULT '',
  "address_line_2" text NOT NULL DEFAULT '',
  "postal_code" text NOT NULL DEFAULT '',
  "city" text NOT NULL DEFAULT '',
  "state_or_region" text NOT NULL DEFAULT '',
  "country" text NOT NULL DEFAULT '',
  "vat_id" text NOT NULL DEFAULT ''
);
