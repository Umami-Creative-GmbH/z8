# Organization profile and AVV

Status: design confirmed. Implementation has not started.

Published specification: [GitHub issue #1563](https://github.com/Umami-Creative-GmbH/z8/issues/1563).

Implementation tickets:

1. [Maintain the organization legal profile #1566](https://github.com/Umami-Creative-GmbH/z8/issues/1566).
2. [Use the profile in AVV settings and downloads #1567](https://github.com/Umami-Creative-GmbH/z8/issues/1567), blocked by #1566.

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
