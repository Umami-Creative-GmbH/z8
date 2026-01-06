# Z8 - Time Tracking for German Compliance

A comprehensive time tracking solution designed to meet German work hours documentation requirements (GoBD-compliant). Built as a monorepo with web, mobile, and desktop applications.

## Overview

Z8 helps organizations track employee work hours in compliance with German labor regulations. The system provides tamper-proof time tracking with blockchain-style entry linking, ensuring audit compliance and data integrity.

## Key Features

### Time Tracking
- Clock in/out with automatic time calculation
- Blockchain-style entries: each entry links to the previous one, preventing deletion
- To modify an entry, a new replacement entry must be created (requires manager approval for regular employees)
- Full audit trail for regulatory compliance

### Absence Management
- **Home Office** - Track remote work days
- **Sick Days** - Record illness-related absences
- **Vacation** - Manage and approve time off requests
- **Custom Categories** - Define additional absence types as needed
- Each category can be configured to indicate whether work time is required

### Organization Structure
- Multi-organization support
- Team management within organizations
- Employee-manager relationships
- Managers approve vacation requests and time entry corrections
- Powered by [better-auth](https://www.better-auth.com/) for authentication and authorization

## Architecture

This is a **Turborepo monorepo** containing:

| App | Description |
|-----|-------------|
| `apps/webapp` | Next.js web application - full-featured admin and employee interface |
| `apps/mobile` | Expo React Native app - time tracking on the go |
| `apps/desktop` | Tauri desktop app - lightweight timer widget for quick clock in/out |

## German Compliance (GoBD)

Z8 is designed to meet the requirements of the *Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von Büchern, Aufzeichnungen und Unterlagen in elektronischer Form sowie zum Datenzugriff* (GoBD):

- **Immutability**: Time entries cannot be deleted, only superseded by correction entries
- **Traceability**: All changes require approval workflow and are logged
- **Chain of Custody**: Entries are cryptographically linked like a blockchain
- **Audit Trail**: Complete history of all modifications with timestamps and approvers

## Getting Started

### Prerequisites
- [Bun](https://bun.sh/) runtime

### Development

```bash
# Install dependencies
bun install

# Run all apps in development mode
bun dev

# Run specific app
bun dev --filter=webapp
```

### Useful Commands

Generate auth schema:
```bash
bun dotenv -c dev -- bunx --bun @better-auth/cli generate --output ./src/db/schema.ts
```

Generate auth secret:
```bash
bunx @better-auth/cli@latest secret
```
