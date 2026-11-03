// Pruebas de los ajustes de Claude Code que escribe el instalador (plugins/drazo-studio/scripts/ajustes-claude.mjs).
// Todo en carpetas temporales (CLAUDE_CONFIG_DIR): nunca toca el settings.json de verdad ni lanza la orden claude
// (instalarPlugin recibe una orden falsa).
// Uso: node --test tests/ajustes-claude.test.mjs
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, test } from "node:test"
import { fileURLToPath } from "node:url"
import {
  guardar, ID_PLUGIN, instalarPlugin, leerAjustes, MARKETPLACE, normalizarUrl, opcionesGuardadas, REPO, registrar, tapar,
} from "../plugins/drazo-studio/scripts/ajustes-claude.mjs"

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "plugins", "drazo-studio", "scripts", "ajustes-claude.mjs")
const URL_APP = "https://mi-drazo-studio.vercel.app"
const TOKEN = "tok_1234567890abcdef"

let base, config, previo
const ajustes = () => join(config, "settings.json")
const leer = () => JSON.parse(readFileSync(ajustes(), "utf8"))
const escribir = (datos) => writeFileSync(ajustes(), typeof datos === "string" ? datos : JSON.stringify(datos, null, 2))
const copias = () => readdirSync(config).filter((f) => f.startsWith("settings.json.antes-de-drazo-studio-"))

function ejecutar(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_PLUGIN_CACHE_DIR: join(base, "plugins") },
    encoding: "utf8",
  })
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}`, stdout: r.stdout, stderr: r.stderr }
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "drazo-studio-ajustes-"))
  config = join(base, "claude")
  mkdirSync(config, { recursive: true })
  previo = { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, CLAUDE_CODE_PLUGIN_CACHE_DIR: process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR }
  process.env.CLAUDE_CONFIG_DIR = config
  process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = join(base, "plugins")
})

afterEach(() => {
  for (const [k, v] of Object.entries(previo)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmSync(base, { recursive: true, force: true })
})

test("las constantes son las del contrato", () => {
  assert.equal(ID_PLUGIN, "drazo-studio@drazo-studio")
  assert.equal(MARKETPLACE, "drazo-studio")
  assert.equal(REPO, "davidmadrazo/drazo-studio")
})

test("registrar fusiona en un settings.json vacío con el formato exacto", () => {
  const a = registrar({}, { instanciaUrl: URL_APP, token: TOKEN })
  assert.deepEqual(a, {
    extraKnownMarketplaces: { "drazo-studio": { source: { source: "github", repo: "davidmadrazo/drazo-studio" }, autoUpdate: true } },
    enabledPlugins: { "drazo-studio@drazo-studio": true },
    pluginConfigs: { "drazo-studio@drazo-studio": { options: { instancia_url: URL_APP, token_instancia: TOKEN } } },
    env: { CLAUDE_CODE_PLUGIN_PREFER_HTTPS: "1", MCP_TOOL_TIMEOUT: "900000" },
  })
})

test("registrar no toca lo demás y conserva una espera mayor", () => {
  const original = {
    theme: "dark",
    permissions: { allow: ["Bash(git status)"] },
    extraKnownMarketplaces: { otro: { source: { source: "github", repo: "alguien/otro" }, autoUpdate: false } },
    enabledPlugins: { "otro@otro": true, "drazo-studio@drazo-studio": false },
    pluginConfigs: { "otro@otro": { options: { clave: "x" } }, "drazo-studio@drazo-studio": { extra: 1, options: { otra_opcion: "y" } } },
    env: { MI_VARIABLE: "1", MCP_TOOL_TIMEOUT: "1200000" },
  }
  escribir(original)
  guardar(registrar(leerAjustes(), { instanciaUrl: URL_APP, token: TOKEN }))
  const a = leer()
  assert.equal(a.theme, "dark")
  assert.deepEqual(a.permissions, original.permissions)
  assert.deepEqual(a.extraKnownMarketplaces.otro, original.extraKnownMarketplaces.otro)
  assert.equal(a.enabledPlugins["otro@otro"], true)
  assert.equal(a.enabledPlugins["drazo-studio@drazo-studio"], true)
  assert.deepEqual(a.pluginConfigs["otro@otro"], { options: { clave: "x" } })
  assert.deepEqual(a.pluginConfigs["drazo-studio@drazo-studio"], { extra: 1, options: { otra_opcion: "y", instancia_url: URL_APP, token_instancia: TOKEN } })
  assert.equal(a.env.MI_VARIABLE, "1")
  assert.equal(a.env.MCP_TOOL_TIMEOUT, "1200000")
  assert.equal(a.env.CLAUDE_CODE_PLUGIN_PREFER_HTTPS, "1")
})

test("registrar sube una espera menor a 900000", () => {
  assert.equal(registrar({ env: { MCP_TOOL_TIMEOUT: "60000" } }, { instanciaUrl: URL_APP, token: TOKEN }).env.MCP_TOOL_TIMEOUT, "900000")
})

test("con una carpeta local registra el marketplace como directorio", () => {
  const a = registrar({}, { instanciaUrl: URL_APP, token: TOKEN, fuenteLocal: base })
  assert.deepEqual(a.extraKnownMarketplaces["drazo-studio"], { source: { source: "directory", path: base }, autoUpdate: true })
})

test("el script registra, deja copia de seguridad y no imprime el token", () => {
  escribir({ theme: "light" })
  const antes = readFileSync(ajustes(), "utf8")
  const r = ejecutar("registrar", "--instancia-url", `${URL_APP}/`, "--token", TOKEN)
  assert.equal(r.codigo, 0, r.salida)
  assert.ok(!r.salida.includes(TOKEN), "el token no debe salir por pantalla")
  assert.match(r.salida, /Copia de seguridad/)
  const hechas = copias()
  assert.equal(hechas.length, 1)
  assert.equal(readFileSync(join(config, hechas[0]), "utf8"), antes)
  const a = leer()
  assert.equal(a.theme, "light")
  assert.deepEqual(opcionesGuardadas(a), { instanciaUrl: URL_APP, token: TOKEN })
})

test("sin settings.json previo lo crea y no hay copia", () => {
  const r = ejecutar("registrar", "--instancia-url", URL_APP, "--token", TOKEN)
  assert.equal(r.codigo, 0, r.salida)
  assert.equal(copias().length, 0)
  assert.equal(leer().enabledPlugins["drazo-studio@drazo-studio"], true)
})

test("en una segunda pasada sin --token conserva el que hay", () => {
  assert.equal(ejecutar("registrar", "--instancia-url", URL_APP, "--token", TOKEN).codigo, 0)
  const nueva = "https://otra-app.vercel.app"
  const r = ejecutar("registrar", "--instancia-url", nueva)
  assert.equal(r.codigo, 0, r.salida)
  assert.deepEqual(opcionesGuardadas(leer()), { instanciaUrl: nueva, token: TOKEN })
  const sinNada = ejecutar("registrar")
  assert.equal(sinNada.codigo, 0, sinNada.salida)
  assert.deepEqual(opcionesGuardadas(leer()), { instanciaUrl: nueva, token: TOKEN })
  const otroToken = ejecutar("registrar", "--token", "otro_token_largo_9876")
  assert.equal(otroToken.codigo, 0, otroToken.salida)
  assert.deepEqual(opcionesGuardadas(leer()), { instanciaUrl: nueva, token: "otro_token_largo_9876" })
})

test("uso incorrecto: sin dirección, sin token, http o token corto salen con 2 y no escriben", () => {
  assert.equal(ejecutar("registrar", "--token", TOKEN).codigo, 2)
  assert.equal(ejecutar("registrar", "--instancia-url", URL_APP).codigo, 2)
  assert.equal(ejecutar("registrar", "--instancia-url", "http://mi-app.com", "--token", TOKEN).codigo, 2)
  assert.equal(ejecutar("registrar", "--instancia-url", "no es una url", "--token", TOKEN).codigo, 2)
  assert.equal(ejecutar("registrar", "--instancia-url", URL_APP, "--token", "corto").codigo, 2)
  assert.equal(ejecutar("otra-cosa").codigo, 2)
  assert.equal(existsSync(ajustes()), false)
})

test("http solo se admite en el propio equipo", () => {
  assert.equal(normalizarUrl("http://localhost:3000/"), "http://localhost:3000")
  assert.equal(normalizarUrl("http://127.0.0.1:8080/app/?x=1#y"), "http://127.0.0.1:8080/app")
  assert.equal(normalizarUrl("https://mi-drazo-studio.vercel.app///"), URL_APP)
  assert.throws(() => normalizarUrl("http://mi-app.com"), /https/)
  assert.throws(() => normalizarUrl("https://usuario:clave@mi-app.com"), /usuario/)
  assert.throws(() => normalizarUrl(""), /no es válida/)
})

test("un settings.json que no es JSON no se toca", () => {
  escribir("{ esto no es json")
  const r = ejecutar("registrar", "--instancia-url", URL_APP, "--token", TOKEN)
  assert.equal(r.codigo, 1)
  assert.match(r.salida, /no es JSON válido/)
  assert.equal(readFileSync(ajustes(), "utf8"), "{ esto no es json")
  assert.equal(copias().length, 0)
  assert.match(ejecutar("estado").stdout, /ajustes=json-invalido/)
})

test("lee un settings.json con BOM", () => {
  writeFileSync(ajustes(), `${String.fromCharCode(0xfeff)}{"theme":"dark"}`)
  assert.equal(leerAjustes().theme, "dark")
})

test("estado: sin nada, registrado sin descargar y descargado", () => {
  let e = Object.fromEntries(ejecutar("estado").stdout.trim().split(/\r?\n/).map((l) => l.split(/=(.*)/s).slice(0, 2)))
  assert.equal(e.ajustes, "no-existe")
  assert.equal(e.marketplace, "no")
  assert.equal(e.instancia, "no")
  assert.equal(e.token, "no")

  assert.equal(ejecutar("registrar", "--instancia-url", URL_APP, "--token", TOKEN).codigo, 0)
  const salida = ejecutar("estado").stdout
  assert.ok(!salida.includes(TOKEN), "el estado no debe llevar el token entero")
  e = Object.fromEntries(salida.trim().split(/\r?\n/).map((l) => l.split(/=(.*)/s).slice(0, 2)))
  assert.deepEqual(
    { marketplace: e.marketplace, fuente: e.fuente, activado: e.activado, instancia: e.instancia, instancia_url: e.instancia_url, token: e.token, token_formato: e.token_formato, https: e.https, espera_mcp: e.espera_mcp, descargado: e.descargado, version: e.version },
    { marketplace: "si", fuente: REPO, activado: "si", instancia: "si", instancia_url: URL_APP, token: "si", token_formato: "si", https: "si", espera_mcp: "si", descargado: "no", version: "" },
  )
  assert.equal(e.token_tapado, tapar(TOKEN))
  assert.ok(e.token_tapado.endsWith(TOKEN.slice(-4)))

  const instalado = join(base, "plugins", "cache", "drazo-studio")
  mkdirSync(instalado, { recursive: true })
  writeFileSync(join(base, "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "drazo-studio@drazo-studio": [{ scope: "user", installPath: instalado, version: "2.1.0" }] } }))
  e = Object.fromEntries(ejecutar("estado").stdout.trim().split(/\r?\n/).map((l) => l.split(/=(.*)/s).slice(0, 2)))
  assert.equal(e.descargado, "si")
  assert.equal(e.version, "2.1.0")
})

test("tapar no enseña un token corto", () => {
  assert.equal(tapar(""), "")
  assert.equal(tapar("12345678"), "…(guardado)")
  assert.equal(tapar("0123456789abcdef"), "…cdef")
})

test("carpeta: comprueba que existe y no escribe nada dentro", () => {
  const trabajo = join(base, "mi-carpeta")
  mkdirSync(trabajo)
  const ok = ejecutar("carpeta", "--ruta", trabajo)
  assert.equal(ok.codigo, 0, ok.salida)
  assert.deepEqual(readdirSync(trabajo), [])
  const mal = ejecutar("carpeta", "--ruta", join(base, "no-existe"))
  assert.equal(mal.codigo, 1)
  assert.equal(existsSync(join(base, "no-existe")), false)
})

// Una orden claude falsa: apunta lo que se le pide y contesta como la de verdad.
function falsa({ installJson = { outcome: "ok", message: "Instalado", installedVersion: "2.1.0", availableVersion: "2.1.0" }, alInstalar } = {}) {
  const llamadas = []
  const ejecutarFalso = (claude, args) => {
    llamadas.push({ claude, args })
    if (args[1] === "install") {
      alInstalar?.()
      const json = typeof installJson === "function" ? installJson(llamadas.filter((l) => l.args[1] === "install").length) : installJson
      return `aviso previo\n${JSON.stringify(json)}`
    }
    if (args[1] === "update") return "Plugin actualizado a 2.2.0"
    return "Marketplace listo"
  }
  return { llamadas, ejecutarFalso }
}

test("instalarPlugin añade el marketplace, instala con las dos opciones y repone lo que la orden reescribe", () => {
  escribir({ theme: "dark" })
  guardar(registrar(leerAjustes(), { instanciaUrl: URL_APP, token: TOKEN }))
  const { llamadas, ejecutarFalso } = falsa({
    alInstalar: () => {
      // «claude plugin install» reescribe la entrada del marketplace y se deja atrás autoUpdate
      const a = leerAjustes()
      a.extraKnownMarketplaces["drazo-studio"] = { source: { source: "github", repo: REPO } }
      delete a.env.CLAUDE_CODE_PLUGIN_PREFER_HTTPS
      guardar(a)
    },
  })
  const r = instalarPlugin({ claude: "claude-falso", ejecutar: ejecutarFalso })
  assert.equal(r.ok, true)
  assert.deepEqual(llamadas[0].args, ["plugin", "marketplace", "add", REPO])
  const instalar = llamadas.find((l) => l.args[1] === "install")
  assert.deepEqual(instalar.args, [
    "plugin", "install", "drazo-studio@drazo-studio", "--scope", "user", "--json", "-y",
    "--config", `instancia_url=${URL_APP}`, "--config", `token_instancia=${TOKEN}`,
  ])
  assert.ok(llamadas.some((l) => l.args.join(" ") === "plugin marketplace update drazo-studio"))
  assert.equal(llamadas.some((l) => l.args[1] === "update"), false)
  const a = leer()
  assert.equal(a.extraKnownMarketplaces["drazo-studio"].autoUpdate, true)
  assert.equal(a.env.CLAUDE_CODE_PLUGIN_PREFER_HTTPS, "1")
  assert.equal(a.theme, "dark")
  assert.deepEqual(opcionesGuardadas(a), { instanciaUrl: URL_APP, token: TOKEN })
})

test("instalarPlugin con una carpeta local añade esa carpeta, no el repo", () => {
  guardar(registrar({}, { instanciaUrl: URL_APP, token: TOKEN, fuenteLocal: base }))
  const { llamadas, ejecutarFalso } = falsa()
  instalarPlugin({ claude: "claude-falso", fuenteLocal: base, ejecutar: ejecutarFalso })
  assert.deepEqual(llamadas[0].args, ["plugin", "marketplace", "add", base])
  assert.equal(leer().extraKnownMarketplaces["drazo-studio"].source.source, "directory")
})

test("instalarPlugin actualiza si había una versión vieja", () => {
  guardar(registrar({}, { instanciaUrl: URL_APP, token: TOKEN }))
  const { llamadas, ejecutarFalso } = falsa({ installJson: { outcome: "ok", installedVersion: "2.0.0", availableVersion: "2.2.0" } })
  const r = instalarPlugin({ claude: "claude-falso", ejecutar: ejecutarFalso })
  assert.equal(r.ok, true)
  assert.deepEqual(llamadas.find((l) => l.args[1] === "update").args, ["plugin", "update", "drazo-studio@drazo-studio"])
  assert.match(r.detalle, /tenía la 2\.0\.0 y hay la 2\.2\.0/)
})

test("instalarPlugin reintenta una vez y da el fallo tal cual", () => {
  guardar(registrar({}, { instanciaUrl: URL_APP, token: TOKEN }))
  const { llamadas, ejecutarFalso } = falsa({ installJson: { outcome: "failed", message: "No se pudo clonar" } })
  const r = instalarPlugin({ claude: "claude-falso", ejecutar: ejecutarFalso })
  assert.equal(r.ok, false)
  assert.equal(r.detalle, "No se pudo clonar")
  assert.equal(llamadas.filter((l) => l.args[1] === "install").length, 2)
})

test("instalarPlugin sin dirección o sin token guardados no llega a lanzar nada", () => {
  const { llamadas, ejecutarFalso } = falsa()
  assert.throws(() => instalarPlugin({ claude: "claude-falso", ejecutar: ejecutarFalso }), /faltan la dirección o el token/)
  assert.equal(llamadas.length, 0)
})

test("el script instalar-plugin exige --claude", () => {
  assert.equal(ejecutar("instalar-plugin").codigo, 2)
})
