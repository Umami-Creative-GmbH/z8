# Organization profile and AVV

Status: profile persistence, authenticated settings actions and the organization-settings
editor are implemented in #1566. AVV settings, current-profile download preparation,
country-aware readiness and structured PDF party details are implemented in #1567.

Published specification: [GitHub issue #1563](https://github.com/Umami-Creative-GmbH/z8/issues/1563).

Implementation tickets:

1. [Maintain the organization legal profile #1566](https://github.com/Umami-Creative-GmbH/z8/issues/1566).
2. [Use the profile in AVV settings and downloads #1567](https://github.com/Umami-Creative-GmbH/z8/issues/1567), blocked by #1566.

## Profile implementation

- One optional `organization_profile` row belongs to each organization. An absent
  row reads as eight empty strings; no existing metadata is backfilled.
- Organization settings load and save through `getOrganizationProfile` and
  `saveOrganizationProfile` in `settings/organizations/profile-actions.ts`. Both
  require an approved, active owner/admin and reject any requested organization
  ID that differs from the authenticated session's active organization.
- Saves replace the eight profile fields only. Empty and partial profiles are
  valid, with omitted fields saved as empty values. Text is trimmed, country and
  VAT codes are uppercased, and supplied values have length/type/control-character
  checks. VAT IDs use a two-letter
  prefix followed by 2–14 letters or digits; this is a format check only.
- The registered-address country is selected independently of operational
  country/region. The profile has no billing deployment gate or Stripe writes.
- Authenticated-action integration tests use disposable PostgreSQL and real
  permissions, validation and tenant filtering. Form tests exercise editing,
  accessible errors, pending state and save feedback.
- Unsaved edits trigger the browser's native leave/reload warning. Reverting
  edits removes the warning; a successful save adopts the normalized saved
  profile as the new baseline. Failed saves retain protection.

## Confirmed scope

- Each Z8 organization represents one legal entity with one registered address.
- The existing organization name remains its display name. A separate legal
  company name identifies the organization in its AVV.
- A shared organization profile owns these details. The AVV is its first
  consumer; subscription billing synchronization and other document integrations
  are separate work.
- Office locations are separate from the registered address.
- Registered-address country and region describe legal identity only. Editing
  them does not change timezone, holiday settings, work policies or Stripe
  billing details.
- The profile is available in every deployment. AVV settings retain their
  existing billing-enabled restriction.

## Profile fields

- Legal company name
- Address line 1
- Address line 2
- Postal code
- City
- State or region
- Country
- VAT ID

Contact details, company registration numbers and representatives are outside
this first release.

## Editing and access

- Organization owners and admins can edit the profile.
- Organization settings are the single place to maintain the profile.
- AVV settings show the profile and link back to organization settings for edits.
- Reads and writes are scoped to the active organization and enforce its
  permissions.

## Completeness and validation

- A partial profile can be saved.
- AVV download requires legal company name, address line 1, city, country and a
  postal code where applicable for that country.
- VAT ID, address line 2 and state or region are optional.
- Existing organizations continue to work with an incomplete profile. AVV
  settings explain what is missing and link to the profile editor.
- Existing organizations start with empty legal-profile fields. Neither the
  display name nor Stripe billing details are treated as confirmed legal data;
  an owner or admin must provide the profile.
- VAT IDs receive basic format checks with clear errors. There is no external
  VAT verification in this release, and the UI must not imply verification.

## AVV behavior

- AVV settings and the PDF show the legal company name and full registered
  address, plus VAT ID when supplied. Empty optional fields are omitted.
- Each download generates a fresh PDF using the current profile. A profile
  change affects future downloads.
- Acceptance, signatures and stored document versions are separate work.
- `lib/avv/profile.ts` owns the shared readiness rule and address presentation.
  Postal applicability is explicit for each country offered by the profile editor;
  Germany requires a postal code, while Hong Kong does not. The documented country
  policy uses Google's libaddressinput address-format metadata and conservatively
  requires a code for new or unknown countries.
- AVV settings load through the same authenticated profile action as the editor.
  Each download calls `settings/avv/actions.ts` to recheck billing availability,
  current owner/admin authorization, active-organization scope and the latest
  persisted profile. A stale page cannot bypass missing details or revoked access.
- The public PDF exporter accepts the structured profile and refuses invalid or
  incomplete party details. Empty optional rows and labels are omitted. Party
  boxes grow with wrapped text, and fixed footers show actual page totals as the
  agreement flows across pages. Existing agreement wording, processor details and
  conditional subprocessor disclosures are retained.
- Controller details use self-hosted, subset-embedded Noto Sans and Droid Sans
  Fallback fonts for Latin, Greek, Cyrillic, Chinese and Japanese text. Font
  loading stays behind the PDF export's lazy import; the Chinese/Japanese
  fallback is loaded only when needed. Font sources, licenses and checksums are
  recorded in `apps/webapp/public/fonts/avv/README.md`.
- Font coverage is bounded. If a supplied character cannot render, export fails
  with its Unicode code point and a support message instead of silently changing
  the legal identity. This does not restrict profile validation or alter saved
  text. Additional scripts require licensed font coverage and render review.

## Verification

- The authenticated profile integration suite covers save-to-AVV preparation,
  changed and cleared addresses, whitespace, postal applicability, revoked admin
  access, tenant boundaries and billing-enabled/disabled deployments against
  disposable PostgreSQL.
- Page and button tests cover visible legal details, missing-field explanations,
  editor navigation, optional values, readiness changes, permissions, deployment
  gates and current-profile downloads from stale pages.
- Public exporter tests cover minimal and full profiles, VAT, different legal and
  display names, absent optional details, changed addresses and maximum-length
  party details. Minimal/full/long PDFs were rendered and reviewed on all pages,
  including text bounds, overlap and page footers.
- Unicode exporter regressions read actual embedded-font mappings with PDF.js,
  checking Cyrillic, Japanese and Chinese legal names and every address row,
  repeated downloads across scripts and explicit unsupported-character errors.

## Acceptance scenarios

1. Employees see the display name "Umami" while the AVV identifies "Umami
   Creative GmbH" and its registered address.
2. An owner or admin saves an incomplete profile. Normal organization use
   continues; AVV download explains the missing details and links to the editor.
3. A profile with all required identity and address fields permits AVV download
   without a VAT ID. The PDF has no empty optional-field labels or blank rows.
4. A supplied VAT ID appears in AVV settings and the PDF after basic format
   validation, without a verified claim.
5. An owner or admin changes the registered address. The next AVV download uses
   the new address; operational geography and Stripe billing details are
   unaffected.
6. An actor cannot read or change another organization's profile by supplying
   its ID. Editing requires owner or admin permissions in the active organization.
7. In a billing-disabled deployment the profile remains available, while AVV
   settings retain their existing restriction.

## Decision record

- [AVVs use the current organization profile](../../apps/webapp/src/lib/organization/docs/adr/0009-avv-uses-current-organization-profile.md): why a downloaded AVV reflects current master data rather than a stored agreement version.
