param([string]$Container='jamifood-hardening-test',[string]$Database='jami_test',[string]$OutputDirectory=(Join-Path $PSScriptRoot '../.local/restore-evidence'))
$ErrorActionPreference='Stop'
if($Database -notmatch '^jami_test(_[0-9]+)?$'){throw 'Only an isolated test database may be used.'}
function Invoke-DockerChecked([string[]]$Arguments){$result=& docker @Arguments;if($LASTEXITCODE -ne 0){throw "Docker operation failed: $($Arguments[0])"};return $result}
function Read-Query([string]$Target,[string]$Sql){$result=$Sql | docker exec -i $Container psql -U jami -d $Target -At -v ON_ERROR_STOP=1;if($LASTEXITCODE -ne 0){throw 'SQL verification failed'};return $result}
$stamp=Get-Date -Format 'yyyyMMddHHmmss'
$restored="jami_restore_$stamp"
$archive="/tmp/jami-restore-$stamp.dump"
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$localArchive=Join-Path $OutputDirectory "jami-$stamp.dump"
Invoke-DockerChecked @('exec',$Container,'pg_dump','-U','jami','-d',$Database,'-Fc','-f',$archive)
Invoke-DockerChecked @('exec',$Container,'pg_restore','-l',$archive) | Out-Null
Invoke-DockerChecked @('cp',"${Container}:$archive",$localArchive)
$checksum=(Get-FileHash -LiteralPath $localArchive -Algorithm SHA256).Hash
Invoke-DockerChecked @('exec',$Container,'createdb','-U','jami',$restored)
Invoke-DockerChecked @('exec',$Container,'pg_restore','--exit-on-error','--no-owner','-U','jami','-d',$restored,$archive)
$results=@()
foreach($table in @('Client','Subscription','MealRight','Order','Payment','StockItem','StockLot','StockMovement','AuditLog')){
  $sql='SELECT count(*) FROM "'+$table+'";'
  $before=Read-Query $Database $sql
  $after=Read-Query $restored $sql
  if("$before" -ne "$after"){throw "Restore mismatch: $table"}
  $results += [pscustomobject]@{table=$table;source="$before";restored="$after"}
}
foreach($entry in @(@('Subscription','balance'),@('StockItem','quantity'),@('Payment','receivedAmount'))){
  $sql='SELECT COALESCE(sum("'+$entry[1]+'"),0) FROM "'+$entry[0]+'";'
  $before=Read-Query $Database $sql
  $after=Read-Query $restored $sql
  if("$before" -ne "$after"){throw 'Restored financial/stock aggregate differs.'}
  $results += [pscustomobject]@{table=($entry -join '.');source="$before";restored="$after"}
}
[pscustomobject]@{date=(Get-Date).ToString('o');database=$Database;restoredDatabase=$restored;sha256=$checksum;archive=$localArchive;checks=$results;result='PASS'} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputDirectory "restore-$stamp.json") -Encoding UTF8
Write-Output "PASS: restore $restored; SHA256 $checksum"
