# Pre-preservation service worker (`66bbc7b5`)

Verbatim copies of `apps/webapp/public/{sw.js,lib/offline-queue-db.js,lib/sync-service.js}`
at `66bbc7b5`, the desired production core release recorded for #266. They are the
destructive old queue reader used by `service-worker-takeover.browser.test.ts`.

Do not edit or reformat these files. Check them with
`git show 66bbc7b5:apps/webapp/public/sw.js | diff - sw.js`.
