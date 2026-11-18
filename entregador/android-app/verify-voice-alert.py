"""Confirm the approved courier recording is physically bundled in the alert WAV.

This is a build-time assertion: never publish a package claiming to include
the recorded voice if it only contains the bell.
"""
from pathlib import Path
import hashlib
import wave

root = Path(__file__).resolve().parent
voice_file = root / 'assets/voz-entregador.wav'
alert_file = root / 'app/src/main/res/raw/pitacco_assignment.wav'
approved_sha256 = 'fdc529e0b4e8cfb9919038326db4cbdb7e5145b84bde568bdac6001ae816561b'

voice_bytes = voice_file.read_bytes()
assert hashlib.sha256(voice_bytes).hexdigest() == approved_sha256, 'Courier voice differs from approved recording'

with wave.open(str(voice_file), 'rb') as voice:
    assert (voice.getnchannels(), voice.getsampwidth(), voice.getframerate()) == (1, 2, 24000)
    voice_samples = voice.readframes(voice.getnframes())

with wave.open(str(alert_file), 'rb') as alert:
    assert (alert.getnchannels(), alert.getsampwidth(), alert.getframerate()) == (1, 2, 24000)
    alert_samples = alert.readframes(alert.getnframes())

assert len(alert_samples) > len(voice_samples) + 24000, 'Bell or gap before speech is missing'
assert alert_samples.endswith(voice_samples), 'Approved courier voice has not been appended unchanged'
prefix = alert_samples[:len(alert_samples) - len(voice_samples)]
assert prefix[:2400] != bytes(2400), 'Strong bell segment missing'
assert prefix[-(24000//5)*2:] == bytes((24000//5)*2), 'Pause before voice missing'

print(f'APPROVED: bell + pause + original courier voice ({len(alert_samples)/48000:.2f}s, PCM 24kHz mono)')
