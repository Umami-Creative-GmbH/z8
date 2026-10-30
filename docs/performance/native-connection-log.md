# Private native connection log

Every `launchFixtureBrowser(puppeteer, executablePath)` call uses Chrome NetLog
`Default` capture with an 8 MiB rotating **event** budget. Before returning the
browser, the launcher checks the actual child arguments for the exact mode,
budget and owned path. This is a configuration check, not an adversarial proof.
Original and Head use the same launcher and settings.

The raw log lives in a separate owned OS temporary directory, outside the Chrome
profile. Closing the browser removes only the profile and preserves the log.
`fixtureLaunchPolicy.nativeConnectionLog.file` is a private diagnostic reference;
the path is excluded from recorded launch arguments using the same narrow rule
in Native launch metadata. Mode and budget remain fully recorded and compared.
Keep this reference and raw file private: Default excludes sensitive capture mode
and socket bytes, but is not a general anonymization guarantee.

After close, the optional reference records file bytes and a streaming SHA256
only when the regular file is at most 16 MiB and stable during reading. The
16 MiB bound is analysis **admission**, not an active file watcher or hard capture
cap. Missing, oversized, changed or unreadable files remain UNKNOWN without a
hash. Retained files also remain UNKNOWN (`retained-unparsed`): neither JSON
validity nor ring completeness nor a causal network interpretation is asserted.
Snapshots taken before close keep their recording-time status and reference.

This diagnostic adds no requests, retries, waits or acceptance authority. All
browser-control, Native, error, resource, cache-profile and deadline gates still
apply. A retained NetLog never turns a failed sample into a successful one.
