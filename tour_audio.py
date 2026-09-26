#!/usr/bin/env python3
"""Render the guided-tour narration (site/tour/narration.json) to MP3 with the local Kokoro
daemon (the Jarvis voice). Needs the daemon on 127.0.0.1:7701 and ffmpeg.

  python3 tour_audio.py            # renders missing clips
  python3 tour_audio.py --force    # re-renders everything
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
for s in steps:
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
