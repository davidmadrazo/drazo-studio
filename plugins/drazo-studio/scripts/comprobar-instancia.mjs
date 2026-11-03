// Comprueba que tu Drazo Studio (tu app) responde y que su licencia del núcleo está activa. Hace
// GET <instancia_url>/api/instancia/estado con la cabecera x-instancia-token; la dirección y el token son los
// que el plugin tiene guardados en los ajustes de Claude Code (pluginConfigs de settings.json).
//
// Salida: líneas clave=valor. El token nunca se imprime.
//   instancia=ok|token|error|red|sin-config   instancia_detalle=...   (la línea «Tu Drazo Studio» del doctor)
//   licencia=ok|error|desconocida             licencia_detalle=...    (la línea «Licencia» del doctor)
//   licencia_codigo=...                       solo si el núcleo da un código de error (licencia_inactiva...)
// Códigos de salida: 0 todo bien · 1 la app responde pero hay un problema (token, licencia, modo...)
//                    · 2 la app no está disponible · 3 no hay dirección o token guardados.
import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { leerAjustes, normalizarUrl, opcionesGuardadas } from "./ajustes-claude.mjs"

const ESPERA_MS = 20_000
const una = (texto, max = 400) => String(texto ?? "").replace(/\s+/g, " ").trim().slice(0, max)

// Mira la respuesta ya recibida (estado HTTP y cuerpo en texto) y la resume. Sin red: se prueba con ejemplos.
export function resumirEstado(estadoHttp, texto, url) {
  let cuerpo = null
  try { cuerpo = texto ? JSON.parse(texto) : null } catch { /* no es JSON */ }
  const motivo = una(cuerpo?.mensaje || cuerpo?.error || "")
  if (estadoHttp === 401 || estadoHttp === 403) {
    return { codigo: 1, instancia: "token", instancia_detalle: `tu app rechaza el token guardado (${estadoHttp})${motivo ? `: ${motivo}` : ""}`, licencia: "desconocida", licencia_detalle: "no se puede saber sin un token válido" }
  }
  if (estadoHttp === 404) {
    const noProducto = cuerpo?.error === "no_es_producto"
    return { codigo: 1, instancia: "error", licencia: "desconocida", licencia_detalle: "no se puede saber",
      instancia_detalle: noProducto
        ? "tu app responde, pero no está en modo producto"
        : `${url} no tiene /api/instancia/estado (404): no parece una app de Drazo Studio, o es una versión antigua` }
  }
  if (estadoHttp >= 500) {
    return { codigo: 2, instancia: "error", instancia_detalle: `tu app falla ahora mismo (${estadoHttp})${motivo ? `: ${motivo}` : ""}`, licencia: "desconocida", licencia_detalle: "no se puede saber" }
  }
  if (estadoHttp !== 200 || !cuerpo || typeof cuerpo !== "object") {
    return { codigo: 1, instancia: "error", instancia_detalle: `respuesta inesperada de tu app (${estadoHttp})`, licencia: "desconocida", licencia_detalle: "no se puede saber" }
  }
  if (cuerpo.modo !== "producto") {
    return { codigo: 1, instancia: "error", instancia_detalle: `tu app no está en modo producto (modo: ${una(cuerpo.modo) || "desconocido"})`, licencia: "desconocida", licencia_detalle: "no se puede saber" }
  }
  const paquete = cuerpo.version_paquete ? `, paquete ${una(cuerpo.version_paquete, 40)}` : ""
  const resultado = { instancia: "ok", instancia_detalle: `responde${paquete}` }
  if (cuerpo.nucleo_url === false) {
    return { ...resultado, codigo: 1, licencia: "error", licencia_detalle: "tu app no tiene configurada la dirección del núcleo de Drazo Studio" }
  }
  if (cuerpo.nucleo_licencia === false) {
    return { ...resultado, codigo: 1, licencia: "error", licencia_detalle: "tu app no tiene configurada la licencia del núcleo de Drazo Studio" }
  }
  const nucleo = cuerpo.nucleo
  if (nucleo && typeof nucleo === "object") {
    if (nucleo.ok === true) return { ...resultado, codigo: 0, licencia: "ok", licencia_detalle: "activa" }
    const mensaje = una(nucleo.mensaje || nucleo.error || "el núcleo no acepta la licencia")
    return { ...resultado, codigo: 1, licencia: "error", licencia_detalle: mensaje, ...(nucleo.error ? { licencia_codigo: una(nucleo.error, 80) } : {}) }
  }
  return { ...resultado, codigo: 0, licencia: "desconocida", licencia_detalle: "tu app aún no informa del estado de la licencia" }
}

// `peticion` solo se cambia en las pruebas.
export async function comprobarInstancia({ url, token, espera = ESPERA_MS, peticion = fetch }) {
  let res
  try {
    res = await peticion(`${url}/api/instancia/estado`, { headers: { "x-instancia-token": token, Accept: "application/json" }, signal: AbortSignal.timeout(espera) })
  } catch (err) {
    const causa = err?.cause?.code || (err?.name === "TimeoutError" ? "sin respuesta a tiempo" : err?.message)
    return { codigo: 2, instancia: "red", instancia_detalle: `no llega a ${url} (${una(causa, 80)})`, licencia: "desconocida", licencia_detalle: "no se puede saber" }
  }
  return resumirEstado(res.status, await res.text().catch(() => ""), url)
}

export function imprimir(r) {
  const orden = ["instancia", "instancia_detalle", "licencia", "licencia_detalle", "licencia_codigo"]
  return orden.filter((k) => r[k] !== undefined).map((k) => `${k}=${r[k]}`).join("\n")
}

async function principal() {
  let ajustes
  try {
    ajustes = opcionesGuardadas(leerAjustes())
  } catch (err) {
    return { codigo: 3, instancia: "sin-config", instancia_detalle: `no se pueden leer los ajustes de Claude: ${una(err.message)}`, licencia: "desconocida", licencia_detalle: "no se puede saber" }
  }
  if (!ajustes.instanciaUrl || !ajustes.token) {
    const falta = !ajustes.instanciaUrl && !ajustes.token ? "guardados ni la dirección de tu app ni el token" : !ajustes.instanciaUrl ? "guardada la dirección de tu app" : "guardado el token de tu app"
    return { codigo: 3, instancia: "sin-config", instancia_detalle: `no hay ${falta}`, licencia: "desconocida", licencia_detalle: "no se puede saber" }
  }
  let url
  try {
    url = normalizarUrl(ajustes.instanciaUrl)
  } catch (err) {
    return { codigo: 3, instancia: "sin-config", instancia_detalle: `la dirección guardada no vale: ${una(err.message)}`, licencia: "desconocida", licencia_detalle: "no se puede saber" }
  }
  return comprobarInstancia({ url, token: ajustes.token })
}

// Solo al ejecutarlo como script (se comparan rutas reales por los enlaces de /var/folders en Mac).
function esPrincipal() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  }
}

// Se termina con process.exitCode y no con process.exit: en Windows este rompe Node con un fetch a medio cerrar.
if (esPrincipal()) {
  const r = await principal()
  console.log(imprimir(r))
  process.exitCode = r.codigo
}
