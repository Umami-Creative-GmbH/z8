param([switch]$ResumeSerial)
$ErrorActionPreference='Continue'
$env:pnpm_config_verify_deps_before_run='false'
$checks1829=Join-Path (Get-Location).Path '.tmp/1829-root-checks'
$commands1829=if($ResumeSerial) {@(Get-Content -LiteralPath (Join-Path $checks1829 'commands.json') -Raw -Encoding UTF8 | ConvertFrom-Json)} else {@()}
$phases1829=if($ResumeSerial) {@('compatibility-serial','adversarial','preservation','types')} else {@('exact','compatibility','adversarial','preservation','types')}
foreach($name1829 in $phases1829) {
 $arguments1829=@('--config.verify-deps-before-run=false','--filter','webapp')
 if($name1829 -eq 'types') { $arguments1829+=@('typecheck') }
 elseif($name1829 -eq 'exact' -or $name1829.StartsWith('compatibility')) {
  $selection1829=if($name1829 -eq 'exact') {'exact'} else {'compatibility'}
  $workers1829=if($name1829 -eq 'compatibility-serial') {'1'} else {'2'}
  $files1829=@(Get-Content -LiteralPath ('.tmp/merge1829-audit/'+$selection1829+'-selection.txt') -Encoding UTF8)
  $arguments1829+=@('exec','vitest','run','--project','unit','--maxWorkers',$workers1829)+$files1829+@('--reporter=json','--outputFile='+(Join-Path $checks1829 ($name1829+'-unit.json')))
 } else {
  $config1829=if($name1829 -eq 'adversarial') {'vitest.config.ts'} else {'vitest-preservation.config.mts'}
  $project1829=if($name1829 -eq 'adversarial') {'audit'} else {'preservation'}
  $arguments1829+=@('exec','vitest','run','--config',('../../.tmp/merge1829-audit/'+$config1829),'--project',$project1829,'--maxWorkers','1','--reporter=json','--outputFile='+(Join-Path $checks1829 ($name1829+'-unit.json')))
 }
 & pnpm @arguments1829 *> (Join-Path $checks1829 ($name1829+'.log'))
 $commands1829+=@{name=$name1829;command=@('pnpm')+$arguments1829;exitCode=$LASTEXITCODE}
 $commands1829 | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $checks1829 'commands.json') -Encoding UTF8
 if($LASTEXITCODE -ne 0) { throw ('Fresh '+$name1829+' check failed; retain report before adaptation') }
}
Write-Output 'Fresh exact, compatibility, independent/preservation probes and complete types passed.'
