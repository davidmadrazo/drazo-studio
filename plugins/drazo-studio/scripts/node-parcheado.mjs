// ¿Tiene el Node.js de este equipo el último parche de seguridad de su rama? Lo compara con la última versión
// marcada "security": true de su misma rama mayor en https://nodejs.org/dist/index.json.
//
//   node node-parcheado.mjs aviso     hook SessionStart del plugin: si va atrasado o su rama no tiene soporte,
//                                     escribe el aviso (JSON de hook); si está al día o no hay red, nada
//   node node-parcheado.mjs estado    líneas clave=valor para el doctor y el instalador:
//                                     estado=al-dia|atrasada|sin-soporte|sin-datos, actual=, parche=
//
// Nunca bloquea: aviso y estado salen siempre con 0. Sin red no dice nada. Lo consultado se guarda 24 h en la
// carpeta de datos de Drazo Studio (solo si ya existe) para no preguntar a nodejs.org en cada arranque.
import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// Las mismas que en comun.sh (RAMA_NODE, NODE_MINIMO) y comun.ps1 ($RamaNode, $NodeMinimo).
export const RAMA_NODE = 24
export const NODE_MINIMO = 22
export const URL_INDICE = "https://nodejs.org/dist/index.json"
export const VIGENCIA_MS = 24 * 60 * 60 * 1000
const ESPERA_MS = 5000
const URL_INSTALAR = "https://raw.githubusercontent.com/davidmadrazo/drazo-studio/main/INSTALAR.md"

// La misma carpeta de datos que usan el instalador, el doctor y rutas.mjs (CONTENT_OS_DATOS solo existe para pruebas).
export function carpetaDatos() {
  if (process.env.CONTENT_OS_DATOS?.trim()) return process.env.CONTENT_OS_DATOS.trim()
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "DrazoStudio")
  return join(homedir(), ".local", "share", "drazo-studio")
}

export const rutaCache = () => join(carpetaDatos(), "node-parches.json")

// "v24.21.0" o "24.21.0" -> [24, 21, 0]; null si no tiene esa forma.
export function partes(version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(version || "").trim())
  return m ? m.slice(1).map(Number) : null
}

export function compararVersiones(a, b) {
  const x = partes(a), y = partes(b)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

// De index.json a { "24": "24.22.1", "22": "22.23.4", ... }: la última versión con parche de seguridad de cada rama.
export function resumirIndice(indice) {
  if (!Array.isArray(indice)) return null
  const seguridad = {}
  for (const e of indice) {
    if (e?.security !== true || !partes(e.version)) continue
    const version = e.version.replace(/^v/, "")
    const rama = String(partes(version)[0])
    if (!seguridad[rama] || compararVersiones(version, seguridad[rama]) > 0) seguridad[rama] = version
  }
  return Object.keys(seguridad).length ? seguridad : null
}

// Sin resumen (sin red) no se sabe nada: «sin-datos», y el hook no dice nada.
export function estadoNode(seguridad, actual, minimo = NODE_MINIMO) {
  const v = partes(actual)
  const limpio = v ? v.join(".") : String(actual || "")
  if (!seguridad || !v) return { estado: "sin-datos", actual: limpio, parche: "" }
  if (v[0] < minimo) return { estado: "sin-soporte", actual: limpio, parche: seguridad[String(RAMA_NODE)] || "" }
  const parche = seguridad[String(v[0])]
  if (!parche) return { estado: "sin-datos", actual: limpio, parche: "" }
  return { estado: compararVersiones(limpio, parche) < 0 ? "atrasada" : "al-dia", actual: limpio, parche }
}

export function mensajeAviso({ estado, actual, parche }) {
  const arreglo = "dile a Claude «actualiza el Node.js de Drazo Studio» o vuelve a ejecutar el instalador de Drazo Studio"
  if (estado === "atrasada") {
    return `Drazo Studio: tu Node.js (v${actual}) no tiene el último parche de seguridad (v${parche}). Puedes seguir usando Drazo Studio; para ponerlo al día, ${arreglo}.`
  }
  if (estado === "sin-soporte") {
    return `Drazo Studio: tu Node.js (v${actual}) es de una rama que ya no recibe parches de seguridad. Para pasar a Node.js ${RAMA_NODE}, ${arreglo}.`
  }
  return ""
}

// Salida del hook SessionStart: systemMessage lo ve el usuario y additionalContext, Claude.
export function salidaHook(r) {
  const mensaje = mensajeAviso(r)
  if (!mensaje) return ""
  return JSON.stringify({
    systemMessage: mensaje,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `${mensaje} Es un aviso, no bloquea nada: cuéntaselo al usuario en una frase y en su idioma la primera vez que le respondas, y sigue con lo que pida. Si quiere actualizarlo, sigue la sección «Si Drazo Studio avisa de que Node.js no tiene los parches» de ${URL_INSTALAR}.`,
    },
  })
}

function leerCache(ruta, ahora) {
  try {
    const c = JSON.parse(readFileSync(ruta, "utf8"))
    const edad = ahora - Date.parse(c.consultado)
    // Una fecha en el futuro (reloj cambiado) cuenta como caducada
    if (edad >= 0 && edad < VIGENCIA_MS && c.seguridad && typeof c.seguridad === "object") return c.seguridad
  } catch { /* sin caché o rota: se consulta */ }
  return null
}

function guardarCache(ruta, seguridad, ahora) {
  // No crea la carpeta de datos: así «solo comprobar» no deja nada en un equipo sin Drazo Studio
  if (!existsSync(dirname(ruta))) return
  try {
    const temporal = `${ruta}.${process.pid}.tmp`
    writeFileSync(temporal, JSON.stringify({ consultado: new Date(ahora).toISOString(), seguridad }) + "\n", "utf8")
    renameSync(temporal, ruta)
  } catch { /* sin caché se vuelve a consultar la próxima vez */ }
}

// La caché si tiene menos de 24 h; si no, index.json. Sin red y sin caché vigente: null.
export async function seguridadPorRama({ url = URL_INDICE, ruta = rutaCache(), ahora = Date.now(), espera = ESPERA_MS } = {}) {
  const enCache = leerCache(ruta, ahora)
  if (enCache) return enCache
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(espera) })
    if (!res.ok) return null
    const seguridad = resumirIndice(await res.json())
    if (seguridad) guardarCache(ruta, seguridad, ahora)
    return seguridad
  } catch {
    return null
  }
}

// Devuelve lo que hay que escribir (vacío si no hay nada que decir); null si la orden no existe.
export async function principal(argv, { version = process.version, ...opciones } = {}) {
  const orden = argv[0]
  if (orden !== "aviso" && orden !== "estado") return null
  const r = estadoNode(await seguridadPorRama(opciones), version)
  if (orden === "aviso") return salidaHook(r)
  return `estado=${r.estado}\nactual=${r.actual}\nparche=${r.parche}`
}

// Solo al ejecutarlo como script. Se comparan las rutas reales: en Mac la carpeta temporal (/var/folders)
// es un enlace a /private/var/folders.
function esPrincipal() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  }
}

if (esPrincipal()) {
  principal(process.argv.slice(2)).then(
    (texto) => {
      if (texto === null) {
        console.error("Uso: node node-parcheado.mjs aviso | estado")
        process.exitCode = 2
      } else if (texto) {
        console.log(texto)
      }
    },
    () => {},
  )
}
