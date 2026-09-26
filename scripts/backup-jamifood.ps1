param(
  [string]$ProjectRoot = "D:\mmcristelle\JAMIFOOD",
  [string]$BackupRoot = "D:\JAMIFOOD_BACKUPS",
  [int]$RetentionDays = 0
)

$ErrorActionPreference = "Stop"

Set-Location $ProjectRoot

if (-not (Test-Path $BackupRoot)) {
  New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$fileName = "jami_food-$timestamp.dump"
$containerFile = "/tmp/$fileName"
$backupFile = Join-Path $BackupRoot $fileName
$verifyFile = "/tmp/verify-$timestamp.dump"
$logFile = Join-Path $BackupRoot "backup-log.csv"

Write-Host "JAMI FOOD - Sauvegarde PostgreSQL"
Write-Host "Destination : $backupFile"

docker compose exec -T postgres `
  pg_dump `
  -U jami `
  -d jami_food `
  -Fc `
  -f $containerFile

if ($LASTEXITCODE -ne 0) {
  throw "Echec de pg_dump."
}

docker compose cp "postgres:$containerFile" "$backupFile"

if ($LASTEXITCODE -ne 0) {
  throw "Echec de copie de la sauvegarde."
}

docker compose exec -T postgres rm -f $containerFile | Out-Null

if (-not (Test-Path $backupFile)) {
  throw "Le fichier de sauvegarde n'a pas été créé."
}

if ((Get-Item $backupFile).Length -le 0) {
  throw "Le fichier de sauvegarde est vide."
}

# Vérification technique de l'archive.
docker compose cp "$backupFile" "postgres:$verifyFile" | Out-Null

docker compose exec -T postgres `
  pg_restore `
  -l $verifyFile | Out-Null

if ($LASTEXITCODE -ne 0) {
  docker compose exec -T postgres rm -f $verifyFile | Out-Null
  throw "L'archive créée n'est pas lisible par pg_restore."
}

docker compose exec -T postgres rm -f $verifyFile | Out-Null

$hash = (Get-FileHash -Algorithm SHA256 $backupFile).Hash
$size = (Get-Item $backupFile).Length

"$hash  $fileName" |
  Set-Content `
    -Encoding UTF8 `
    -Path "$backupFile.sha256"

if (-not (Test-Path $logFile)) {
  "date;file;size_bytes;sha256;status" |
    Set-Content -Encoding UTF8 -Path $logFile
}

"$((Get-Date).ToString('o'));$fileName;$size;$hash;OK" |
  Add-Content -Encoding UTF8 -Path $logFile

# La durée de conservation doit être validée avant production.
# 0 = aucune suppression automatique.
if ($RetentionDays -gt 0) {
  $cutoff = (Get-Date).AddDays(-$RetentionDays)

  Get-ChildItem `
    -Path $BackupRoot `
    -Filter "jami_food-*.dump" |
    Where-Object {
      $_.LastWriteTime -lt $cutoff
    } |
    ForEach-Object {
      Remove-Item -Force $_.FullName

      $checksum = "$($_.FullName).sha256"

      if (Test-Path $checksum) {
        Remove-Item -Force $checksum
      }
    }
}

Write-Host ""
Write-Host "Sauvegarde OK"
Write-Host "Fichier : $backupFile"
Write-Host "Taille  : $size octets"
Write-Host "SHA256  : $hash"
