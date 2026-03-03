#!/usr/bin/env python3
"""Generate static English TTS audio assets using Microsoft Edge neural voice."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

import edge_tts

VOICE = "en-US-AriaNeural"
ROOT = Path(__file__).resolve().parents[1]

DATASETS = {
    "sentences": ROOT / "src" / "data" / "korean-sentences.json",
    "words": ROOT / "src" / "data" / "korean-words.json",
    "kor111": ROOT / "src" / "data" / "korean-kor111-unitized.json",
}

OUT_ROOT = ROOT / "public" / "audio" / "english"


async def generate_audio(force: bool) -> None:
    created = 0
    skipped = 0

    for mode, dataset_path in DATASETS.items():
        items = json.loads(dataset_path.read_text(encoding="utf-8"))
        mode_dir = OUT_ROOT / mode
        mode_dir.mkdir(parents=True, exist_ok=True)

        for index, item in enumerate(items):
            text = str(item.get("english", "")).strip()
            if not text:
                continue

            if mode == "kor111":
                audio_file = str(item.get("audioFile", "")).strip()
                if not audio_file:
                    audio_file = f"{index}.mp3"
                output_path = mode_dir / audio_file
            else:
                output_path = mode_dir / f"{index}.mp3"

            if output_path.exists() and not force:
                skipped += 1
                continue

            communicate = edge_tts.Communicate(text=text, voice=VOICE)
            await communicate.save(str(output_path))
            created += 1
            print(f"[{mode}] {index}: {output_path.name}")

    print(f"Done. Created: {created}, skipped: {skipped}, voice: {VOICE}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate static English audio assets")
    parser.add_argument("--force", action="store_true", help="Regenerate files even if they already exist")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    asyncio.run(generate_audio(force=args.force))


if __name__ == "__main__":
    main()
