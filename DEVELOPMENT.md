# Development Guide

This document contains technical information for developers working on the Z8 project.

## Architecture

Z8 is built as a **Turborepo monorepo**, managing shared logic and various application targets:

| App | Path | Description |
|-----|------|-------------|
| **Web** | `apps/webapp` | Next.js web application - The primary administrative and employee interface. |
| **Mobile** | `apps/mobile` | Expo React Native app - Native mobile companion for time tracking on the go. |
| **Desktop** | `apps/desktop` | Tauri desktop app - Lightweight background widget for quick clock in/out operations. |

### Tech Stack Highlights
- **Framework**: Next.js (Web), Expo/React Native (Mobile), Tauri (Desktop)
- **Language**: TypeScript, Rust (Tauri Core)
- **Database**: Drizzle ORM
- **Auth**: Better-Auth
- **Styling**: Tailwind CSS, Shadcn UI
- **Monorepo Tooling**: Turborepo, pnpm/bun

---

## Getting Started

### Prerequisites
- [Bun](https://bun.sh/) runtime (recommended) or Node.js with pnpm.

### Development Workflow

```bash
# Install dependencies
bun install

# Run all apps in development mode
bun dev

# Run specific app
bun dev --filter=webapp
```

### Infrastructure & Configuration

#### Authentication
Generate auth schema:
```bash
bunx --bun @better-auth/cli generate --output ./src/db/schema.ts
```

Generate auth secret:
```bash
bunx @better-auth/cli@latest secret
```

#### Push Notifications
Generate VAPID keys for push notifications:
```bash
bunx web-push generate-vapid-keys
```

Add these to your `.env` file:
```env
VAPID_PUBLIC_KEY=<generated-public-key>
VAPID_PRIVATE_KEY=<generated-private-key>
VAPID_SUBJECT=mailto:support@yourdomain.com
```

---

## Code Quality Standards

This project follows strict quality standards enforced by **Ultracite** (Biome preset).

- **Format code**: `npx ultracite fix`
- **Check for issues**: `npx ultracite check`
- **Type checking**: `bun x tsc --noEmit` (in respective app folders)

For more details, see the internal [Ultracite Code Standards](.github/copilot-instructions.md).
