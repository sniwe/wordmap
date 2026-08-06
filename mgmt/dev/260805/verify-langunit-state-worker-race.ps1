$ErrorActionPreference = 'Stop'
node (Join-Path $PSScriptRoot 'verify-langunit-state-worker-race.mjs')
if ($LASTEXITCODE -ne 0) { throw "runtime verifier failed: $LASTEXITCODE" }
