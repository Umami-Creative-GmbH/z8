# Notifications

How Z8 tells people that something happened, in the app and over every outbound channel, in a language the recipient reads.

## Language

**Notification**:
A record that something happened which a user should know about, stored once and delivered over each channel the recipient has enabled.
_Avoid_: alert, message, event

**Channel**:
One way a notification reaches its recipient: in-app, email, push, Telegram, Slack, Teams, Discord or webhook.
_Avoid_: transport, provider, medium

**Recipient language**:
The language an outbound message is written in: the recipient's saved language, then (for sign-in emails only) the language of the page that sent the request, then the organization's default language, then English. Recipients without a Z8 user, such as approved external recipients and billing contacts, get the organization's default language.
_Avoid_: viewer locale, user language, browser language

**Email override**:
An organization's own subject and body for one kind of email, or a platform admin's for one billing email, sent exactly as written to every recipient whatever their recipient language.
_Avoid_: custom template, email template (for the override itself)
