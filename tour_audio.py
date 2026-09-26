#!/usr/bin/env python3
"""Render the guided-tour narration (site/tour/narration.json) to MP3 with the local Kokoro
daemon (the Jarvis voice). Needs the daemon on 127.0.0.1:7701 and ffmpeg.

  python3 tour_audio.py            # renders missing clips
  python3 tour_audio.py --force    # re-renders everything
  python3 tour_audio.py --why      # renders the "Why I built this" reading (site/why/)
"""
import json
import os
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
TOUR = os.path.join(ROOT, "site", "tour")
VOICE, SPEED = "bm_daniel", 1.0

steps = json.load(open(os.path.join(TOUR, "narration.json")))
force = "--force" in sys.argv
for s in ([] if "--why" in sys.argv else steps):
    out = os.path.join(TOUR, f"{s['id']}.mp3")
    if os.path.exists(out) and not force:
        continue
    req = urllib.request.Request("http://127.0.0.1:7701/tts", method="POST",
                                 data=json.dumps({"text": s["text"], "voice": VOICE, "speed": SPEED}).encode(),
                                 headers={"Content-Type": "application/json"})
    wav = urllib.request.urlopen(req, timeout=300).read()
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "wav", "-i", "pipe:0",
                    "-af", "loudnorm=I=-18:TP=-2:LRA=9", "-ar", "44100", "-ac", "1", "-b:a", "96k", out],
                   input=wav, check=True)
    print("rendered", s["id"])


def render_why():
    """One MP3 for the essay: title + each paragraph with short pauses; writes paragraph start
    times back into why.json so the page can highlight the paragraph being read."""
    import tempfile
    WHY = os.path.join(ROOT, "site", "why")
    doc = json.load(open(os.path.join(WHY, "why.json")))
    parts = [doc["intro_speak"]] + [p.get("speak") or p["text"] for p in doc["paragraphs"]]
    tmp = tempfile.mkdtemp()
    files, starts, t = [], [], 0.0
    gap = 0.7
    for i, text in enumerate(parts):
        req = urllib.request.Request("http://127.0.0.1:7701/tts", method="POST",
                                     data=json.dumps({"text": text, "voice": VOICE, "speed": SPEED}).encode(),
                                     headers={"Content-Type": "application/json"})
        wav = os.path.join(tmp, f"{i:02d}.wav")
        open(wav, "wb").write(urllib.request.urlopen(req, timeout=300).read())
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav],
                                   capture_output=True, text=True).stdout)
        if i > 0:
            starts.append(round(t, 2))
        files.append(wav)
        t += dur + gap
    lst = os.path.join(tmp, "list.txt")
    sil = os.path.join(tmp, "sil.wav")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", str(gap), sil], check=True)
    with open(lst, "w") as fh:
        for f in files:
            fh.write(f"file '{f}'\nfile '{sil}'\n")
    out = os.path.join(WHY, "why-i-built-this.mp3")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst,
                    "-af", "loudnorm=I=-18:TP=-2:LRA=9", "-ar", "44100", "-ac", "1", "-b:a", "96k", out], check=True)
    for p, st in zip(doc["paragraphs"], starts):
        p["start"] = st
    json.dump(doc, open(os.path.join(WHY, "why.json"), "w"), ensure_ascii=False, indent=2)
    print("rendered why-i-built-this.mp3", round(t, 1), "s")


if "--why" in sys.argv:
    render_why()
