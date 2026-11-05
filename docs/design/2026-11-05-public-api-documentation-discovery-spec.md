# Make Public API documentation discoverable from API Keys

## Problem Statement

Developers opening the API Keys tab under Settings → Enterprise → Developer Access cannot discover the Public API reference or download its OpenAPI specification from that page. They cannot readily tell which resources their organization's systems can read, which key scopes an integration needs, or where to find the request and response contract.

The specification and public reference already exist, but the current OpenAPI document names Z8's hosted production server. A self-hosted developer importing that document can consequently target the wrong installation. Promoting the reference also exposes existing gaps in its error documentation: supported operations omit runtime server errors, and unknown-route behavior needs to be explained clearly.

## Solution

Make the existing Public API v1 documentation easy to discover directly from the API Keys tab. Show prominent **API Reference** and **Download OpenAPI spec** actions, alongside a brief overview of the available resource families, read-only access and key scopes. Keep these actions visible both before the organization creates its first API key and after keys exist.

Open the existing public reference on the documentation site. Download an OpenAPI 3.1 JSON document from the current Z8 installation, with an API target that remains correct when the document is imported into a client. Developers can read the reference and retrieve the specification without a Z8 login or API key; actual organization data remains protected by API-key authentication and key scopes.

Complete the error documentation, regenerate the existing specification and reference artifacts, and retain the existing contract-drift checks. Public API behavior remains unchanged.

## User Stories

1. As an organization admin, I want documentation actions on the API Keys tab, so that I can find integration guidance where I manage developer access.
2. As an organization admin with no API keys yet, I want the same documentation actions before creating a key, so that I can evaluate the available capabilities first.
3. As an organization admin with existing API keys, I want the documentation actions to remain visible, so that I can return to the contract while maintaining integrations.
4. As an integration developer, I want a brief overview of available resources, so that I can determine whether the Public API supports my integration.
5. As an integration developer, I want the overview to state that Public API v1 is read-only, so that I can plan around its actual capabilities.
6. As an integration developer, I want to discover work periods and absences, so that I can assess workforce-data integrations.
7. As an integration developer, I want to discover employees, projects and customers, so that I can assess master-data integrations.
8. As an integration developer, I want to discover custom-field definitions and values, so that I can understand the organization-specific information available through the supported resources.
9. As an organization admin, I want a brief explanation that key scopes limit what an API key reads, so that I can choose the access an integration needs.
10. As an integration developer, I want the reference to identify each operation's required key scope, so that I can request an appropriately scoped API key.
11. As an integration developer, I want the reference to explain the additional scopes for health detail and restricted custom fields, so that I can understand why fields may be withheld.
12. As an integration developer, I want an API Reference action that opens the existing public reference, so that I can inspect endpoints, parameters and response schemas.
13. As a developer without a Z8 login, I want to read the reference publicly, so that I can evaluate or prepare an integration before receiving access.
14. As an integration developer, I want existing Bearer API-key authentication examples, so that I can make an authenticated request correctly.
15. As an integration developer, I want existing pagination and rate-limit guidance to remain easy to find, so that I can build a reliable data reader.
16. As an integration developer, I want existing time and date guidance to remain available in the reference, so that I can interpret work periods and absences correctly.
17. As an integration developer, I want a Download OpenAPI spec action, so that I can import the contract into my development tools.
18. As an integration developer, I want the download to produce a usable OpenAPI 3.1 JSON file, so that I can retain and import it independently of the documentation site.
19. As a developer without an API key, I want to retrieve the specification publicly, so that I can inspect the contract before receiving data access.
20. As a self-hosted integration developer, I want the spec download to come from my current Z8 installation, so that I receive its deployed contract.
21. As a self-hosted integration developer, I want imported clients to target that installation, so that requests do not silently go to Z8's hosted production server.
22. As a self-hosted integration developer, I want the reference to explain using my installation's base URL, so that hosted examples do not misdirect my integration.
23. As an integration developer, I want API targets to remain distinct from the documentation host, so that imported tools do not send API requests to the documentation site.
24. As an integration developer, I want supported operations to document their existing server-error response, so that I can handle failures using the published contract.
25. As an integration developer, I want the reference to explain the existing unknown-route response, so that I can distinguish a wrong endpoint from other failures.
26. As an organization admin, I want public documentation and downloads to contain no API keys or organization data, so that sharing the contract does not share access or records.
27. As a keyboard user, I want to reach and activate both documentation actions, so that I can use them without a pointer.
28. As a user of either supported theme, I want the new guidance and actions to remain readable, so that the page fits the application's existing presentation.
29. As an integration developer, I want the reference and downloadable contract to stay aligned with the registered operations and schemas, so that I can rely on their descriptions.
30. As an organization admin, I want existing authentication, organization isolation, key scopes and request limits preserved, so that documentation improvements do not change data access.

## Implementation Decisions

- Reuse the existing Public API endpoint registry, schema-based OpenAPI generator, committed OpenAPI document and generated reference. Do not introduce a second contract or documentation renderer.
- Extend the API Keys tab of Developer Access with API Reference and Download OpenAPI spec actions and a concise overview. Both actions remain available in the empty and populated key-list states, within the page's existing admin access boundary.
- Link API Reference to `https://docs.z8-time.app/docs/api-reference`. The reference remains publicly readable without a Z8 session or API key.
- Explain the current resource families: work periods, absences, employees, projects, customers and custom-field definitions. State that v1 is read-only and that API keys act as their organization, limited by key scopes.
- Keep detailed endpoint descriptions, required scopes, authentication examples, pagination, limits and date/time semantics in the existing reference rather than duplicating them in settings.
- Provide a usable OpenAPI 3.1 JSON file through Download OpenAPI spec, sourced from the existing public `GET /api/v1/openapi.json` endpoint on the current installation. Verify the actual download behavior and filename, rather than providing only a link that displays raw JSON.
- Ensure that a downloaded document retains the current installation as its API target when imported into a client. Self-hosted downloads must not silently target hosted production, and the documentation host must not become an API target. The exact serialization mechanism is an implementation choice subject to this acceptance behavior.
- Keep endpoint schemas and required key scopes generated from the existing registry. Deployment-specific server targeting must preserve those generated operation contracts and meaningful artifact-drift checks.
- Explain in the reference that developers use the base URL of their own Z8 installation, including for self-hosted installations.
- Document the existing `500 server_error` problem response for supported operations using the existing `application/problem+json` format. Explain the existing `404 not_found` response for an unknown API route in the reference; do not add a fictional wildcard operation to the endpoint inventory.
- Regenerate the committed specification and reference artifacts with the existing tooling after contract-documentation changes.
- Preserve the existing organization-scoped, read-only contract, API-key authority, key scopes, authentication, request logging, rate limits and runtime error behavior. No database or authorization-model changes are required.
- Public reference pages and specification downloads require no credentials and include no API keys, organization records or user-specific data.
- Follow the existing settings UI patterns, keyboard accessibility, light/dark themes and localization conventions.

## Testing Decisions

- Carry forward the verification approach approved during the design interview. Prefer the existing high-level behavioral seams: the user-facing settings and download flow, and the Public API's generated/served contract. No new production abstraction is required solely for testing.
- Good tests assert observable behavior: which actions a user can activate, where they lead, what document is downloaded, which API origin an importer resolves, and which operations, scopes and responses the public contract describes. Avoid assertions about component internals, helper call order or equivalent implementation details.
- Verify the API Keys tab with both an empty and populated key list. In both states, an admin can find and activate both actions; the overview communicates the resource families, read-only behavior and scope limits.
- Verify the existing reference destination, keyboard access and readable presentation in both themes. Use the repository's existing UI verification approach rather than introducing a separate test framework.
- Verify public access to the spec without a session or API key, JSON content, OpenAPI version, usable download behavior and the absence of credentials or organization records.
- Exercise the served/downloaded document from a self-hosted origin distinct from both hosted production and the documentation host. Verify the API target after importing or resolving the downloaded document, not merely the URL of the download link. Include the hosted deployment case to guard against a self-hosting fix breaking the normal target.
- Extend the existing Public API OpenAPI contract checks as needed to cover documented `500` responses while preserving operation and key-scope coverage. Reuse the established generated-document snapshot/drift comparison and reference-page/navigation coverage checks as prior art.
- Verify that the reference explains unknown-route `404` behavior without adding a nonexistent operation. Review regenerated output to confirm the reference exposes the updated errors and installation-base-URL guidance.
- Run the focused existing OpenAPI checks after regeneration. Validate the affected UI against the repository's React, composition and interface guidelines. Broader checks should follow the implementation's actual scope and repository requirements.

## Out of Scope

- New Public API operations, write access or changes to existing endpoint behavior.
- Documenting API-key management endpoints as part of Public API v1.
- New MCP server or webhook discovery features, or changes to either interface. Existing cross-links in the reference need not be removed.
- Embedding an API reference, API explorer or new interactive request console in settings.
- Building another documentation site, introducing a second specification source or replacing the existing renderer and generation pipeline.
- Expanding organization-data access, changing key scopes or authority, changing authentication or request limits, or altering timekeeping semantics.
- Creating new domain terminology or an ADR for the readily reversible discoverability choices.

## Further Notes

The user approved the design and its verification approach on 2026-11-05. This spec synthesizes those decisions; it introduces no new product scope or unresolved design questions.

Public API v1 currently has eight GET list operations. The existing domain model defines API keys as organization credentials: the key creator is attribution only, and key scopes determine access. Preserve the accepted decisions on organization authority and the two-tier treatment of restricted custom fields.

Repository inspection confirmed the existing spec, reference and discovery gap. Live deployments were not inspected, so deployment correctness must be verified during implementation. Documentation and application deployments can differ even when generated from a shared committed contract.

This is a `ready-for-agent` specification for `Umami-Creative-GmbH/z8`. Publication and implementation are separate: the implementer must claim the appropriate issue, verify assignment and use a dedicated feature branch. Any implementation tickets derived later must be linked as native sub-issues of this spec.
