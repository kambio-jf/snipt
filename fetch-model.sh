#!/usr/bin/env bash
# Download the Whisper model (not committed — ~465 MB). Run once after cloning.
#
# small.en is the default. base.en decodes non-speech into plausible words — a
# swallow or lip smack becomes "350, 450" — and those phantom words reach both the
# cut list and the karaoke. small.en leaves silence alone. It costs ~1.7x the
# transcription time, which is fine: transcribing runs in the background.
#
# Fetch a different one:  MODEL=ggml-base.en.bin bash fetch-model.sh
set -e
mkdir -p models
MODEL="${MODEL:-ggml-small.en.bin}"
URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL}"
if [ -f "models/${MODEL}" ]; then
  echo "models/${MODEL} already present."
else
  echo "Downloading ${MODEL}…"
  curl -L -o "models/${MODEL}" "${URL}"
  echo "Done -> models/${MODEL}"
fi
