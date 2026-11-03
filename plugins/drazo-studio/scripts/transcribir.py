#!/usr/bin/env python3
"""Transcribe un WAV de 16 kHz mono con faster-whisper, en local y sin API.

Uso: transcribir.py <wav> [--modelo large-v3-turbo] [--idioma es|auto]

Imprime en stdout un JSON {texto, idioma, segmentos: [{inicio, fin, texto}]}.
Los errores van por stderr y el código de salida es distinto de 0.

No usa decode_audio de faster-whisper: con faster-whisper 1.2.1 y av 19 falla con
metadata_errors. Se lee el WAV con el módulo wave y numpy y se pasa el array.
"""

import argparse
import json
import sys
import wave

TASA = 16000


def leer_wav(ruta):
    import numpy as np

    with wave.open(ruta, "rb") as wav:
        canales = wav.getnchannels()
        ancho = wav.getsampwidth()
        tasa = wav.getframerate()
        crudo = wav.readframes(wav.getnframes())
    if ancho != 2:
        raise ValueError(f"el WAV debe ser de 16 bits (tiene {ancho * 8})")
    if tasa != TASA:
        raise ValueError(f"el WAV debe ser de {TASA} Hz (tiene {tasa})")
    audio = np.frombuffer(crudo, dtype="<i2").astype(np.float32) / 32768.0
    if canales > 1:
        audio = audio.reshape(-1, canales).mean(axis=1)
    return audio


def main():
    analizador = argparse.ArgumentParser(description="Transcribe un WAV con faster-whisper (local)")
    analizador.add_argument("wav")
    analizador.add_argument("--modelo", default="large-v3-turbo")
    analizador.add_argument("--idioma", default="auto", help="código de idioma (es, en...) o auto")
    args = analizador.parse_args()
    idioma = None if args.idioma.strip().lower() in ("", "auto") else args.idioma.strip().lower()

    try:
        audio = leer_wav(args.wav)
        if audio.size == 0:
            resultado = {"texto": "", "idioma": idioma, "segmentos": []}
        else:
            from faster_whisper import WhisperModel

            modelo = WhisperModel(args.modelo, device="cpu", compute_type="int8")
            segmentos, info = modelo.transcribe(
                audio,
                language=idioma,
                vad_filter=True,
                condition_on_previous_text=False,
            )
            lista = []
            for segmento in segmentos:
                texto = segmento.text.strip()
                if texto:
                    lista.append({
                        "inicio": round(float(segmento.start), 2),
                        "fin": round(float(segmento.end), 2),
                        "texto": texto,
                    })
            resultado = {
                "texto": " ".join(s["texto"] for s in lista),
                "idioma": info.language,
                "segmentos": lista,
            }
    except Exception as error:  # noqa: BLE001 - se informa por stderr y se sale con código 1
        print(f"transcribir.py: {type(error).__name__}: {error}", file=sys.stderr)
        return 1

    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(resultado, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
