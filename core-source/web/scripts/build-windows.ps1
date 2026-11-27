$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if (-not $IsWindows -and $env:OS -ne 'Windows_NT') { throw 'Execute no Windows 10/11.' }
# Sem .env, o primeiro uso pede URL/chave pública do Supabase.
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Dependências falharam' }
npm test
if ($LASTEXITCODE -ne 0) { throw 'Testes JS falharam' }
npm ci --prefix tests/backend
if ($LASTEXITCODE -ne 0) { throw 'Dependências SQL falharam' }
npm test --prefix tests/backend
if ($LASTEXITCODE -ne 0) { throw 'Testes SQL falharam' }
cargo test --locked --manifest-path native-tests/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw 'Testes Rust falharam' }
npm run desktop:build -- --bundles nsis
if ($LASTEXITCODE -ne 0) { throw 'Build Windows falhou' }
Get-ChildItem src-tauri/target/release/bundle/nsis/*.exe | Get-FileHash -Algorithm SHA256
