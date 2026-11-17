from pathlib import Path
import math
import struct
import wave

rate = 24000
output = Path(__file__).parent / 'app/src/main/res/raw/pitacco_assignment.wav'
output.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(output), 'wb') as wav:
    wav.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
    notes = [(0.00, 784), (0.18, 1047), (0.43, 880), (0.61, 1175)]
    frames = bytearray()
    for index in range(rate):
        t = index / rate
        signal = 0
        for start, pitch in notes:
            elapsed = t - start
            if 0 <= elapsed < .24:
                envelope = min(1, elapsed / .015) * (1 - elapsed / .24) ** 2
                signal += .68 * math.sin(2 * math.pi * pitch * elapsed) * envelope
        frames.extend(struct.pack('<h', round(32767 * max(-1, min(1, signal)))))
    wav.writeframes(frames)
