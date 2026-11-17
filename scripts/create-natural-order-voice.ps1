# Generate the Brazilian Portuguese Pitacco announcement once using an
# authorized Azure Speech resource. The WAV is then played OFFLINE by Pitacco.
# Azure credentials stay on the operator's computer, never in the installer.
param(
 [string]$Region=$env:AZURE_SPEECH_REGION,
 [string]$OutputPath=(Join-Path $env:USERPROFILE 'Downloads\Pitacco-Voz-Natural.wav'),
 [ValidateSet('pt-BR-FranciscaNeural','pt-BR-BrendaNeural','pt-BR-AntonioNeural')]
 [string]$Voice='pt-BR-FranciscaNeural'
)
$ErrorActionPreference='Stop'
$key=$env:AZURE_SPEECH_KEY
if ([string]::IsNullOrWhiteSpace($key) -or [string]::IsNullOrWhiteSpace($Region)) {
 throw 'Configure AZURE_SPEECH_KEY e AZURE_SPEECH_REGION de um recurso Azure Speech autorizado. A chave nunca deve entrar no GitHub.'
}
if ($Region -notmatch '^[a-z][a-z0-9-]{1,30}$') {throw 'Região Azure inválida.'}
$uri="https://$Region.tts.speech.microsoft.com/cognitiveservices/v1"
$ssml=@"
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="pt-BR">
 <voice name="$Voice">
  <prosody rate="+3%" pitch="+0%">Você tem um novo pedido!</prosody>
 </voice>
</speak>
"@
$headers=@{
 'Ocp-Apim-Subscription-Key'=$key
 'X-Microsoft-OutputFormat'='riff-24khz-16bit-mono-pcm'
 'User-Agent'='PitaccoVoiceOnce'
}
# Use UTF-8 for accents in "Você". A one-time synthesis is enough for all orders.
$payload=[Text.Encoding]::UTF8.GetBytes($ssml)
Invoke-WebRequest -Uri $uri -Method Post -Headers $headers -ContentType 'application/ssml+xml' -Body $payload -OutFile $OutputPath
[byte[]]$bytes=[IO.File]::ReadAllBytes($OutputPath)
if ($bytes.Length -lt 2048 -or [Text.Encoding]::ASCII.GetString($bytes,0,4) -ne 'RIFF') {
 Remove-Item -LiteralPath $OutputPath -Force
 throw 'O serviço não retornou WAV válido.'
}
Write-Host "Voz neural brasileira gerada: $OutputPath"
Write-Host 'Importe o WAV no Pitacco Windows > Pedidos > Volume da voz natural.'
Write-Host 'Sem chamada online por pedido; respeite os termos de uso comercial do serviço.'
