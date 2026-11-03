// Pruebas de la comprobación de tu app (plugins/drazo-studio/scripts/comprobar-instancia.mjs): una app falsa en local
// contesta como /api/instancia/estado y el script lee su dirección y token de un settings.json temporal.
// Uso: node --test tests/comprobar-instancia.test.mjs
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, before, test } from "node:test"
import { fileURLToPath } from "node:url"
import { resumirEstado } from "../plugins/drazo-studio/scripts/comprobar-instancia.mjs"

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "plugins", "drazo-studio", "scripts", "comprobar-instancia.mjs")
const TOKEN = "tok_1234567890abcdef"

let servidor, url, base, config
let respuesta = { estado: 200, cuerpo: {} }
let visto = null

before(async () => {
  base = mkdtempSync(join(tmpdir(), "drazo-studio-instancia-"))
  config = join(base, "claude")
  mkdirSync(config)
  servidor = createServer((req, res) => {
    visto = { metodo: req.method, ruta: req.url, token: req.headers["x-instancia-token"] }
    res.writeHead(respuesta.estado, { "Content-Type": "application/json" })
    res.end(typeof respuesta.cuerpo === "string" ? respuesta.cuerpo : JSON.stringify(respuesta.cuerpo))
  })
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok))
  url = `http://127.0.0.1:${servidor.address().port}`
})
after(() => {
  servidor.close()
  rmSync(base, { recursive: true, force: true })
})

const guardarOpciones = (opciones) =>
  writeFileSync(join(config, "settings.json"), JSON.stringify({ pluginConfigs: { "drazo-studio@drazo-studio": { options: opciones } } }))

// Asíncrono: el servidor falso vive en este mismo proceso y un spawnSync lo dejaría sin atender la petición.
function comprobar() {
  return new Promise((ok, error) => {
    const hijo = spawn(process.execPath, [SCRIPT], { env: { ...process.env, CLAUDE_CONFIG_DIR: config } })
    let stdout = "", stderr = ""
    hijo.stdout.setEncoding("utf8").on("data", (c) => (stdout += c))
    hijo.stderr.setEncoding("utf8").on("data", (c) => (stderr += c))
    hijo.on("error", error)
    hijo.on("close", (codigo) => {
      const claves = Object.fromEntries(stdout.trim().split(/\r?\n/).filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)))
      ok({ codigo, claves, salida: `${stdout}${stderr}` })
    })
  })
}

const OK = { modo: "producto", version_paquete: "1.4.0", nucleo_url: true, nucleo_licencia: true, nucleo: { ok: true } }

test("todo bien: pide /api/instancia/estado con el token y sale con 0", async () => {
  guardarOpciones({ instancia_url: `${url}/`, token_instancia: TOKEN })
  respuesta = { estado: 200, cuerpo: OK }
  const r = await comprobar()
  assert.equal(r.codigo, 0, r.salida)
  assert.deepEqual(visto, { metodo: "GET", ruta: "/api/instancia/estado", token: TOKEN })
  assert.equal(r.claves.instancia, "ok")
  assert.match(r.claves.instancia_detalle, /responde, paquete 1\.4\.0/)
  assert.equal(r.claves.licencia, "ok")
  assert.ok(!r.salida.includes(TOKEN), "el token no debe salir por pantalla")
})

test("licencia mal: el mensaje del núcleo sale tal cual", async () => {
  guardarOpciones({ instancia_url: url, token_instancia: TOKEN })
  const mensaje = "Tu licencia está inactiva desde el 1 de noviembre. Escribe a soporte."
  respuesta = { estado: 200, cuerpo: { ...OK, nucleo: { ok: false, error: "licencia_inactiva", mensaje } } }
  const r = await comprobar()
  assert.equal(r.codigo, 1)
  assert.equal(r.claves.instancia, "ok")
  assert.equal(r.claves.licencia, "error")
  assert.equal(r.claves.licencia_detalle, mensaje)
  assert.equal(r.claves.licencia_codigo, "licencia_inactiva")
})

test("401: el token no vale", async () => {
  guardarOpciones({ instancia_url: url, token_instancia: TOKEN })
  respuesta = { estado: 401, cuerpo: { error: "sin_acceso", mensaje: "Token de instancia no válido." } }
  const r = await comprobar()
  assert.equal(r.codigo, 1)
  assert.equal(r.claves.instancia, "token")
  assert.match(r.claves.instancia_detalle, /rechaza el token guardado \(401\)/)
  assert.equal(r.claves.licencia, "desconocida")
})

test("404: no es una app de Drazo Studio (o no está en modo producto)", async () => {
  guardarOpciones({ instancia_url: url, token_instancia: TOKEN })
  respuesta = { estado: 404, cuerpo: "<html>no existe</html>" }
  let r = await comprobar()
  assert.equal(r.codigo, 1)
  assert.equal(r.claves.instancia, "error")
  assert.match(r.claves.instancia_detalle, /404/)
  respuesta = { estado: 404, cuerpo: { error: "no_es_producto", mensaje: "Esta instancia no está en modo producto." } }
  r = await comprobar()
  assert.match(r.claves.instancia_detalle, /no está en modo producto/)
})

test("5xx: la app no está disponible, código 2", async () => {
  guardarOpciones({ instancia_url: url, token_instancia: TOKEN })
  respuesta = { estado: 503, cuerpo: { error: "datos_no_disponibles", mensaje: "Sin conexión de servicio." } }
  const r = await comprobar()
  assert.equal(r.codigo, 2)
  assert.equal(r.claves.instancia, "error")
  assert.match(r.claves.instancia_detalle, /503/)
})

test("red caída: no llega, código 2", async () => {
  // El puerto 9 (discard) en local: la conexión se rechaza al momento
  guardarOpciones({ instancia_url: "http://127.0.0.1:9", token_instancia: TOKEN })
  const r = await comprobar()
  assert.equal(r.codigo, 2)
  assert.equal(r.claves.instancia, "red")
  assert.match(r.claves.instancia_detalle, /no llega a http:\/\/127\.0\.0\.1:9/)
  assert.equal(r.claves.licencia, "desconocida")
})

test("sin dirección o sin token guardados: código 3", async () => {
  guardarOpciones({ token_instancia: TOKEN })
  let r = await comprobar()
  assert.equal(r.codigo, 3)
  assert.equal(r.claves.instancia, "sin-config")
  assert.match(r.claves.instancia_detalle, /no hay guardada la dirección/)
  guardarOpciones({ instancia_url: url })
  r = await comprobar()
  assert.match(r.claves.instancia_detalle, /no hay guardado el token/)
  guardarOpciones({})
  r = await comprobar()
  assert.match(r.claves.instancia_detalle, /ni la dirección de tu app ni el token/)
  writeFileSync(join(config, "settings.json"), "{ no es json")
  r = await comprobar()
  assert.equal(r.codigo, 3)
  assert.match(r.claves.instancia_detalle, /no se pueden leer los ajustes de Claude/)
})

test("una dirección guardada que no vale (http fuera del equipo): código 3", async () => {
  guardarOpciones({ instancia_url: "http://mi-app.com", token_instancia: TOKEN })
  const r = await comprobar()
  assert.equal(r.codigo, 3)
  assert.match(r.claves.instancia_detalle, /la dirección guardada no vale/)
})

test("casos de la respuesta, sin red", async () => {
  const u = "https://app.example"
  assert.equal(resumirEstado(200, "esto no es json", u).instancia, "error")
  assert.match(resumirEstado(200, JSON.stringify({ modo: "desarrollo" }), u).instancia_detalle, /no está en modo producto \(modo: desarrollo\)/)
  assert.equal(resumirEstado(200, JSON.stringify({ ...OK, nucleo_url: false }), u).licencia, "error")
  assert.match(resumirEstado(200, JSON.stringify({ ...OK, nucleo_licencia: false }), u).licencia_detalle, /licencia del núcleo/)
  // La versión actual de la API todavía no manda `nucleo`: la licencia queda sin saber, pero la app responde
  const antigua = resumirEstado(200, JSON.stringify({ modo: "producto", canon: "nucleo", nucleo_url: true, nucleo_licencia: true }), u)
  assert.deepEqual([antigua.codigo, antigua.instancia, antigua.licencia], [0, "ok", "desconocida"])
  // Un error del núcleo sin mensaje enseña su código
  assert.equal(resumirEstado(200, JSON.stringify({ ...OK, nucleo: { ok: false, error: "paquete_agotado" } }), u).licencia_detalle, "paquete_agotado")
  // El detalle va en una sola línea y no se alarga sin fin
  const largo = resumirEstado(200, JSON.stringify({ ...OK, nucleo: { ok: false, mensaje: `línea 1\nlínea 2 ${"x".repeat(900)}` } }), u)
  assert.ok(!largo.licencia_detalle.includes("\n"))
  assert.ok(largo.licencia_detalle.length <= 400)
})
