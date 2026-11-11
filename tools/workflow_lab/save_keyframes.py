import base64, json, sys, subprocess
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
src, out = Path(sys.argv[1]), Path(sys.argv[2])
w = json.loads(src.read_text(encoding="utf-8"))
if "value" in w and "nodes" not in w:
    w = w["value"]
files = []
for n in w["nodes"]:
    kf = n["data"].get("keyframe")
    if kf:
        head, b = kf.split(",", 1)
        raw = base64.b64decode(b)
        f = out / f"kf_{len(files)+1}.{ 'webp' if raw[:4] == b'RIFF' else 'png'}"
        f.write_bytes(raw)
        print(f.name, head, raw[:4], len(raw))
        files.append(f)
args = ["ffmpeg", "-v", "error", "-y"]
for f in files:
    args += ["-i", str(f)]
fc = ";".join(f"[{i}]scale=300:-2[v{i}]" for i in range(len(files))) + ";" + "".join(f"[v{i}]" for i in range(len(files))) + f"hstack={len(files)}"
subprocess.run(args + ["-filter_complex", fc, str(out / "keyframes.jpg")], check=True)
