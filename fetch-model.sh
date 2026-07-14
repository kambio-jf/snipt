#!/usr/bin/env bash
# Download the Whisper model (not committed — ~142 MB). Run once after cloning.
set -e
mkdir -p models
MODEL="ggml-base.en.bin"
URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL}"
if [ -f "models/${MODEL}" ]; then
  echo "models/${MODEL} already present."
else
  echo "Downloading ${MODEL} (~142 MB)…"
  curl -L -o "models/${MODEL}" "${URL}"
  echo "Done -> models/${MODEL}"
fi
