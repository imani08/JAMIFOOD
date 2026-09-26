param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,

  [string]$ReportRoot = "D:\JAMIFOOD_BACKUPS\restore-tests"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $BackupFile)) {
  throw "Sauvegarde introuvable : $BackupFile"
}

if (-not (Test-Path $ReportRoot)) {
  New-Item -ItemType Directory -Force -Path $ReportRoot | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$container = "jami-food-restore-test-$timestamp"
$containerBackup = "/tmp/jami-food-restore.dump"
$reportFile = Join-Path $ReportRoot "restore-test-$timestamp.txt"

Write-Host "JAMI FOOD - Test de restauration isolé"
Write-Host "Archive : $BackupFile"

# A unique test container avoids deleting a pre-existing environment.

docker run `
  -d `
  --name $container `
  -e POSTGRES_USER=jami `
  -e POSTGRES_PASSWORD=restore_test_only `
  -e POSTGRES_DB=jami_food_restore_test `
  postgres:16-alpine | Out-Null

if ($LASTEXITCODE -ne 0) {
  throw "Impossible de démarrer PostgreSQL de restauration."
}

try {
  $ready = $false

  for ($i = 0; $i -lt 30; $i++) {
    docker exec $container `
      pg_isready `
      -U jami `
      -d jami_food_restore_test 2>$null | Out-Null

    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }

    Start-Sleep -Seconds 2
  }

  if (-not $ready) {
    throw "PostgreSQL de restauration n'est pas prêt."
  }

  docker cp "$BackupFile" "${container}:$containerBackup"

  if ($LASTEXITCODE -ne 0) {
    throw "Impossible de copier l'archive dans l'environnement de test."
  }

  docker exec $container `
    pg_restore `
    -U jami `
    -d jami_food_restore_test `
    --no-owner `
    --no-privileges `
    $containerBackup

  if ($LASTEXITCODE -ne 0) {
    throw "La restauration a échoué."
  }

  $lines = @()
  $lines += "JAMI FOOD - RAPPORT DE TEST DE RESTAURATION"
  $lines += "Date : $((Get-Date).ToString('o'))"
  $lines += "Archive : $BackupFile"
  $lines += ""
  $lines += "CONTROLES"

  $queries = @(
    @{
      Label = "Clients"
      Sql = 'SELECT count(*) FROM "Client";'
    },
    @{
      Label = "Abonnements"
      Sql = 'SELECT count(*) FROM "Subscription";'
    },
    @{
      Label = "Solde total abonnements"
      Sql = 'SELECT COALESCE(sum(balance), 0) FROM "Subscription";'
    },
    @{
      Label = "Commandes / ventes"
      Sql = 'SELECT count(*) FROM "Order";'
    },
    @{
      Label = "Paiements"
      Sql = 'SELECT count(*) FROM "Payment";'
    },
    @{
      Label = "Journaux audit"
      Sql = 'SELECT count(*) FROM "AuditLog";'
    }
  )

  foreach ($query in $queries) {
    $value = docker exec $container `
      psql `
      -U jami `
      -d jami_food_restore_test `
      -Atc $query.Sql

    if ($LASTEXITCODE -ne 0) {
      throw "Contrôle SQL échoué : $($query.Label)"
    }

    $lines += "$($query.Label) : $value"
  }

  $lines += ""
  $lines += "RESULTAT : RESTAURATION TECHNIQUE REUSSIE"
  $lines += "Important : comparer ces valeurs aux données source avant recette finale."

  $lines |
    Set-Content `
      -Encoding UTF8 `
      -Path $reportFile

  Write-Host ""
  Write-Host "Restauration de test OK"
  Write-Host "Rapport : $reportFile"
}
finally {
  docker rm -f $container 2>$null | Out-Null
}
