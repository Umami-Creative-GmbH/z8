param([Parameter(Mandatory)][string]$Checkout,[Parameter(Mandatory)][string]$Fixture)
$repo=(Resolve-Path -LiteralPath $Checkout).Path
$identity=Get-Content -LiteralPath (Join-Path $Fixture 'dev-process-private.json') -Raw -Encoding utf8 | ConvertFrom-Json
if ([IO.Path]::GetFullPath($identity.repo) -ne $repo) { throw 'Checkout mismatch' }
$process=Get-CimInstance Win32_Process -Filter "ProcessId=$($identity.pid)"
if ($process) {
 if (!$process.CommandLine.Replace('\','/').Contains(($repo+'/apps/webapp/node_modules/next/dist/bin/next').Replace('\','/'))) { throw 'Owned Next identity mismatch' }
 $all=@(Get-CimInstance Win32_Process);$ids=[Collections.Generic.HashSet[int]]::new();$null=$ids.Add([int]$identity.pid)
 do{$added=$false;foreach($child in $all){if($ids.Contains([int]$child.ParentProcessId) -and $ids.Add([int]$child.ProcessId)){$added=$true}}}while($added)
 foreach($id in @($ids) | Sort-Object -Descending){Stop-Process -Id $id -Force -ErrorAction SilentlyContinue}
}
Write-Output 'Stopped verified owned Next tree.'
