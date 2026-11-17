# Pitacco Windows: local Portuguese speech, independently louder than the bell.
# Runs only on the merchant's PC. No external TTS API, voice upload, or network.
$ErrorActionPreference = 'Stop'
$level = 3
if ($env:PITACCO_VOICE_LEVEL -match '^[123]$') { $level = [int]$env:PITACCO_VOICE_LEVEL }
$gain = switch ($level) { 1 { 1.20 } 2 { 2.15 } default { 3.20 } }
$mutex = New-Object System.Threading.Mutex($false, 'Local\PitaccoNewOrderVoice')
$locked = $false
try {
  $locked = $mutex.WaitOne(0)
  if (-not $locked) { exit 0 } # Avoid two simultaneous spoken alerts
  $folder = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Pitacco\Alertas'
  [IO.Directory]::CreateDirectory($folder) | Out-Null
  $file = Join-Path $folder "novo-pedido-voz-pt-v1-$level.wav"
  if (-not (Test-Path -LiteralPath $file) -or (Get-Item -LiteralPath $file).Length -lt 2048) {
    Add-Type -AssemblyName System.Speech
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $stream = New-Object System.IO.MemoryStream
    try {
      $voices = @($synth.GetInstalledVoices() | Where-Object {
        $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'pt-BR'
      })
      if (-not $voices.Count) {
        $voices = @($synth.GetInstalledVoices() | Where-Object {
          $_.Enabled -and $_.VoiceInfo.Culture.TwoLetterISOLanguageName -eq 'pt'
        })
      }
      if (-not $voices.Count) {
        throw 'Nenhuma voz em portugues instalada no Windows. Instale o recurso Fala do idioma Portugues (Brasil).'
      }
      $synth.SelectVoice($voices[0].VoiceInfo.Name)
      $synth.Volume = 100
      $synth.Rate = 0
      $synth.SetOutputToWaveStream($stream)
      $synth.Speak('Você tem um novo pedido.')
      $audio = $stream.ToArray()
    } finally {
      $synth.Dispose()
      $stream.Dispose()
    }

    # Audio normalization is limited to signed 16-bit PCM. It never amplifies
    # the bell, and the tanh limiter prevents overflows/clipping.
    $offset = 12
    $pcm = $false
    $bits = 0
    $start = -1
    $end = -1
    while ($offset + 8 -le $audio.Length) {
      $chunkName = [Text.Encoding]::ASCII.GetString($audio, $offset, 4)
      $size = [BitConverter]::ToUInt32($audio, $offset + 4)
      $dataOffset = $offset + 8
      if ($dataOffset + $size -gt $audio.Length) { throw 'Formato de voz WAV inesperado.' }
      if ($chunkName -eq 'fmt ') {
        $pcm = ([BitConverter]::ToUInt16($audio, $dataOffset) -eq 1)
        $bits = [BitConverter]::ToUInt16($audio, $dataOffset + 14)
      }
      if ($chunkName -eq 'data') {
        $start = $dataOffset
        $end = $dataOffset + $size
      }
      $offset = [int]($dataOffset + $size + ($size % 2))
    }
    if (-not $pcm -or $bits -ne 16 -or $start -lt 0 -or $end -le $start) {
      throw 'A voz do Windows nao forneceu audio PCM de 16 bits.'
    }
    for ($i = $start; $i + 1 -lt $end; $i += 2) {
      $sample = [BitConverter]::ToInt16($audio, $i)
      $amplified = [Math]::Round(31800.0 * [Math]::Tanh(($sample * $gain) / 31800.0))
      $value = [BitConverter]::GetBytes([Int16]([Math]::Max(-32768, [Math]::Min(32767, $amplified))))
      $audio[$i] = $value[0]
      $audio[$i + 1] = $value[1]
    }
    $temporary = "$file.$PID.tmp"
    [IO.File]::WriteAllBytes($temporary, $audio)
    Move-Item -LiteralPath $temporary -Destination $file -Force
  }
  $player = New-Object System.Media.SoundPlayer($file)
  try { $player.PlaySync() } finally { $player.Dispose() }
} catch {
  [Console]::Error.WriteLine("Voz do Pitacco: $($_.Exception.Message)")
  exit 1
} finally {
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
