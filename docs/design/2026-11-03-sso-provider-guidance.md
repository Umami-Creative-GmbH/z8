# Provider-specific SSO setup guidance

Status: Implemented locally for [#1532](https://github.com/Umami-Creative-GmbH/z8/issues/1532).

## Problem

The SSO Providers tab at `/settings/enterprise/identity-setup?tab=sso` asks organization administrators to translate identity-provider instructions into generic OIDC fields. In particular, Microsoft Entra setup requires users to find the right app registration, construct an issuer URL, register Z8's callback, and distinguish a client secret's value from its identifier.

## Agreed decisions

- Put provider selection and guided instructions inside the SSO tab, beside the actual configuration fields. Include links to the provider's administration portal and copyable Z8 URLs. Retain manual configuration.
- Deliver a complete Microsoft Entra guide first, with generic OIDC guidance for other providers. Detailed Okta and Google Workspace guides are outside this first version.
- Support both administrators who configure Entra themselves and administrators who hand that work to IT. Provide a copyable checklist with the required settings and URLs, excluding secrets.
- Guide organization-owned, single-tenant Entra applications using OpenID Connect in Microsoft's standard cloud. Other configurations retain manual OIDC setup.
- Ask for the email domain, tenant ID, application client ID, and client secret. Derive the Entra issuer and generate a unique provider identifier rather than asking users to construct them.
- Preserve existing testing and enforcement behavior. Clearly distinguish a saved configuration, DNS domain verification, and a sign-in result reported by an administrator. Do not present a manually reported result as an automatically verified login.

## Existing behavior to account for

The SSO tab uses `SSOProviderManagement`, while the Guided setup tab uses `IdentitySetupWizard`. Provider presets already exist for Entra, Okta, Google Workspace, and generic providers. Before this change, Entra offered an issuer placeholder rather than a value derived from a tenant ID.

The SSO management UI already computes an organization-specific OIDC callback URL. The guide must use that value rather than inventing another URL from the browser's current address.

The existing wizard records a manually reported sign-in test result. The earlier [identity setup design](../superpowers/specs/2026-05-03-sso-scim-setup-wizard-design.md) describes a live test. This change clarifies that distinction; a verified end-to-end login test is separate work.

## Resulting flow

- Choose Microsoft Entra ID or manual OIDC setup when adding a provider.
- Follow numbered provider-side instructions alongside Z8's configuration form. Copy the organization-specific callback and optionally the full IT checklist before credentials exist.
- Register a single-tenant Web application, copy the tenant and application IDs, register the callback, create a client secret, and paste its Value into Z8.
- Explain required identity scopes, tenant consent policies, and secret expiry without requesting unnecessary permissions. Preserve the existing auth defaults: `openid`, `email`, and `profile`, with `offline_access` also requested by some connections for refresh tokens.
- Save the provider, then use the existing DNS verification controls. Show the generated provider ID in the list so administrators can select the same ID and email domain in Guided setup, then manually record their pilot sign-in outcome before considering Require SSO.
- Include troubleshooting for redirect mismatch, secret Value versus ID, tenant mismatch, and consent restrictions, with official Microsoft documentation links.
- Reuse the provider instructions and callback display in the existing wizard's OIDC step. Keep SAML, SCIM, and enforcement behavior unchanged.

## Primary references

- [Register an application](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
- [Add a Web redirect URI](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri)
- [Add credentials and copy the secret value](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials)
- [OpenID Connect and tenant-specific endpoints](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc)
- [OIDC scopes](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc)
- [User and administrator consent](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/user-admin-consent-overview)

No ADR is needed for the agreed guidance choices so far: they are reversible interface decisions. Add domain glossary entries only if the interview resolves project-specific terminology that is not already documented.

## Implementation and verification

The add-provider panel defaults to Entra and places the instructions alongside its four configuration fields. Provider selection changes reset the form, and closing the panel discards in-memory credentials. The existing wizard reuses the instructions and callback display, and its Entra tenant field can populate the editable advanced issuer field.

The IT checklist accepts only public setup values and never receives the credential fields. It can be copied before credentials exist. If clipboard access fails, selectable text is provided for manual copying.

The guide links to Microsoft's app registration, Web redirect URI, credential, consent, and troubleshooting documentation. It distinguishes Application (client) ID from Object ID and a client secret's Value from its ID. It also explains secret expiry, consent restrictions, and redirect mismatches.

Focused tests cover Entra registration payloads, tenant validation, manual OIDC error recovery, secret-free checklist copying, clipboard denial, credential disposal on close, callback origin selection, shared wizard guidance, and existing settings behavior. Live tenant sign-in and Tolgee synchronization require the configured external service environment and are not part of the local validation.
