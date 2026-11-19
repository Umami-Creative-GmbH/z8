param([Parameter(Mandatory=$true)][string]$Name)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$app = Join-Path $root 'apps/webapp'
$out = $PSScriptRoot
$env:pnpm_config_verify_deps_before_run = 'false'
Set-Location -LiteralPath $app
$files = @(git -C $root diff --name-only 58ea18603a936d102f0625e3303f4c05689a9961 HEAD -- apps/webapp/src | ForEach-Object { $_ -replace '^apps/webapp/','' })
if ($files.Count -ne 14) { throw "Expected fourteen changed source/test paths, got $($files.Count)" }
switch -Regex ($Name) {
 'unit' { $argv = @('exec','vitest','run','--project','unit','--maxWorkers','2','src/components/reports','src/lib/reports','src/lib/projects/report-share','src/app/[locale]/(app)/reports/projects','src/lib/navigation/route-metadata.test.ts','src/lib/billable-time/hand-off/timesheet-document.test.ts','src/components/payroll/payroll-workspace.test.tsx','src/app/[locale]/onboarding','--reporter=json',"--outputFile=$out/unit.json") }
 'types' { $argv = @('run','typecheck') }
 '^public' { $argv = @('exec','vitest','run','--config','.tmp/1736-merger/vitest.config.ts','--project','public-audit','--maxWorkers','1','--reporter=json',"--outputFile=$out/$Name.json") }
 '^format' { $argv = @('exec','biome','check','--error-on-warnings','--config-path=./biome.jsonc','--line-ending=crlf','--line-width=100') + $files }
 '^lint' { $argv = @('exec','biome','check','--error-on-warnings','--config-path=./biome.jsonc','--formatter-enabled=false') + $files }
 'doctor' { Set-Location -LiteralPath $root; $argv = @('exec','react-doctor','apps/webapp','--scope','changed','--base','58ea18603a936d102f0625e3303f4c05689a9961','--no-score','--no-supply-chain','--max-duration','90','--no-parallel','--verbose','--json','--json-out',"$out/doctor.json") }
 default { throw 'Unknown check name' }
}
$started = Get-Date -Format o
$command = @('--config.verify-deps-before-run=false') + $argv
& pnpm @command *> (Join-Path $out "$Name.log")
$result = $LASTEXITCODE
[pscustomobject]@{name=$Name;cwd=(Get-Location).Path;argv=@('pnpm')+$command;environment=@{pnpm_config_verify_deps_before_run='false'};startedAt=$started;finishedAt=(Get-Date -Format o);exitCode=$result} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $out "$Name-command.json") -Encoding UTF8
Write-Output "$Name exit=$result"
Get-Content -LiteralPath (Join-Path $out "$Name.log") -Tail 12
exit $result
