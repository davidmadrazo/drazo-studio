// Dónde guarda Drazo Studio sus herramientas locales en el ordenador del miembro. Lo comparten el instalador
// (instalar.ps1 / instalar.sh, que repiten estas rutas), el doctor y la herramienta que ve los reels.
// CONTENT_OS_DATOS, CONTENT_OS_PYTHON y CONTENT_OS_PLAYWRIGHT solo existen para pruebas.

import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"

export const esWindows = process.platform === "win32"

function carpetaDatos() {
  if (process.env.CONTENT_OS_DATOS?.trim()) return process.env.CONTENT_OS_DATOS.trim()
  if (esWindows) return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "DrazoStudio")
  return path.join(os.homedir(), ".local", "share", "drazo-studio")
}

export const DATOS = carpetaDatos()
export const VENV = path.join(DATOS, "venv")
export const PYTHON = process.env.CONTENT_OS_PYTHON?.trim() || (esWindows ? path.join(VENV, "Scripts", "python.exe") : path.join(VENV, "bin", "python"))
/** Carpeta con node_modules/playwright-core, instalado solo para Drazo Studio. */
export const NODE_HERRAMIENTAS = path.join(DATOS, "node")
/** PLAYWRIGHT_BROWSERS_PATH: el chromium-headless-shell de Drazo Studio. */
export const NAVEGADORES = path.join(DATOS, "ms-playwright")
export const FFMPEG_DIR = path.join(DATOS, "ffmpeg")
export const REELS = path.join(DATOS, "reels")
/** Modelo de faster-whisper, en la caché de Hugging Face; lo descarga el instalador. */
export const MODELO_WHISPER = "large-v3-turbo"

/** ffmpeg y ffprobe: los de Drazo Studio si existen; si no, los del PATH. */
export function binario(nombre) {
  const propio = path.join(FFMPEG_DIR, esWindows ? `${nombre}.exe` : nombre)
  return existsSync(propio) ? propio : nombre
}
