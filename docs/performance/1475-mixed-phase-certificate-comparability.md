# Mixed phase certificate comparability

Original and HEAD have independently qualified source configurations. Their clock review/build references, Original temporary-value profile and request-shape configuration can differ. The compiled annual action also has distinct build, manifest, registry and action-header identities. Requiring these values to be identical made a valid two-phase comparison impossible.

The common-condition projection now removes only `legacyClockReadiness`, `originalTeamSource` and `requestShapeDiagnostic`, plus `compiledBuild`, `compiledManifestSha256`, `registrySha256` and `actionHeaderSha256` inside `teamAnnualAction`. The action protocol, module, workers and export remain common. Shared observer conditions, public worker files, policy, browser, hardware, fixture and unknown fields remain part of the comparison. Existing manifest/public-source identity normalization is unchanged.

Normalization does not qualify a certificate. Existing preflight source reads still verify the actual files. Each recorded phase must match its independently registered configuration exactly, including whether the optional clock/request configuration fields are present. Context snapshots retain detached copies of those configurations. Budget registration also takes detached before/HEAD metadata snapshots, so later caller mutation cannot rewrite the expectations.

Tests use the public budget derive/compare and collector snapshot boundaries. They cover distinct valid phase configurations and action identities; missing, swapped and altered actual certificates; detached registration expectations; and shared observer, policy, public-worker and unknown-field mismatches. Synthetic certificate paths are never opened or treated as runtime qualification.

Policy 9, sample counts, formulas, latency/resource limits, error gates and observation deadlines are unchanged. This is a prospective correction before C13 freeze; earlier captures remain as recorded.
