$ErrorActionPreference = 'Stop'
$env:pnpm_config_verify_deps_before_run='false'
$reportRoot1828 = Join-Path (Get-Location).Path '.tmp/1828-root-checks'
$commands1828 = @()
$compat1828 = Get-Content -LiteralPath .tmp/merge1828-audit/compat-files.txt -Encoding UTF8
$command1828 = @('--config.verify-deps-before-run=false','--filter','webapp','exec','vitest','run','--project','unit','--maxWorkers','2') + $compat1828 + @('--reporter=json',('--outputFile=' + (Join-Path $reportRoot1828 'compatibility-unit.json')))
& pnpm @command1828 > (Join-Path $reportRoot1828 'compatibility-unit.log') 2>&1
$commands1828 += @{name='compatibility';command=@('pnpm')+$command1828;exitCode=$LASTEXITCODE}
if ($LASTEXITCODE -ne 0) { throw 'Compatibility selection failed' }
$command1828 = @('--config.verify-deps-before-run=false','--filter','webapp','exec','vitest','run','--config','../../.tmp/merge1828-audit/vitest-adversarial.config.ts','--project','unit','--maxWorkers','1','--reporter=json',('--outputFile=' + (Join-Path $reportRoot1828 'adversarial-unit.json')))
& pnpm @command1828 > (Join-Path $reportRoot1828 'adversarial-unit.log') 2>&1
$commands1828 += @{name='adversarial';command=@('pnpm')+$command1828;exitCode=$LASTEXITCODE}
if ($LASTEXITCODE -ne 0) { throw 'Independent heading probe failed' }
$command1828 = @('--config.verify-deps-before-run=false','--filter','webapp','typecheck')
& pnpm @command1828 > (Join-Path $reportRoot1828 'types.log') 2>&1
$commands1828 += @{name='types';command=@('pnpm')+$command1828;exitCode=$LASTEXITCODE}
if ($LASTEXITCODE -ne 0) { throw 'Full types failed' }
$commands1828 | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $reportRoot1828 'commands.json') -Encoding UTF8
Write-Output 'Compatibility, independent heading and full types passed.'
