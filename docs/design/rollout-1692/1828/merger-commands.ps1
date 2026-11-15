# Exact meaningful executed commands; all shell pnpm invocations set this first.
$env:pnpm_config_verify_deps_before_run='false'
git merge-tree --write-tree HEAD 028b4c0a026419567874190ce20b019180c7f304
git merge --no-ff 028b4c0a026419567874190ce20b019180c7f304 -m 'Merge #1828 onboarding notifications into UI refresh integration'
pnpm --config.verify-deps-before-run=false --filter webapp exec vitest run --project unit --maxWorkers 2 'src/app/[locale]/onboarding/notifications/page.test.tsx' 'src/app/[locale]/onboarding/layout.test.tsx' 'src/app/[locale]/onboarding/run-onboarding-action.test.ts' src/hooks/use-push-notifications.test.tsx src/lib/effect/services/onboarding.service.test.ts src/tolgee/extracted-key-defaults.test.ts src/components/ui/page-header.test.tsx --reporter=json --outputFile=../../.tmp/merge1828-audit/unit-exact.json
# Compatibility invocation uses the exact frozen list compat-files.txt, selected from rg --files with onboarding/notification/F1/F3/1726/1727 paths.
$compat=Get-Content .tmp/merge1828-audit/compat-files.txt
pnpm --config.verify-deps-before-run=false --filter webapp exec vitest run --project unit --maxWorkers 2 @compat --reporter=json --outputFile=../../.tmp/merge1828-audit/unit-compat.json
pnpm --config.verify-deps-before-run=false --filter webapp typecheck
$owned=@('src/app/[locale]/onboarding/notifications/page-client.tsx','src/app/[locale]/onboarding/notifications/page.test.tsx','src/app/[locale]/onboarding/notifications/actions.integration.test.ts')
pnpm --config.verify-deps-before-run=false --filter webapp exec biome check --config-path=biome.jsonc --error-on-warnings --line-ending=crlf @owned
pnpm --config.verify-deps-before-run=false --filter webapp exec biome check --config-path=biome.jsonc --error-on-warnings @owned
pnpm --config.verify-deps-before-run=false --filter webapp exec biome check --config-path=biome.jsonc --error-on-warnings --formatter-enabled=false @owned
pnpm --config.verify-deps-before-run=false exec react-doctor apps/webapp --scope changed --base 383c64f06a86bf94b89b980f9ec1091c6040d554 --verbose --no-supply-chain --no-telemetry --no-score --max-duration 90 --json
pnpm --config.verify-deps-before-run=false node .tmp/merge1828-audit/audit.mjs
$resultPath=Join-Path (Get-Location).Path '.tmp/merge1828-audit/unit-adversarial-proof.json'
pnpm --config.verify-deps-before-run=false --filter webapp exec vitest run --config ../../.tmp/merge1828-audit/vitest-adversarial.config.ts --project unit --maxWorkers 1 --reporter=json --outputFile=$resultPath
git diff --check 'HEAD^1' HEAD
git status --short
