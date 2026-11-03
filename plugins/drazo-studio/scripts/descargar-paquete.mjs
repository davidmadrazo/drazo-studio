// Baja la app de Drazo Studio a la carpeta del miembro con su licencia: el núcleo solo la entrega a una licencia
// activa, con un enlace que caduca en minutos. Comprueba su huella SHA-256 y la descomprime. Lo lanza su Claude
// siguiendo INSTALAR.md, antes de que exista nada más.
//
//   node descargar-paquete.mjs --licencia cos_... [--carpeta .] [--nucleo https://...]
//
// Salida: «-> [paquete] ok|ya estaba|error: ...» y «RESUMEN: ...». Códigos: 0 bien, 1 fallo, 2 uso incorrecto.

import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

export const NUCLEO_POR_DEFECTO = "https://content-os-sand.vercel.app"

/** Lo único que puede haber ya en la carpeta: lo que deja la app de Claude al abrirla. */
const PERMITIDOS_ANTES = new Set([".claude", "CLAUDE.md", ".DS_Store", "Thumbs.db", "desktop.ini"])

function argumento(argv, nombre) {
  const i = argv.indexOf(`--${nombre}`)
  return i >= 0 ? argv[i + 1] : undefined
}

export function carpetaLista(carpeta) {
  if (!existsSync(carpeta)) return { ok: false, motivo: `La carpeta ${carpeta} no existe.` }
  if (existsSync(path.join(carpeta, "PAQUETE.json"))) return { ok: true, yaInstalado: true }
  const ajenos = readdirSync(carpeta).filter((nombre) => !PERMITIDOS_ANTES.has(nombre))
  if (ajenos.length) return { ok: false, motivo: `La carpeta no está vacía (${ajenos.slice(0, 5).join(", ")}${ajenos.length > 5 ? "…" : ""}): abre Claude en una carpeta nueva para Drazo Studio.` }
  return { ok: true, yaInstalado: false }
}

// El tar de Windows y de Mac abre zip; el de GNU (Linux) no.
export function descomprimir(fichero, destino) {
  if (process.platform === "linux") return spawnSync("unzip", ["-q", "-o", fichero, "-d", destino], { encoding: "utf8" })
  const tar = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar"
  return spawnSync(tar, ["-xf", fichero, "-C", destino], { encoding: "utf8" })
}

export async function descargar({ licencia, carpeta, nucleo = NUCLEO_POR_DEFECTO, salida = (l) => process.stdout.write(`${l}\n`), fetchImpl = fetch }) {
  const paso = (estado, detalle) => salida(`-> [paquete] ${estado}: ${detalle}`)
  if (!/^cos_[A-Za-z0-9_-]{8,}$/.test(licencia ?? "")) { paso("error", "falta --licencia cos_... o no tiene el formato de una licencia de Drazo Studio"); return 2 }
  const destino = path.resolve(carpeta ?? ".")
  const lista = carpetaLista(destino)
  if (!lista.ok) { paso("error", lista.motivo); return 1 }
  if (lista.yaInstalado) { paso("ya estaba", `Drazo Studio ya está en ${destino} (para ponerlo al día, sigue ACTUALIZAR.md)`); return 0 }

  let manifiesto
  try {
    const r = await fetchImpl(`${nucleo.replace(/\/+$/, "")}/api/maquina/paquete`, { headers: { "x-maquina-licencia": licencia }, signal: AbortSignal.timeout(60000) })
    const datos = await r.json().catch(() => ({}))
    if (!r.ok) { paso("error", datos.mensaje ?? `el núcleo respondió ${r.status}`); return 1 }
    manifiesto = datos
  } catch (error) {
    paso("error", `no llego al núcleo de Drazo Studio (${error?.cause?.code ?? error?.message ?? error}); revisa la conexión y repite`)
    return 1
  }
  if (!/^[0-9a-f]{64}$/.test(manifiesto.sha256 ?? "") || !manifiesto.url) { paso("error", "la respuesta del núcleo está incompleta; escribe a soporte"); return 1 }

  const trabajo = mkdtempSync(path.join(os.tmpdir(), "drazo-studio-paquete-"))
  try {
    const r = await fetchImpl(manifiesto.url, { signal: AbortSignal.timeout(300000) })
    if (!r.ok) { paso("error", `la descarga falló (${r.status}); repite el paso, el enlace dura unos minutos`); return 1 }
    const zip = Buffer.from(await r.arrayBuffer())
    const sha = createHash("sha256").update(zip).digest("hex")
    if (sha !== manifiesto.sha256) { paso("error", "la huella SHA-256 del paquete no coincide: no se instala; repite el paso"); return 1 }
    const fichero = path.join(trabajo, "paquete.zip")
    writeFileSync(fichero, zip)
    const extraido = descomprimir(fichero, destino)
    if (extraido.status !== 0) { paso("error", `no se pudo descomprimir: ${(extraido.stderr || extraido.error?.message || "").trim().slice(0, 300)}`); return 1 }
    if (!existsSync(path.join(destino, "PAQUETE.json"))) { paso("error", "el paquete descomprimido no trae PAQUETE.json; escribe a soporte"); return 1 }
    const version = JSON.parse(readFileSync(path.join(destino, "PAQUETE.json"), "utf8")).version ?? manifiesto.version
    paso("ok", `Drazo Studio ${version} descargado y comprobado en ${destino}`)
    salida(`RESUMEN: paquete ok (${version})`)
    return 0
  } finally {
    rmSync(trabajo, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  process.exitCode = await descargar({ licencia: argumento(argv, "licencia"), carpeta: argumento(argv, "carpeta"), nucleo: argumento(argv, "nucleo") ?? NUCLEO_POR_DEFECTO })
}
