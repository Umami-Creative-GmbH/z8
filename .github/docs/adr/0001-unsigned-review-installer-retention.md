---
status: accepted
---

# Unsigned review installers have limited history and availability

Z8 supplies unsigned desktop installers for review; they are separate from signed release candidates and published releases. Keep the newest five unsigned review installers across the repository, plus the newest installer for every open PR. This is a soft count limit: concurrent PRs may require more than five installers.

All unsigned review installers expire after 14 days, including the protected newest installer of a quiet open PR. Protection preserves access during normal review without making CI an indefinite download archive. A PR inactive for longer than 14 days may need a new build. Old installer deletion cannot be reversed, so the longer review window is worth the small extra storage. Signed release candidates and published releases are outside this policy.

The user accepted these recommendations during the CI policy interview on 2026-10-10. The policy is agreed; cleanup and upload retention changes are not yet implemented.
