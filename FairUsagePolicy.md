# Fair Usage Policy for Z8

**Last Updated**: January 13, 2026  
**Effective Date**: February 1, 2026

## Overview

Z8 is distributed under a source-available license based on the BSD 3-Clause License with additional use restrictions (see [LICENSE](LICENSE)). This Fair Usage Policy complements the license and is designed to ensure sustainability, fairness, and equitable access within the Z8 community.

The Fair Usage Policy is built on the principle of **fair exchange**: Z8 provides a powerful, feature-rich open-source time tracking and HR management platform free of charge. In return, organizations using Z8 at scale are expected to contribute fairly by either:

1. Using Z8 with 25 or fewer concurrent active users at no cost
2. Obtaining an enterprise license for organizations exceeding the 25-user threshold

This model allows Z8 to:
- Invest in continued development, security updates, and infrastructure
- Maintain code quality and reliability for the entire community
- Support smaller organizations and startups without financial barriers
- Scale sustainably for power users through enterprise offerings

**Important**: This policy applies only to deployments using Z8 with organization and user management features enabled. It does not apply to personal use, development, or testing environments.

---

## Active User Definition

An **active user** is defined as a user account that has had at least one authenticated session within the last **24 hours**. This includes:

- Users who logged in and actively used the application
- Users with active sessions (including idle sessions)
- System-initiated sessions on behalf of users

**Not counted** as active users:
- Archived or deactivated user accounts
- API-only service accounts (except those representing human users)
- Development or testing accounts (if clearly marked)

### Measurement Method

Active user counts are determined by querying the application's session database:

```
SELECT COUNT(DISTINCT user_id)
FROM session_table
WHERE last_activity_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
AND is_active = true
```

This count is performed **once daily** (UTC midnight) and is included in the anonymous telemetry report sent to Umami Creative's telemetry endpoint.

---

## Fair Usage Tiers

### Tier 1: Community (Free)
- **Limit**: Up to 25 concurrent active users within any 24-hour period
- **Cost**: Free
- **Features**: Feature access subject to the [LICENSE](LICENSE) restrictions (for example, Billing Features are restricted)
- **Support**: Community forums and documentation
- **Requirements**: 
  - Daily telemetry reporting enabled (see "Telemetry & Reporting" section)
  - Acknowledge and accept this Fair Usage Policy

### Tier 2: Enterprise
- **Limit**: Unlimited concurrent active users
- **Cost**: Custom pricing based on organization size and needs
- **Features**: Full feature access + priority support
- **Support**: Direct support from Umami Creative team
- **Requirements**:
  - Executed enterprise license agreement
  - Annual or custom billing cycle

---

## Telemetry & Reporting

Z8 includes a **non-intrusive, privacy-respecting telemetry system** that reports anonymous usage metrics once per day. This telemetry is essential to:

1. Monitor compliance with the Fair Usage Policy
2. Understand how Z8 is being used at scale
3. Plan infrastructure and development efforts
4. Detect potential abuse patterns

### What Data is Collected

The daily telemetry payload includes **only** the following aggregated, anonymized information:

```json
{
  "version": "1.0",
  "deployment_id": "unique-uuid-for-this-instance",
  "timestamp": "2026-01-13T00:00:00Z",
  "metrics": {
    "active_users_24h": 18,
    "total_organizations": 2,
    "total_employees": 156,
    "sessions_created_24h": 42,
    "api_requests_24h": 8945,
    "license_type": "community"
  }
}
```

### What Data is NOT Collected

- **No personal data**: No names, emails, usernames, or identifiers
- **No transaction details**: No employee records, time entries, or project data
- **No authentication info**: No passwords, tokens, or session keys
- **No organizational context**: No company names or identifying business information
- **No IP addresses or user agents**: Completely anonymous at the deployment level

### Transmission & Security

- Telemetry is sent via **HTTPS POST** to `https://z8-time.app/telemetry`
- Each payload is **encrypted in transit** using TLS 1.3+
- The `deployment_id` (a random UUID) is the only persistent identifier across reports
- Data is sent **once per day** (UTC midnight) via a scheduled cron job
- Failed transmissions are retried up to 3 times with exponential backoff

### Opting Out of Telemetry

Organizations can **optionally disable telemetry** by setting the environment variable:
```
TELEMETRY_ENABLED=false
```

**Note**: Disabling telemetry does not exempt you from the Fair Usage Policy requirements. Manual compliance reporting will be required (see "Manual Compliance Reporting" section below).

### Data Retention & Usage

Umami Creative will:
- **Retain telemetry data** for 12 months for analytics, billing, and audit purposes
- **Never share data** with third parties (except as required by law)
- **Only use aggregated, anonymized data** for statistics and planning
- **Comply fully** with GDPR, CCPA, and other applicable privacy regulations
- **Allow deletion** of historical data upon written request

For questions about how your telemetry data is used, contact: **legal@umami.de**

---

## Compliance & Enforcement

### Exceeding the 25-User Limit

If your deployment's active user count exceeds 25 users for more than **7 consecutive days**, the following process will be initiated:

#### Phase 1: Notification (Days 1-7)
- Automated alert displayed in Z8 admin dashboard
- Warning notification in logs
- Email notification sent to organization administrators
- **Duration**: 7 days from first detection

#### Phase 2: Grace Period (Days 8-37)
- 30-day grace period for awareness and compliance
- Continued full access to all features
- Escalation email to organization contacts
- Option to purchase enterprise license immediately
- **Action required**: Contact sales or enable enterprise license

#### Phase 3: Enforcement (Day 38+)
If no compliance action is taken after the grace period:

**Option A**: Upgrade to Enterprise License
- Licensing restrictions are immediately removed
- Full feature access continues
- Support tier can be selected

**Option B**: Reduce User Count
- Deactivate or archive excess user accounts to fall below 25-user threshold
- Reactivate users as needed within the 25-user limit

**Option C**: Accept Restrictions
- If neither upgrade nor reduction occurs, access to organizational administration and user management features may be restricted
- **Source code access is retained**—your data and the ability to operate Z8 remain fully available
- Self-hosted deployments continue to function without interruption
- This preserves the open-source spirit while protecting the project's sustainability

### Manual Compliance Reporting

Organizations that disable telemetry must submit a **Compliance Report** at least quarterly:

1. Count active users in the deployment
2. Submit the count via our compliance portal: https://compliance.z8-time.app
3. Keep records for audit purposes (12 months)

Failure to submit quarterly reports for 2 consecutive quarters may result in enforcement actions similar to Phase 3 above.

---

## Enterprise Licensing

### When to Consider Enterprise

Enterprise licensing is available for organizations that:
- Expect to exceed 25 concurrent active users
- Require priority support and SLAs
- Need custom development, integrations, or deployment options
- Operate in highly regulated industries requiring support guarantees

### How to Obtain an Enterprise License

1. **Contact Sales**: https://z8-time.app/pricing
2. **Discuss Requirements**: Our team will understand your use case and scale
3. **Custom Pricing**: We'll provide a transparent, customized quote
4. **Flexible Licensing**: Options for annual, multi-year, or usage-based billing

### Enterprise Benefits

- ✅ Unlimited concurrent active users
- ✅ Priority support (24/7 response SLA)
- ✅ Technical account manager
- ✅ Custom integrations and extensions
- ✅ On-premise or cloud deployment options
- ✅ Security audits and compliance certifications
- ✅ Training and onboarding support

---

## Source Code Access & Open Source Philosophy

**Regardless of your licensing tier or compliance status, you always retain access to Z8's complete source code.**

This means:

- If compliance restrictions are applied, you can **fork and maintain your own version** of Z8
- You can **audit all code** used in your deployment
- You can **modify and customize** the software for your specific needs
- You can **deploy independently** without relying on infrastructure managed by Umami Creative
- The **BSD 3-Clause License** remains valid and enforceable

This aligns with Z8's core open-source commitment: the software is never locked in or restricted at the code level.

---

## Acceptable Use & Policy Abuse

The Fair Usage Policy assumes good faith usage. The following are considered policy violations and may result in immediate enforcement:

1. **Circumvention Attempts**
   - Creating multiple small deployments to bypass the 25-user limit
   - Artificially inflating or deflating active user metrics
   - Disabling telemetry to avoid usage transparency

2. **Misrepresentation**
   - Providing false information in compliance reports
   - Intentionally miscounting active users
   - Failing to report legitimate exceeding of limits

3. **Abuse of Telemetry Data**
   - Attempting to reverse-engineer competitor deployments using telemetry
   - Using telemetry to identify and target other users
   - Sharing telemetry data inappropriately

**Consequences**: Immediate enforcement phase entry, potential account suspension, and review of license terms.

---

## Policy Changes & Updates

This Fair Usage Policy may be updated periodically. Changes will be:

1. **Announced** via the Z8 blog and email (30 days notice for material changes)
2. **Discussed** with the community on GitHub discussions
3. **Implemented** on the effective date specified
4. **Grandfathered**: Existing enterprise customers may negotiate continuity for current terms

The current policy is effective as of **February 1, 2026** and applies to all new and existing deployments after that date.

---

## Questions & Support

For questions about this Fair Usage Policy:

- **Policy Questions**: https://z8-time.app/fair-usage-faq
- **License Upgrade**: z8@umami-creative.de | https://z8-time.app/pricing
- **Compliance Reports**: compliance@umami-creative.de.de
- **Privacy Concerns**: legal@umami-creative.de.de

---

## Acknowledgment

By using Z8 in a deployment with organization and user management features enabled, you acknowledge that you have read, understood, and agree to comply with this Fair Usage Policy.

Z8 is developed with care by the Umami Creative team and thousands of open-source contributors. We appreciate your support and partnership in building the future of open-source HR and time tracking software.

**Thank you for being part of the Z8 community! 🎉**
