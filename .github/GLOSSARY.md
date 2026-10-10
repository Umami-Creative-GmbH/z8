# Delivery

Delivery verifies proposed Z8 changes, provides desktop installers for review, and prepares releases for publication.

## Language

**Release PR**:
The Z8 change proposal that collects staging changes for the next production release.
_Avoid_: Individual feature PR

**Unsigned review installer**:
A Z8 desktop installer supplied for testing and review without a verified publisher signature.
_Avoid_: Release, signed release candidate

**Signed release candidate**:
A Z8 desktop installer with a verified publisher signature, prepared for review before publication as a release.
_Avoid_: Unsigned review installer, published release
