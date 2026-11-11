import sys, wave
import numpy as np
from pathlib import Path
from faster_whisper import WhisperModel
sys.stdout.reconfigure(encoding="utf-8")
m = WhisperModel("small", device="cpu", compute_type="int8")
for p in sorted(Path(sys.argv[1]).glob("*.wav")):
    print("==", p.name, flush=True)
    with wave.open(str(p)) as w:
        a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    segs, _ = m.transcribe(a, language="vi", beam_size=5)
    for s in segs:
        print(f"[{s.start:5.1f}-{s.end:5.1f}] {s.text.strip()}", flush=True)
