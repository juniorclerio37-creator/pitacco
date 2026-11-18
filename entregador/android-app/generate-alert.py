"""Generate a loud but clean, self-contained Android notification chime.

Notification volume remains controlled by Android; this improves *perceived*
loudness of the WAV, without accessing device media/notification volume.
"""
from pathlib import Path
import math
import struct
import wave

rate = 24000
duration = 1.78
output = Path(__file__).parent / 'app/src/main/res/raw/pitacco_assignment.wav'
output.parent.mkdir(parents=True, exist_ok=True)

# Distinct double-ring phrase, strong fundamental plus overtone for speech/noise environments.
notes = [
    (0.00, 784.00, 0.75), (0.12, 1174.66, 0.68),
    (0.33, 1567.98, 0.62), (0.80, 784.00, 0.74),
    (0.93, 1174.66, 0.69), (1.14, 1567.98, 0.64),
]
frames = bytearray()
for index in range(round(duration * rate)):
    time = index / rate
    signal = 0.0
    for start, pitch, strength in notes:
        elapsed = time - start
        if elapsed < 0 or elapsed > 0.46:
            continue
        attack = min(1, elapsed / 0.004)
        envelope = attack * math.exp(-7.0 * elapsed)
        partials = (math.sin(2 * math.pi * pitch * elapsed)
                    + 0.35 * math.sin(2 * math.pi * 2 * pitch * elapsed)
                    + 0.14 * math.sin(2 * math.pi * 3 * pitch * elapsed))
        signal += strength * envelope * partials
    fade = min(1.0, max(0.0, (duration - time) / 0.12))
    # Smooth limiting, not hard clipping. Peak stays below 0 dBFS.
    sample = 0.985 * math.tanh(4.2 * signal) * fade
    frames.extend(struct.pack('<h', max(-32767, min(32767, round(32767 * sample)))))
# Optionally append a *separate* recorded courier voice. Do NOT reuse the
# merchant's "novo pedido" recording for couriers. The approved spoken line is
# "Pitacco! Você tem uma nova entrega!", with a short pause after the bell.
# A WAV is intentionally required so its audio stays on-device and offline.
voice = Path(__file__).parent / 'assets/voz-entregador.wav'
if voice.exists():
    with wave.open(str(voice), 'rb') as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (1, 2, rate):
            raise ValueError('voz-entregador.wav must be mono PCM16 24000 Hz')
        if source.getnframes() > rate * 12 or source.getnframes() == 0:
            raise ValueError('Unexpected courier voice duration')
        frames.extend(bytes(round(rate * .22) * 2))
        frames.extend(source.readframes(source.getnframes()))
    print('Pitacco Entregador: bell + dedicated courier voice; local/offline playback')
else:
    print('Pitacco Entregador: bell only — courier voice file has not been supplied')
with wave.open(str(output), 'wb') as wav:
    wav.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
    wav.writeframes(frames)
print(f'Generated assignment alert: {len(frames)/(rate*2):.2f} seconds')
