import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { crc32 } from "node:zlib"
import { carpetaLista, descargar } from "../plugins/drazo-studio/scripts/descargar-paquete.mjs"

const LICENCIA = "cos_prueba_0123456789"
const temporales = []
const carpeta = () => { const d = mkdtempSync(path.join(os.tmpdir(), "descarga-")); temporales.push(d); return d }
test.after(() => { for (const d of temporales) rmSync(d, { recursive: true, force: true }) })

/** Zip mínimo sin comprimir (stored), suficiente para que lo abra el tar del sistema. */
function zipAlmacenado(ficheros) {
  const locales = [], centrales = []
  let desplazamiento = 0
  for (const [nombre, contenido] of Object.entries(ficheros)) {
    const datos = Buffer.from(contenido), n = Buffer.from(nombre), crc = crc32(datos)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(datos.length, 18); local.writeUInt32LE(datos.length, 22); local.writeUInt16LE(n.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8)
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(datos.length, 20); central.writeUInt32LE(datos.length, 24); central.writeUInt16LE(n.length, 28)
    central.writeUInt32LE(desplazamiento, 42)
    locales.push(local, n, datos); centrales.push(central, n)
    desplazamiento += 30 + n.length + datos.length
  }
  const dir = Buffer.concat(centrales), fin = Buffer.alloc(22)
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(centrales.length / 2, 8); fin.writeUInt16LE(centrales.length / 2, 10)
  fin.writeUInt32LE(dir.length, 12); fin.writeUInt32LE(desplazamiento, 16)
  return Buffer.concat([...locales, dir, fin])
}

async function nucleoFalso({ estado = 200, cuerpo, zip }) {
  const vistas = []
  const servidor = createServer((req, res) => {
    vistas.push({ ruta: req.url, licencia: req.headers["x-maquina-licencia"] })
    if (req.url === "/api/maquina/paquete") {
      res.writeHead(estado, { "content-type": "application/json" })
      return res.end(JSON.stringify(cuerpo))
    }
    if (req.url === "/zip") { res.writeHead(200); return res.end(zip) }
    res.writeHead(404); res.end()
  })
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r))
  return { url: `http://127.0.0.1:${servidor.address().port}`, vistas, cerrar: () => servidor.close() }
}

const silencio = () => {}

test("carpeta: vacía o solo con lo de Claude vale; con otras cosas, no; con PAQUETE.json ya está", () => {
  const d = carpeta()
  assert.equal(carpetaLista(d).ok, true)
  mkdirSync(path.join(d, ".claude")); writeFileSync(path.join(d, "CLAUDE.md"), "")
  assert.equal(carpetaLista(d).ok, true)
  writeFileSync(path.join(d, "otra-cosa.txt"), "x")
  assert.equal(carpetaLista(d).ok, false)
  writeFileSync(path.join(d, "PAQUETE.json"), "{}")
  assert.equal(carpetaLista(d).yaInstalado, true)
})

test("descarga: con licencia activa baja el zip, comprueba la huella y lo descomprime", async (t) => {
  if (process.platform === "win32" && !existsSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"))) return t.skip("sin tar del sistema")
  const zip = zipAlmacenado({ "PAQUETE.json": '{"version":"2026.11.02-abc"}\n', "src/app.ts": "export const a = 1\n" })
  const cuerpo = { version: "2026.11.02-abc", sha256: createHash("sha256").update(zip).digest("hex"), bytes: zip.length, url: "" }
  const nucleo = await nucleoFalso({ cuerpo, zip })
  cuerpo.url = `${nucleo.url}/zip`
  try {
    const d = carpeta()
    const lineas = []
    assert.equal(await descargar({ licencia: LICENCIA, carpeta: d, nucleo: nucleo.url, salida: (l) => lineas.push(l) }), 0, lineas.join("\n"))
    assert.equal(readFileSync(path.join(d, "src", "app.ts"), "utf8"), "export const a = 1\n")
    assert.equal(nucleo.vistas[0].licencia, LICENCIA)
    assert.match(lineas.join("\n"), /Drazo Studio 2026\.11\.02-abc descargado/)
    assert.equal(await descargar({ licencia: LICENCIA, carpeta: d, nucleo: nucleo.url, salida: silencio }), 0)
    assert.equal(nucleo.vistas.filter((v) => v.ruta === "/api/maquina/paquete").length, 1, "si ya está instalado no vuelve a pedirlo")
  } finally { nucleo.cerrar() }
})

test("descarga: una huella que no coincide no instala nada y una licencia inactiva da el mensaje del núcleo", async () => {
  const zip = zipAlmacenado({ "PAQUETE.json": "{}" })
  const malo = await nucleoFalso({ cuerpo: { version: "x", sha256: "0".repeat(64), bytes: zip.length, url: "pendiente" }, zip })
  try {
    const d = carpeta()
    const lineas = []
    const codigo = await descargar({ licencia: LICENCIA, carpeta: d, nucleo: malo.url, salida: (l) => lineas.push(l), fetchImpl: (u, o) => fetch(u === "pendiente" ? `${malo.url}/zip` : u, o) })
    assert.equal(codigo, 1)
    assert.match(lineas.join("\n"), /huella SHA-256/)
    assert.equal(existsSync(path.join(d, "PAQUETE.json")), false)
  } finally { malo.cerrar() }
  const inactiva = await nucleoFalso({ estado: 403, cuerpo: { error: "licencia_inactiva", mensaje: "La licencia no está activa." } })
  try {
    const lineas = []
    assert.equal(await descargar({ licencia: LICENCIA, carpeta: carpeta(), nucleo: inactiva.url, salida: (l) => lineas.push(l) }), 1)
    assert.match(lineas.join("\n"), /La licencia no está activa/)
  } finally { inactiva.cerrar() }
  assert.equal(await descargar({ licencia: "no-es-licencia", carpeta: carpeta(), salida: silencio }), 2)
})
