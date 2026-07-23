$ErrorActionPreference = "Continue"
$Root = Split-Path $PSScriptRoot -Parent
$Assets = Join-Path $Root "phase0-assets"
$Log = Join-Path $Root "docs\upstream\_docker-build.log"

Write-Host "=== MLPilot Docker Build ==="
$base = "docker.m.daocloud.io/library/node:24-bookworm-slim"
if (-not (docker images -q node:24-bookworm-slim 2>$null)) {
  docker pull $base
  docker tag $base node:24-bookworm-slim
}
Push-Location $Assets
docker build --progress=plain --build-arg APT_MIRROR=mirrors.aliyun.com --build-arg NPM_REGISTRY=https://registry.npmmirror.com -t mlpilot-pi-sandbox -f Dockerfile.pi . *>&1 | Tee-Object -FilePath $Log
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { exit $code }
$tmp = Join-Path $env:TEMP "mlpilot-docker-test"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
docker run --rm -v "${tmp}:/workspace" -v mlpilot-pi-sandbox-session:/root/.pi/agent mlpilot-pi-sandbox --version
Write-Host "=== Build OK ==="