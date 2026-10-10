[Deutsch](README.md) | English

![./docs/z8-banner.png](./docs/z8-banner.png)

# Z8 - Modern Workforce Management

## Local development

Use Node.js 24 or newer and pnpm. After `pnpm install`, run
`pnpm dev:webapp` with your usual Phase environment. The webapp uses
[Portless](https://portless.sh) at **https://z8.localhost** instead of port 3000.
`pnpm dev` and `pnpm --filter webapp dev` use the same setup. Portless assigns
an available backend port and shares one local proxy across projects. Other
projects need their own Portless names. Git worktrees automatically receive
a hostname prefix; use the URL printed at startup.

On first launch, Portless sets up its local HTTPS certificate authority and
may request permission to trust it or update the hosts file. To check the
setup, run `pnpm --filter webapp exec portless doctor`; to trust the certificate
manually, run `pnpm --filter webapp exec portless trust`. Existing proxy settings
can change the scheme, suffix, or proxy port, so the startup URL is authoritative.

The dev launcher sets `APP_URL`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`,
`MAIN_DOMAIN`, `PLATFORM_DOMAIN`, and `PASSKEY_RP_ID` from the Portless URL,
overriding stale local URL settings supplied by Phase. Production commands are
unaffected. OAuth providers must allow the new callback URL, and passkeys for
another hostname may need to be registered again. Tenant subdomains require
Portless's optional wildcard routing setup.

For direct access without the proxy, use `pnpm --filter webapp dev:direct`
(Next.js's normal port selection applies). For Webpack, use
`pnpm --filter webapp dev:webpack`. On Windows PowerShell, use `pnpm.cmd` if
execution policy blocks the `pnpm.ps1` shim.

Z8 is a workforce management platform built for organizations that need reliable time tracking, audit-ready records, and clear operational control under German labor law and GoBD compliance (*Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von Büchern*).

On the web and the Windows desktop, Z8 gives teams a dependable operational system for time tracking, absences, travel expenses, and day-to-day workforce management.

> [!IMPORTANT]
> **WIP Notice**  
> Z8 is still a work in progress. It is already used by several companies of different sizes, but some parts of the product may still change as the platform continues to mature.  
> Not all export options have been tested in all circumstances yet. If you run into a bug, an export edge case, or other unexpected behavior, please open a GitHub issue.

---

## 🛡️ GoBD & Legal Compliance

Z8 is designed to help organizations operate with confidence in compliance-sensitive environments.

- **Audit-Ready Records**: Time, absence, and related workforce records are captured in a consistent structure that supports dependable reporting, review, and oversight.
- **Immutable Ledger**: Time records keep an append-only, tamper-evident history for clear traceability and audit readiness.
- **Traceable Corrections & Approvals**: Changes to recorded time move through clear approval flows with visible history for employees, managers, and compliance stakeholders.
- **Digital Integrity**: Automated background checks verify the integrity of the data chain to protect against database manipulation.
- **Audit Logs**: Comprehensive event logging for all administrative actions, from user permission changes to organization settings.

## ⏱️ Advanced Time Tracking

- **Two Clock Clients**: Clock in via the full-featured **Web Dashboard** or the low-profile **Tauri Desktop widget** for Windows.
- **Correction Workflows**: Streamlined process for employees to request time corrections, with approval-aware reviews and fast manager follow-up.
- **Clock-In Import Hub**: Bring historical or external clock-in data into Z8 with a guided import flow instead of manual re-entry.
- **Quick Actions**: Global "Time Clock" popover in the web header for friction-less clock-in/out even when navigating other modules.
- **Live Status**: Real-time visibility into who is currently clocked in within your team.

## 🏖️ Absence & Holiday Management

- **Holiday Presets**: Automated import of country-specific and regional public holidays (Deutschland, Bundesländer support).
- **Vacation Balance Tracking**: Sophisticated calculation of remaining leave days based on flexible assignment policies.
- **Flexible Categories**: Pre-configured status types including Home Office, Sick Leave, Vacation, and custom absence types.
- **Approval Engine**: Visual timeline for managers to review and approve absence requests while checking for team coverage conflicts.
- **Travel Expense Workflows**: Handle travel expense claims and approvals in the same operational workflow as the rest of your workforce processes.

## 📊 Insights & Reporting

- **Advanced Analytics**: Interactive dashboards for team performance, location trends, and workforce distribution.
- **Export Ready**: Generate payroll and audit-ready exports with advanced filtering for dependable downstream processing.
- **Organization Management**: Manage multi-location organizations, team structures, member directories, invitation flows, and department hierarchies from one place.

## 🔄 Integrations & Data Exchange

- **DATEV**: Export payroll-ready time data for accounting and payroll workflows.
- **Personio**: Export time and payroll data for HR workflows.
- **SAP SuccessFactors**: Export time and payroll records for enterprise HR workflows.
- **Workday**: Export payroll and workforce records for enterprise HR operations.
- **Clockodo**: Import time records into Z8 for a smoother transition.
- **Clockin**: Import clock-in records into Z8.

## 🔔 Modern Experience

- **Multi-Channel Notifications**: Stay informed via In-app alerts, Desktop Push notifications (Web Push), and Email templates.
- **Dark Mode Support**: Fully responsive UI with automated and manual theme toggling.
- **Periodic Updates**: Notification center refreshes in the background and on focus without long-lived realtime streams.

---

## 👍 Fair Usage Policy

Z8 is free for deployments with up to 25 concurrent active users. Organizations exceeding this threshold require an enterprise license to support sustainable development and continued innovation. Use is also subject to additional restrictions in the [License](LICENSE), including restrictions on competing SaaS offerings and billing functionality. Read the [Fair Usage Policy](FairUsagePolicy.md) for details on:

- Free tier eligibility and active user counting
- Anonymous telemetry and privacy guarantees
- Enterprise licensing options
- Open-source commitment and code access

---

## 📖 Documentation & Resources

For deeper dives into specific areas of the platform, please refer to:

- **[User Guide](USER_GUIDE.md)**: How to use Z8 as an employee or manager.
- **[Admin Guide](ADMIN_GUIDE.md)**: Configuration, compliance settings, and organization setup.
- **[Development Guide](DEVELOPMENT.md)**: Technical architecture, setup instructions, and contribution guidelines.
- **[Fair Usage Policy](FairUsagePolicy.md)**: Licensing terms for deployments exceeding 25 users.
- **[License](LICENSE)**: Open source license details.

---

*Built with precision for the modern workforce.*
