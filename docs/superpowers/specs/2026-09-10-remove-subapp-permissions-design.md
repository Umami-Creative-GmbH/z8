# Remove subapp permissions

Approved scope: remove per-user web, desktop, and mobile application permissions end-to-end.

Remove employee settings controls, role-template defaults, validation and mutation fields, auth/session fields, permission enforcement and obsolete audit helpers. Authentication, approved organization membership, employee lifecycle restrictions, and organization RBAC continue to authorize requests.

Remove the Better Auth additional fields at their source and regenerate its schema using the supported CLI. Remove corresponding role-template schema columns and add an ordered SQL migration for both tables. Historical migrations and audit records remain historical records.

Update current product documentation and translations. Regression tests must demonstrate that legacy false flags no longer block authenticated login or organization switching, while membership and inactive-employee restrictions still apply. Run relevant API, employee settings, and auth tests plus type checking. Database migration execution requires deployment credentials and is outside local validation.
