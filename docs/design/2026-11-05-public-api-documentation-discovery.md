# Public API documentation discovery

Status: approved by the user on 2026-11-05. Design interview complete.

## Goal

Developers opening Settings → Enterprise → Developer Access → API Keys can discover what the organization's API keys can read and find the contract needed to build an integration.

## Agreed scope

- Reuse the existing Public API v1 OpenAPI specification and rendered API reference.
- Add prominent API Reference and Download OpenAPI spec links to the API Keys tab.
- Keep the reference publicly readable on the existing documentation site; it requires no Z8 session or API key to read.
- Include a brief explanation of available resources and key scopes on the API Keys tab.
- Link the spec download to the current Z8 installation. An imported spec must target that installation rather than silently defaulting to hosted production.
- Close the observed error-response documentation gaps: document runtime `500 server_error` responses and unknown-route `404 not_found` behavior where appropriate. Regenerate the committed specification and API reference without changing API behavior.
- Limit this change to Public API v1 discovery. MCP, webhooks, API-key management endpoints and an embedded reference are outside this scope.

## Existing behavior

- The API Keys tab has no link to the reference or specification: [settings page](../../apps/webapp/src/app/[locale]/(app)/settings/enterprise/api-keys/page.tsx), [key client](../../apps/webapp/src/components/enterprise/api-key-page-client.tsx).
- The [OpenAPI route](../../apps/webapp/src/app/api/v1/openapi.json/route.ts) publicly serves the committed OpenAPI 3.1 document.
- The [reference introduction](../../apps/docs/content/docs/api-reference/index.mdx) already explains authentication, pagination, time and date semantics, errors, rate limits and versioning. The [API key guide](../../apps/docs/content/docs/guide/admin-guide/api-keys.mdx) documents scopes and request examples.
- Public API v1 currently exposes eight read-only list operations for work periods, absences, employees, projects, customers and custom-field definitions. Keys act as organizations, limited by key scopes, as defined in the [Public API context](../../apps/webapp/src/lib/public-api/CONTEXT.md).
- [Contract checks](../../apps/webapp/src/lib/public-api/openapi.test.ts) compare the generated document with the committed JSON and check generated reference coverage.

## Acceptance criteria

1. An admin opening the API Keys tab sees the API Reference and Download OpenAPI spec actions whether or not the organization has created any keys.
2. The brief overview names the available resource families, states that Public API v1 is read-only, and explains that an API key reads only what its key scopes allow. Detailed endpoint documentation remains in the reference.
3. API Reference opens the existing public reference at `https://docs.z8-time.app/docs/api-reference`. Reading it requires no login or API key.
4. Download OpenAPI spec provides a usable OpenAPI 3.1 JSON file from `/api/v1/openapi.json` on the current installation, without requiring a login or API key and without including credentials or organization data.
5. A spec downloaded from a self-hosted installation directs imported clients to that installation. Documentation explains using the installation's own base URL; documentation-host URLs must not become API targets.
6. Supported operations describe their runtime `500 server_error` response using the existing problem format. The reference also explains that an unknown API route returns `404 not_found`; no invented wildcard operation is added to the endpoint inventory.
7. The specification continues to derive endpoint schemas and required scopes from the existing registry. Regenerated artifacts and reference coverage pass the existing drift checks.
8. The change preserves existing authentication, organization isolation, key scopes, rate limits and endpoint behavior.

## Verification for implementation

- Check both the empty and populated API Keys tab, including keyboard access and the existing light/dark presentation.
- Verify the two links and the actual downloaded filename/content, including access without a session.
- Verify deployment targeting using a self-hosted origin distinct from both hosted production and the documentation host; importing the downloaded document must retain the correct API target.
- Run the focused Public API OpenAPI checks after regeneration and verify the rendered reference reflects the documented errors.
- Validate the UI against the repository's React, composition and interface guidelines when implementing it.

## Documentation decisions

No new domain term was introduced: the existing Public API context already defines Public API, API key and key scope. No glossary change is needed. The discoverability choices are readily reversible and do not warrant an ADR; this design note records their scope and acceptance criteria.

## Next step

The user confirmed shared understanding and approved this design. No design questions remain open. For implementation, identify and claim the appropriate GitHub issue before investigating or changing application code, verify assignment, and work on its dedicated branch.

The approved design has been synthesized into a [tracker-ready specification](2026-11-05-public-api-documentation-discovery-spec.md) with user stories, implementation decisions and testing decisions.

Published as [GitHub issue #1558](https://github.com/Umami-Creative-GmbH/z8/issues/1558) with the `ready-for-agent` label. The published issue body was read back and verified against the saved specification.

## Verification limits

Repository inspection established these facts; deployed pages have not been verified. During the design interview, reading originating issue #763 failed because the sandboxed GitHub CLI was unauthenticated. Specification publication subsequently succeeded using the authenticated GitHub CLI outside the sandbox. No implementation issue was claimed and no application code was changed.
