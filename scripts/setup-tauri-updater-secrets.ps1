# Pitacco — gerar e registrar assinatura Tauri 2 no GitHub Actions
# Execute SOMENTE em um computador confiável do proprietário do GitHub.
# Não copie a chave privada para chat, PR, issue ou arquivo versionado.
# Requisitos: Node.js 20+, GitHub CLI (gh), acesso admin ao repositório.
param(
  [string]$Repository = 'juniorclerio37-creator/pitacco'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Require-Command([string]$Name, [string]$Help) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Instale $Name antes de executar: $Help"
  }
}
function Require-Exit([string]$Step) {
  if ($LASTEXITCODE -ne 0) { throw "Falha em $Step. Interrompido sem sobrescrever chaves." }
}

Require-Command 'node' 'https://nodejs.org/'
Require-Command 'npx' 'https://nodejs.org/'
Require-Command 'gh' 'https://cli.github.com/'
if (-not ($Repository -eq 'juniorclerio37-creator/pitacco')) {
  throw 'O script somente pode atuar no repositório Pitacco autorizado.'
}

& gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Será aberto o login oficial do GitHub no navegador.'
  & gh auth login --web --scopes repo,workflow
  Require-Exit 'login do GitHub'
}
$actual = & gh repo view $Repository --json nameWithOwner -q '.nameWithOwner'
Require-Exit 'verificação do repositório'
if ($actual.Trim() -cne $Repository) {
  throw "Repositório retornado inesperado: $actual"
}

$keyDir = Join-Path $HOME '.tauri'
New-Item -ItemType Directory -Force -Path $keyDir | Out-Null
$keyPath = Join-Path $keyDir 'pitacco-updater.key'
$publicPath = "$keyPath.pub"
if ((Test-Path -LiteralPath $keyPath) -or (Test-Path -LiteralPath $publicPath)) {
  throw "O par de chaves já existe em $keyPath. Não substituir: versões anteriores dependem da mesma chave."
}

Write-Host 'A chave de assinatura será criada neste computador, nunca no repositório.'
Write-Host 'Escolha uma senha forte e guarde-a em seu gerenciador de senhas.'
$securePassword = Read-Host 'Senha para proteger a chave privada do Tauri' -AsSecureString
$securePasswordConfirm = Read-Host 'Repita a senha' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$bstrConfirm = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePasswordConfirm)
$password = $null
$passwordConfirm = $null
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $passwordConfirm = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstrConfirm)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstrConfirm)
}
try {
  if ([string]::IsNullOrWhiteSpace($password) -or $password.Length -lt 16) {
    throw 'Use uma senha de no mínimo 16 caracteres.'
  }
  if ($password -cne $passwordConfirm) { throw 'As senhas não coincidem.' }

  # Versão 2 do assinador oficial do Tauri. A senha passa somente ao processo local.
  & npx --yes '@tauri-apps/cli@2' signer generate -w $keyPath -p $password --ci
  Require-Exit 'geração das chaves Tauri'
  if (-not (Test-Path -LiteralPath $keyPath) -or -not (Test-Path -LiteralPath $publicPath)) {
    throw 'O Tauri não criou os dois arquivos esperados.'
  }
  $private = (Get-Content -LiteralPath $keyPath -Raw).Trim()
  $public = (Get-Content -LiteralPath $publicPath -Raw).Trim()
  if ($private.Length -lt 50 -or $public.Length -lt 30) {
    throw 'As chaves geradas não têm formato esperado; interrompendo o cadastro.'
  }

  # gh criptografa os segredos localmente antes de enviá-los ao GitHub.
  $private | & gh secret set TAURI_SIGNING_PRIVATE_KEY -R $Repository
  Require-Exit 'cadastro da chave privada'
  $password | & gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R $Repository
  Require-Exit 'cadastro da senha de assinatura'
  $public | & gh secret set PITACCO_TAURI_UPDATER_PUBLIC_KEY -R $Repository
  Require-Exit 'cadastro da chave pública'

  $names = & gh secret list -R $Repository --json name -q '.[].name'
  Require-Exit 'conferência dos segredos'
  foreach ($name in @('TAURI_SIGNING_PRIVATE_KEY','TAURI_SIGNING_PRIVATE_KEY_PASSWORD','PITACCO_TAURI_UPDATER_PUBLIC_KEY')) {
    if (@($names) -notcontains $name) { throw "Não foi possível confirmar o secret: $name" }
  }
  Write-Host ''
  Write-Host 'SUCESSO: os três Secrets foram cadastrados no GitHub Actions.'
  Write-Host "BACKUP: guarde o arquivo $keyPath e a senha em local seguro e separado."
  Write-Host 'Não divulgue a chave privada e não a inclua em commits. Não gere um novo par para a mesma base instalada.'
} finally {
  $password = $null
  $passwordConfirm = $null
  $securePassword = $null
  $securePasswordConfirm = $null
  $private = $null
}
