"""Comprueba que el entorno de Python de Drazo Studio importa todos sus paquetes.

Lee requisitos-python.txt (junto a este fichero) y escribe una línea por paquete:
  PYTHON <versión> <ejecutable>
  OK <paquete> <versión>
  MAL <paquete> <motivo>
"""
import importlib
import importlib.metadata as metadata
import sys
from pathlib import Path

# Paquetes cuyo módulo no se llama como el paquete.
MODULOS = {
    "faster-whisper": "faster_whisper",
    "yt-dlp": "yt_dlp",
}

print(f"PYTHON {'.'.join(map(str, sys.version_info[:3]))} {sys.executable}")
requisitos = Path(__file__).with_name("requisitos-python.txt").read_text(encoding="utf-8").splitlines()
for linea in requisitos:
    paquete = linea.split("#")[0].strip()
    if not paquete:
        continue
    modulo = MODULOS.get(paquete.lower(), paquete.replace("-", "_"))
    try:
        importlib.import_module(modulo)
        print(f"OK {paquete} {metadata.version(paquete)}")
    except Exception as error:  # cualquier fallo al importar cuenta como paquete roto
        motivo = f"{type(error).__name__}: {error}".replace("\n", " ")[:160]
        print(f"MAL {paquete} {motivo}")
