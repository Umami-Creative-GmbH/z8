---
status: accepted
---

# AVVs use the current organization profile

The organization profile owns the legal identity and registered address of the
single legal entity an organization represents. AVV settings read that shared
profile and each PDF download uses its current values; AVV-specific copies would
create a second place to maintain the same identity. The display name remains
separate because the name employees recognize need not identify the legal party.

We retain generation on download rather than introducing stored agreement
versions, acceptance or signatures as part of the profile feature. Consequently,
changing the profile changes future downloads, and Z8 cannot reconstruct an old
download from the current profile alone. A future agreement-acceptance feature
would need its own historical record rather than treating this live profile as
evidence of what a party previously accepted.

The [organization profile reference](../../../../../../../docs/refs/organization-profile.md)
records the confirmed field, validation and access rules.
