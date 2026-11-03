// Pruebas del aviso de Node sin parchear (plugins/drazo-studio/scripts/node-parcheado.mjs), con un index.json real
// recortado de nodejs.org (fixtures/nodejs-dist). Sin red: lo «publicado» lo sirve un servidor local.
// Uso: node --test tests/node-parcheado.test.mjs
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, before, test } from "node:test"
import { fileURLToPath } from "node:url"
import {
  carpetaDatos, estadoNode, principal, resumirIndice, salidaHook, seguridadPorRama, VIGENCIA_MS,
} from "../plugins/drazo-studio/scripts/node-parcheado.mjs"

const textoIndice = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "nodejs-dist", "index.json"), "utf8")
const seguridad = resumirIndice(JSON.parse(textoIndice))
// Puerto 9 (discard) en local: nadie escucha, la conexión se rechaza al momento, como sin red.
const SIN_RED = "http://127.0.0.1:9/index.json"

let servidor, urlIndice, consultas = 0
const carpeta = mkdtempSync(join(tmpdir(), "drazo-studio-node-"))
const cache = join(carpeta, "node-parches.json")

before(async () => {
  servidor = createServer((req, res) => {
    consultas++
    res.writeHead(200, { "Content-Type": "application/json" }).end(textoIndice)
  })
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok))
  urlIndice = `http://127.0.0.1:${servidor.address().port}/index.json`
})
after(() => {
  servidor.close()
  rmSync(carpeta, { recursive: true, force: true })
})

test("resume la última versión con parche de seguridad de cada rama", () => {
  assert.deepEqual(seguridad, { 26: "26.12.1", 24: "24.22.1", 22: "22.23.4", 20: "20.20.2" })
})

test("rama 24 al día: sin aviso", async () => {
  assert.deepEqual(estadoNode(seguridad, "v24.22.1"), { estado: "al-dia", actual: "24.22.1", parche: "24.22.1" })
  assert.equal(salidaHook(estadoNode(seguridad, "v24.22.1")), "")
})

test("rama 24 atrasada: aviso con la versión que trae el parche", () => {
  assert.deepEqual(estadoNode(seguridad, "v24.21.0"), { estado: "atrasada", actual: "24.21.0", parche: "24.22.1" })
  // La 24.22.0 salió antes del parche del 20-oct: también va atrasada
  assert.equal(estadoNode(seguridad, "v24.22.0").estado, "atrasada")
  const hook = JSON.parse(salidaHook(estadoNode(seguridad, "v24.21.0")))
  assert.match(hook.systemMessage, /v24\.21\.0.*v24\.22\.1/)
  assert.match(hook.systemMessage, /actualiza el Node\.js de Drazo Studio/)
  assert.equal(hook.hookSpecificOutput.hookEventName, "SessionStart")
  assert.match(hook.hookSpecificOutput.additionalContext, /no bloquea nada/)
  assert.match(hook.hookSpecificOutput.additionalContext, /drazo-studio\/main\/INSTALAR\.md/)
})

test("rama 22 al día y una versión posterior al parche: sin aviso", () => {
  assert.equal(estadoNode(seguridad, "v22.23.4").estado, "al-dia")
  assert.equal(estadoNode(seguridad, "v24.23.0").estado, "al-dia")
})

test("rama 20: fuera de soporte, aviso para pasar a la 24", () => {
  assert.deepEqual(estadoNode(seguridad, "v20.20.2"), { estado: "sin-soporte", actual: "20.20.2", parche: "24.22.1" })
  assert.match(JSON.parse(salidaHook(estadoNode(seguridad, "v20.20.2"))).systemMessage, /ya no recibe parches.*Node\.js 24/)
})

test("sin red: no dice nada", async () => {
  const sinCache = join(carpeta, "otra", "node-parches.json")
  assert.equal(await seguridadPorRama({ url: SIN_RED, ruta: sinCache }), null)
  assert.equal(await principal(["aviso"], { version: "v24.21.0", url: SIN_RED, ruta: sinCache }), "")
  assert.equal(await principal(["aviso"], { version: "v20.20.2", url: SIN_RED, ruta: sinCache }), "")
  assert.equal(await principal(["estado"], { version: "v24.21.0", url: SIN_RED, ruta: sinCache }), "estado=sin-datos\nactual=24.21.0\nparche=")
})

test("caché de 24 h: consulta una vez y luego no pregunta ni sin red", async () => {
  const ahora = Date.parse("2026-10-23T10:00:00Z")
  consultas = 0
  assert.deepEqual(await seguridadPorRama({ url: urlIndice, ruta: cache, ahora }), seguridad)
  assert.equal(consultas, 1)
  assert.ok(existsSync(cache))
  assert.deepEqual(await seguridadPorRama({ url: SIN_RED, ruta: cache, ahora: ahora + VIGENCIA_MS - 1 }), seguridad)
  assert.match(await principal(["aviso"], { version: "v24.21.0", url: SIN_RED, ruta: cache, ahora: ahora + 3600_000 }), /v24\.22\.1/)
  // Caducada y sin red: nada
  assert.equal(await seguridadPorRama({ url: SIN_RED, ruta: cache, ahora: ahora + VIGENCIA_MS }), null)
  // Caducada con red: vuelve a consultar
  await seguridadPorRama({ url: urlIndice, ruta: cache, ahora: ahora + VIGENCIA_MS })
  assert.equal(consultas, 2)
})

test("no crea la carpeta de datos para la caché", async () => {
  const ruta = join(carpeta, "no-existe", "node-parches.json")
  assert.deepEqual(await seguridadPorRama({ url: urlIndice, ruta }), seguridad)
  assert.equal(existsSync(dirname(ruta)), false)
})

test("la carpeta de datos es la de rutas.mjs, también con CONTENT_OS_DATOS", () => {
  const previo = process.env.CONTENT_OS_DATOS
  try {
    process.env.CONTENT_OS_DATOS = join(carpeta, "otra-carpeta")
    assert.equal(carpetaDatos(), join(carpeta, "otra-carpeta"))
    delete process.env.CONTENT_OS_DATOS
    assert.match(carpetaDatos(), process.platform === "win32" ? /DrazoStudio$/ : /\.local[\\/]share[\\/]drazo-studio$/)
  } finally {
    if (previo === undefined) delete process.env.CONTENT_OS_DATOS
    else process.env.CONTENT_OS_DATOS = previo
  }
})

test("orden desconocida", async () => {
  assert.equal(await principal(["otra"]), null)
})
