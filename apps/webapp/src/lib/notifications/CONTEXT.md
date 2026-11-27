# Notifications

How Z8 tells people that something happened, in the app and over every outbound channel, in a language the recipient reads.

## Language

**Notification**:
A record that something happened which a user should know about, stored once and delivered over each channel the recipient has enabled.
_Avoid_: alert, message, event

**Channel**:
One way a notification reaches its recipient: in-app, email, push, Telegram, Slack, Teams, Discord or webhook.
_Avoid_: transport, provider, medium

**Organization-owned chat app**:
The Slack app or Teams, Telegram, or Discord bot that an organization owns and whose credentials its admins manage in Z8.

**Deployment-managed chat app**:
The shared Slack app or Teams bot whose app credentials Z8 manages for existing organization connections.

**Chat installation**:
An organization's connection to a particular chat app or bot in its external workspace or tenant, where applicable.

**Credential rotation**:
Updating the credentials of an existing chat installation while keeping the same external app or bot identity.

**App replacement**:
Switching the organization to a different chat installation for new delivery. The previous installation can continue to service the approval cards it already sent during retirement.

**Recipient language**:
The language an outbound message is written in: the recipient's saved language, then (for sign-in emails only) the language of the page that sent the request, then the organization's default language, then English. Recipients without a Z8 user, such as approved external recipients and billing contacts, get the organization's default language.
_Avoid_: viewer locale, user language, browser language

**Email override**:
An organization's own subject and body for one kind of email, or a platform admin's for one billing email, sent exactly as written to every recipient whatever their recipient language.
_Avoid_: custom template, email template (for the override itself)

**Notification preference**:
A user's own opt-in or opt-out choice for one notification type over one channel, shared across every organization they belong to. Channel availability (such as Slack, Teams, Discord or Telegram) belongs to each organization separately.
_Avoid_: organization notification preference, alert setting, subscription
