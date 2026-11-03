// Ajustes de usuario de Claude Code (settings.json) para Drazo Studio: los lee y los fusiona sin tocar lo demás.
// Los usan el instalador, el doctor y la comprobación de la app; la app de escritorio lee el mismo fichero.
//
//   node ajustes-claude.mjs estado                                líneas clave=valor (el token sale tapado)
//   node ajustes-claude.mjs registrar --instancia-url <url> --token <token> [--fuente-local <carpeta del repo>]
//        sin --instancia-url o sin --token conserva lo que ya hay guardado
//   node ajustes-claude.mjs carpeta --ruta <carpeta de trabajo>   comprueba que existe; no escribe nada dentro
//   node ajustes-claude.mjs instalar-plugin --claude <ruta de la orden claude> [--fuente-local <carpeta del repo>]
//        descarga e instala el plugin con la orden claude (la app no lo baja sola al reabrirse)
//
// Antes de escribir siempre deja copia (settings.json.antes-de-drazo-studio-<fecha>). Si el fichero no es JSON
// válido, no lo toca. Códigos: 0 bien · 1 no se pudo · 2 uso incorrecto.
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const ID_PLUGIN = "drazo-studio@drazo-studio"
export const MARKETPLACE = "drazo-studio"
export const REPO = "davidmadrazo/drazo-studio"
export const ESPERA_MCP_MS = 900_000

export const carpetaConfig = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")
export const rutaAjustes = () => join(carpetaConfig(), "settings.json")
const carpetaPlugins = () => process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR || join(carpetaConfig(), "plugins")
const esObjeto = (v) => v !== null && typeof v === "object" && !Array.isArray(v)

// Lanza un error con mensaje claro si el fichero existe pero no es JSON.
export function leerAjustes() {
  const ruta = rutaAjustes()
  if (!existsSync(ruta)) return {}
  const crudo = readFileSync(ruta, "utf8")
  const texto = crudo.charCodeAt(0) === 0xfeff ? crudo.slice(1) : crudo
  if (!texto.trim()) return {}
  try {
    const datos = JSON.parse(texto)
    if (!esObjeto(datos)) throw new Error("no es un objeto JSON")
    return datos
  } catch (err) {
    throw new Error(`${ruta} no es JSON válido (${err.message}); no se toca`)
  }
}

// Lo que el plugin recibe como user_config (instancia_url y token_instancia), tal como lo guarda Claude Code.
export function opcionesGuardadas(a) {
  const o = a?.pluginConfigs?.[ID_PLUGIN]?.options
  const texto = (v) => (typeof v === "string" ? v.trim() : "")
  return { instanciaUrl: texto(o?.instancia_url), token: texto(o?.token_instancia) }
}

export const tokenValido = (t) => /^\S{8,}$/.test(String(t || ""))

export const tapar = (token) => (!token ? "" : token.length >= 12 ? `…${token.slice(-4)}` : "…(guardado)")

// https siempre; http solo en el propio equipo (pruebas). Devuelve la dirección sin barra final ni parámetros.
export function normalizarUrl(texto) {
  let u
  try {
    u = new URL(String(texto || "").trim())
  } catch {
    throw new Error("la dirección de tu Drazo Studio no es válida: tiene que ser algo como https://mi-drazo-studio.vercel.app")
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) {
    throw new Error("la dirección de tu Drazo Studio tiene que empezar por https://")
  }
  if (u.username || u.password) throw new Error("la dirección de tu Drazo Studio no debe llevar usuario ni contraseña")
  return u.origin + u.pathname.replace(/\/+$/, "")
}

function seccion(a, nombre) {
  if (!esObjeto(a[nombre])) a[nombre] = {}
  return a[nombre]
}

export function registrar(a, { instanciaUrl, token, fuenteLocal }) {
  const fuente = fuenteLocal ? { source: "directory", path: resolve(fuenteLocal) } : { source: "github", repo: REPO }
  seccion(a, "extraKnownMarketplaces")[MARKETPLACE] = { source: fuente, autoUpdate: true }
  seccion(a, "enabledPlugins")[ID_PLUGIN] = true
  if (instanciaUrl || token) {
    const configs = seccion(a, "pluginConfigs")
    const actual = esObjeto(configs[ID_PLUGIN]) ? configs[ID_PLUGIN] : {}
    const opciones = esObjeto(actual.options) ? actual.options : {}
    configs[ID_PLUGIN] = {
      ...actual,
      options: {
        ...opciones,
        ...(instanciaUrl ? { instancia_url: instanciaUrl } : {}),
        ...(token ? { token_instancia: token } : {}),
      },
    }
  }
  const env = seccion(a, "env")
  env.CLAUDE_CODE_PLUGIN_PREFER_HTTPS = "1"
  // Una herramienta de Drazo Studio puede tardar varios minutos (transcribir, descargar reels): que Claude Code la espere entera
  if (!(Number(env.MCP_TOOL_TIMEOUT) >= ESPERA_MCP_MS)) env.MCP_TOOL_TIMEOUT = String(ESPERA_MCP_MS)
  return a
}

// La carpeta de trabajo del miembro la llena su app (con su propio CLAUDE.md): aquí solo se comprueba que existe.
export function prepararCarpeta(ruta) {
  const carpeta = resolve(ruta)
  if (!existsSync(carpeta) || !statSync(carpeta).isDirectory()) throw new Error(`no existe la carpeta ${carpeta}`)
  return carpeta
}

export function ejecutarClaude(claude, args) {
  // En Windows la orden puede ser un .cmd de npm (necesita shell) o un .ps1 con su .cmd al lado
  const orden = /\.ps1$/i.test(claude) && existsSync(claude.replace(/\.ps1$/i, ".cmd")) ? claude.replace(/\.ps1$/i, ".cmd") : claude
  const conShell = /\.(cmd|bat)$/i.test(orden)
  const comillas = (s) => (/[\s"&|<>^()]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const opciones = { env: { ...process.env, CLAUDE_CODE_PLUGIN_PREFER_HTTPS: "1" }, encoding: "utf8", input: "", timeout: 300_000 }
  const r = conShell
    ? spawnSync([orden, ...args].map(comillas).join(" "), { ...opciones, shell: true })
    : spawnSync(orden, args, opciones)
  return `${r.stdout || ""}${r.stderr || ""}${r.error ? r.error.message : ""}`.trim()
}

function resultadoJson(salida) {
  const linea = salida.split(/\r?\n/).reverse().find((l) => l.trim().startsWith("{"))
  try {
    return linea ? JSON.parse(linea) : null
  } catch {
    return null
  }
}

// `ejecutar` solo se cambia en las pruebas, para no lanzar la orden claude de verdad.
export function instalarPlugin({ claude, fuenteLocal, ejecutar = ejecutarClaude }) {
  const { instanciaUrl, token } = opcionesGuardadas(leerAjustes())
  if (!instanciaUrl || !token) throw new Error("faltan la dirección o el token de tu Drazo Studio: pasa antes el paso «registrar» con ellos")
  const mercado = ejecutar(claude, ["plugin", "marketplace", "add", fuenteLocal ? resolve(fuenteLocal) : REPO])
  const instalar = () => resultadoJson(ejecutar(claude, ["plugin", "install", ID_PLUGIN, "--scope", "user", "--json", "-y",
    "--config", `instancia_url=${instanciaUrl}`, "--config", `token_instancia=${token}`]))
  // El catálogo al día antes de instalar: si no, «install» no ve la versión nueva
  ejecutar(claude, ["plugin", "marketplace", "update", MARKETPLACE])
  let r = instalar()
  if (r?.outcome !== "ok") {
    ejecutar(claude, ["plugin", "marketplace", "update", MARKETPLACE])
    r = instalar()
  }
  let detalle = r?.message || mercado.split(/\r?\n/).pop() || "sin respuesta de la orden claude"
  // Ya instalado en una versión vieja: «install» no lo toca, se actualiza aparte (se aplica al reabrir la app)
  if (r?.outcome === "ok" && r.installedVersion && r.availableVersion && r.installedVersion !== r.availableVersion) {
    const salida = ejecutar(claude, ["plugin", "update", ID_PLUGIN])
    detalle = `tenía la ${r.installedVersion} y hay la ${r.availableVersion}: ${salida.split(/\r?\n/).pop()}`
  }
  // La orden claude reescribe la entrada del marketplace: se vuelven a poner autoUpdate, env y opciones
  guardar(registrar(leerAjustes(), { instanciaUrl, token, fuenteLocal }))
  return { ok: r?.outcome === "ok", detalle }
}

export function guardar(a) {
  const ruta = rutaAjustes()
  mkdirSync(dirname(ruta), { recursive: true })
  let copia = ""
  if (existsSync(ruta)) {
    copia = `${ruta}.antes-de-drazo-studio-${new Date().toISOString().replace(/[:.]/g, "-")}`
    copyFileSync(ruta, copia)
  }
  writeFileSync(ruta, JSON.stringify(a, null, 2) + "\n", "utf8")
  return copia
}

function instalado() {
  try {
    const datos = JSON.parse(readFileSync(join(carpetaPlugins(), "installed_plugins.json"), "utf8"))
    return (datos?.plugins?.[ID_PLUGIN] || []).find((r) => r?.installPath && existsSync(r.installPath)) || null
  } catch {
    return null
  }
}

export function estado() {
  const salida = { ajustes: "ok", ruta: rutaAjustes() }
  let a = {}
  try {
    a = leerAjustes()
    if (!existsSync(rutaAjustes())) salida.ajustes = "no-existe"
  } catch (err) {
    return { ...salida, ajustes: "json-invalido", detalle: err.message }
  }
  const mercado = a.extraKnownMarketplaces?.[MARKETPLACE]?.source
  const { instanciaUrl, token } = opcionesGuardadas(a)
  const registro = instalado()
  return {
    ...salida,
    marketplace: mercado ? "si" : "no",
    fuente: mercado ? (mercado.repo || mercado.path || mercado.url || "?") : "",
    activado: a.enabledPlugins?.[ID_PLUGIN] === true ? "si" : "no",
    instancia: instanciaUrl ? "si" : "no",
    instancia_url: instanciaUrl,
    token: token ? "si" : "no",
    token_tapado: tapar(token),
    token_formato: tokenValido(token) ? "si" : "no",
    https: a.env?.CLAUDE_CODE_PLUGIN_PREFER_HTTPS === "1" ? "si" : "no",
    espera_mcp: Number(a.env?.MCP_TOOL_TIMEOUT) >= ESPERA_MCP_MS ? "si" : "no",
    descargado: registro || mercado?.source === "directory" ? "si" : "no",
    version: registro?.version || "",
  }
}

function principal(argv) {
  const [orden, ...resto] = argv
  const valor = (nombre) => {
    const i = resto.indexOf(nombre)
    return i >= 0 ? resto[i + 1] : undefined
  }
  if (orden === "estado") {
    for (const [k, v] of Object.entries(estado())) console.log(`${k}=${v}`)
    return 0
  }
  if (orden === "instalar-plugin") {
    const claude = valor("--claude")
    if (!claude) {
      console.error("Falta --claude <ruta de la orden claude>.")
      return 2
    }
    try {
      const r = instalarPlugin({ claude, fuenteLocal: valor("--fuente-local") })
      console.log(r.ok ? `Drazo Studio descargado e instalado en Claude: ${r.detalle}` : `No se pudo instalar el plugin: ${r.detalle}`)
      return r.ok ? 0 : 1
    } catch (err) {
      console.error(`No se pudo instalar el plugin: ${err.message}`)
      return 1
    }
  }
  if (orden === "carpeta") {
    try {
      const carpeta = prepararCarpeta(valor("--ruta") || process.cwd())
      console.log(`Carpeta de trabajo lista: ${carpeta}`)
      return 0
    } catch (err) {
      console.error(`No se pudo preparar la carpeta: ${err.message}`)
      return 1
    }
  }
  if (orden !== "registrar") {
    console.error("Uso: node ajustes-claude.mjs estado | registrar --instancia-url <url> --token <token> [--fuente-local <carpeta>] | carpeta --ruta <carpeta> | instalar-plugin --claude <ruta>")
    return 2
  }
  try {
    const a = leerAjustes()
    const guardadas = opcionesGuardadas(a)
    let instanciaUrl
    try {
      instanciaUrl = (valor("--instancia-url") || "").trim() ? normalizarUrl(valor("--instancia-url")) : guardadas.instanciaUrl
    } catch (err) {
      console.error(`Falta una dirección válida: ${err.message}.`)
      return 2
    }
    const token = (valor("--token") || "").trim() || guardadas.token
    if (!instanciaUrl) {
      console.error("Falta la dirección de tu Drazo Studio (--instancia-url).")
      return 2
    }
    if (!tokenValido(token)) {
      console.error("Falta un token de conexión válido de tu Drazo Studio (--token).")
      return 2
    }
    registrar(a, { instanciaUrl, token, fuenteLocal: valor("--fuente-local") })
    const copia = guardar(a)
    console.log(`Ajustes guardados en ${rutaAjustes()}`)
    if (copia) console.log(`Copia de seguridad: ${copia}`)
    console.log(`Drazo Studio registrado: marketplace ${MARKETPLACE}, plugin ${ID_PLUGIN}, app ${instanciaUrl}, token ${tapar(token)}.`)
    return 0
  } catch (err) {
    console.error(`No se pudieron guardar los ajustes: ${err.message}`)
    return 1
  }
}

// Solo al ejecutarlo como script. Se comparan las rutas reales: en Mac la carpeta temporal (/var/folders)
// es un enlace a /private/var/folders y, comparando las rutas tal cual, el script salía sin hacer nada.
function esPrincipal() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  }
}

if (esPrincipal()) {
  process.exitCode = principal(process.argv.slice(2))
}
