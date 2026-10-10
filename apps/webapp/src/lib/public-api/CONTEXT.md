# Public API

How an organization's own systems read its data from outside Z8, authenticated by an API key and limited to that key's scopes.

## Language

**Public API**:
The versioned, organization-scoped interface through which an organization's own systems read its data with an API key.
_Avoid_: REST API, integration API, external API

**API key**:
A credential that belongs to an organization and lets its holder act as that organization, limited to the key's scopes. It never acts as the admin who created it.
_Avoid_: token, access token, personal API key

**MCP server**:
The Public API offered as tools an AI agent can call. It authenticates with the same API keys, offers only the tools the key's scopes allow, and reads exactly what the same key could read through the Public API.
_Avoid_: AI API, agent API, MCP integration

**Key scope**:
One resource and access level an API key grants, such as reading time entries.
_Avoid_: permission (reserved for member roles)

**Key creator**:
The admin who created an API key. Recorded for attribution only, never as the key's authority.
_Avoid_: key owner

**Key request log**:
The record of every request made with an API key: which key read what, when and from where, and whether it came through the Public API or the MCP server.
_Avoid_: API audit log, access log

**Health detail**:
What an absence reveals about an employee's health, such as being sick or the kind of sick leave. Only a key granted the health scope sees it; every other key sees the absence as plain absent.
_Avoid_: sick details, medical data
