# Personal data export contents

Confirmed in [#1588](https://github.com/Umami-Creative-GmbH/z8/issues/1588).

Employee exports and admin exports omit CSV files with no rows and category JSON
files with no actual user records. Within a retained JSON file, empty arrays,
absent optional records and the existing field structure remain intact.

A default absence placeholder, such as the status of a kiosk PIN that was never
set, does not count as user data. Stored records count even when their values are
zero, false or null. An optional feature being disabled does not make its retained
records empty.

Original files remain included, even when their category has no structured
records. An unreadable original still fails the export rather than silently
disappearing.

README.txt and _manifest.json remain in every archive. Their category and file
references describe the included contents; the README explains that empty files
are omitted. The employee export's fixed complete-copy explanation remains.

Omission is decided from the collectors' already authorized, redacted results.
Organization scope and the distinction between employee and admin exports stay as
defined in [Organization ADR 0003](../../apps/webapp/src/lib/organization/docs/adr/0003-only-an-admin-export-is-the-complete-personal-data-export.md).
