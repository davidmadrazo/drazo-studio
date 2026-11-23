// Conectar la cuenta de research desde el ordenador del miembro (23-nov-2026). Abre su Chrome (o Edge) en una ventana
// aparte, con un perfil vacío que se borra al acabar, y lo saca a Instagram por el proxy de Drazo con el pase de su
// enlace: Instagram ve un navegador de verdad y la sesión nace en la misma salida por la que irán las pasadas. Cuando
// la persona ha entrado, manda la sesión al servidor de scroll de Drazo y cierra la ventana. No lee nada de su Chrome
// de siempre ni de ningún otro sitio, y no guarda ni enseña la sesión, el pase ni la contraseña.

import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import tls from "node:tls"

// Lo único que abre la ventana: Instagram, los dominios de Facebook que usa al entrar y el captcha de Google
const DOMINIOS = ["instagram.com", "cdninstagram.com", "facebook.com", "fbcdn.net", "fbsbx.com", "facebook.net"]
const CAPTCHA = ["www.google.com", "www.gstatic.com", "www.recaptcha.net"]
const LOGIN = "https://www.instagram.com/accounts/login/"
const OBLIGATORIAS = ["sessionid", "ds_user_id"]
const OPCIONALES = ["csrftoken", "mid", "ig_did"]
const COOKIE = /^[\x21-\x3a\x3c-\x7e]{1,400}$/
const USUARIO = /^[A-Za-z0-9._]{1,30}$/
const ESPERA_NOMBRE_MS = 8000
const INTERVALO_MS = 1500

/** `host:443` de Instagram, Facebook o el captcha; cualquier otro destino, no. */
export function destinoPermitido(destino) {
  const m = /^([a-z0-9.-]{1,253}):443$/.exec(String(destino ?? "").toLowerCase())
  if (!m) return false
  return CAPTCHA.includes(m[1]) || DOMINIOS.some((d) => m[1] === d || m[1].endsWith(`.${d}`))
}

/** Chrome y, si no está, Edge (viene en todo Windows) o Brave. Devuelve la ruta o null. */
export function buscarNavegador({ plataforma = process.platform, entorno = process.env, existe = existsSync } = {}) {
  let candidatos = []
  if (plataforma === "win32") {
    const bases = [entorno.PROGRAMFILES, entorno["PROGRAMFILES(X86)"], entorno.LOCALAPPDATA, "C:\\Program Files", "C:\\Program Files (x86)"].filter(Boolean)
    const relativas = ["Google\\Chrome\\Application\\chrome.exe", "Microsoft\\Edge\\Application\\msedge.exe", "BraveSoftware\\Brave-Browser\\Application\\brave.exe"]
    candidatos = relativas.flatMap((r) => bases.map((b) => path.win32.join(b, r)))
  } else if (plataforma === "darwin") {
    const apps = ["Google Chrome.app/Contents/MacOS/Google Chrome", "Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "Brave Browser.app/Contents/MacOS/Brave Browser", "Chromium.app/Contents/MacOS/Chromium"]
    candidatos = apps.flatMap((a) => [path.posix.join("/Applications", a), path.posix.join(entorno.HOME ?? "", "Applications", a)])
  } else {
    const nombres = ["google-chrome", "google-chrome-stable", "microsoft-edge", "brave-browser", "chromium", "chromium-browser"]
    const carpetas = String(entorno.PATH ?? "").split(":").filter(Boolean)
    candidatos = nombres.flatMap((n) => carpetas.map((c) => path.posix.join(c, n)))
  }
  return candidatos.find((ruta) => existe(ruta)) ?? null
}

/** Las opciones con que se abre: un perfil aparte, solo por la pasarela local y sin que WebRTC enseñe la IP de casa. */
export function opcionesDelNavegador({ perfil, puerto }) {
  return [
    `--user-data-dir=${perfil}`,
    "--remote-debugging-pipe",
    `--proxy-server=http://127.0.0.1:${puerto}`,
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--disable-quic",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-features=Translate,MediaRouter,OptimizationHints",
    "--window-size=1100,900",
    "--new-window",
    "about:blank",
  ]
}

const RESPUESTA = (linea) => `HTTP/1.1 ${linea}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`

/**
 * Proxy local en 127.0.0.1 para ese Chrome (Chrome no admite usuario y clave en --proxy-server): cada CONNECT a un
 * destino permitido va por TLS al proxy de Drazo con el pase; lo demás se corta aquí. `estado` cuenta lo que pasa
 * (túneles abiertos, pase rechazado, salida caída) para explicar un fallo sin enseñar nada de la sesión.
 */
export function crearPasarela({ proxy, token, conectarTls = tls.connect, tiempoMs = 25000, esperasReintentoMs = [1500, 3000, 5000] }) {
  const url = new URL(proxy)
  const host = url.hostname
  const puerto = Number(url.port || 443)
  const autorizacion = Buffer.from(`enlace:${token}`).toString("base64")
  const estado = { tuneles: 0, pase_rechazado: 0, salida_caida: 0, bloqueados: 0 }

  const servidor = http.createServer((_req, res) => {
    estado.bloqueados++
    res.writeHead(403, { connection: "close" })
    res.end()
  })
  servidor.on("connect", (req, cliente, cabeza) => {
    cliente.on("error", () => {})
    const destino = String(req.url ?? "").toLowerCase()
    if (!destinoPermitido(destino)) {
      estado.bloqueados++
      cliente.end(RESPUESTA("403 Forbidden"))
      return
    }
    let remoto = null
    let abierto = false
    let terminado = false
    let reintento = null
    const cerrar = () => {
      if (terminado) return
      terminado = true
      clearTimeout(plazo)
      clearTimeout(reintento)
      cliente.destroy()
      remoto?.destroy()
    }
    const plazo = setTimeout(() => {
      if (!abierto && !cliente.destroyed) cliente.write(RESPUESTA("504 Gateway Timeout"))
      cerrar()
    }, tiempoMs)
    cliente.on("close", cerrar)

    const intentar = (n) => {
      if (terminado) return
      const este = conectarTls({ host, port: puerto, servername: host, ALPNProtocols: ["http/1.1"] })
      remoto = este
      let recibido = Buffer.alloc(0)
      let resuelto = false
      // Un 503 (Drazo ocupado un momento) o la red caída antes de contestar se reintentan con espera; un 407, nunca
      const fallar = (motivo) => {
        if (resuelto || terminado) return
        resuelto = true
        este.destroy()
        if (motivo !== "407" && n < esperasReintentoMs.length) {
          reintento = setTimeout(() => intentar(n + 1), esperasReintentoMs[n])
          return
        }
        if (motivo === "407") estado.pase_rechazado++
        else estado.salida_caida++
        if (!cliente.destroyed) cliente.write(RESPUESTA("502 Bad Gateway"))
        cerrar()
      }
      const alLeer = (trozo) => {
        recibido = Buffer.concat([recibido, trozo])
        const fin = recibido.indexOf("\r\n\r\n")
        if (fin < 0) {
          if (recibido.length > 8192) fallar("rara")
          return
        }
        este.off("data", alLeer)
        const codigo = /^HTTP\/1\.[01] (\d{3})/.exec(recibido.subarray(0, Math.min(fin, 64)).toString("latin1"))?.[1]
        if (codigo !== "200") return fallar(codigo ?? "rara")
        resuelto = true
        abierto = true
        clearTimeout(plazo)
        estado.tuneles++
        const sobra = recibido.subarray(fin + 4)
        cliente.write("HTTP/1.1 200 Connection Established\r\n\r\n")
        if (sobra.length) cliente.write(sobra)
        if (cabeza?.length) este.write(cabeza)
        este.pipe(cliente)
        cliente.pipe(este)
      }
      este.once("secureConnect", () => este.write(`CONNECT ${destino} HTTP/1.1\r\nHost: ${destino}\r\nProxy-Authorization: Basic ${autorizacion}\r\n\r\n`))
      este.on("data", alLeer)
      este.on("error", () => (abierto ? cerrar() : fallar("red")))
      este.on("close", () => (abierto ? cerrar() : fallar("red")))
    }
    intentar(0)
  })
  servidor.on("clientError", (_e, socket) => socket.destroy())
  return { servidor, estado }
}

/** Cliente del protocolo de depuración por la tubería de Chrome (mensajes JSON separados por un byte 0). */
export function crearCdpTuberia(escribir, leer, { tiempoMs = 15000 } = {}) {
  let siguiente = 0
  const esperando = new Map()
  let pendiente = Buffer.alloc(0)
  // Con Chrome ya cerrado, escribir en la tubería da error: sin esto tumbaría el servidor del plugin
  escribir.on?.("error", () => {})
  leer.on("data", (trozo) => {
    pendiente = Buffer.concat([pendiente, trozo])
    let corte
    while ((corte = pendiente.indexOf(0)) >= 0) {
      const texto = pendiente.subarray(0, corte).toString("utf8")
      pendiente = pendiente.subarray(corte + 1)
      let mensaje
      try { mensaje = JSON.parse(texto) } catch { continue }
      const espera = mensaje.id !== undefined ? esperando.get(mensaje.id) : null
      if (!espera) continue
      esperando.delete(mensaje.id)
      clearTimeout(espera.plazo)
      if (mensaje.error) espera.rechazar(new Error("cdp_error"))
      else espera.resolver(mensaje.result ?? {})
    }
  })
  const cerrarTodo = () => {
    for (const espera of esperando.values()) { clearTimeout(espera.plazo); espera.rechazar(new Error("cdp_cerrado")) }
    esperando.clear()
  }
  leer.on("close", cerrarTodo)
  leer.on("error", cerrarTodo)
  return {
    enviar(method, params = {}, sessionId) {
      return new Promise((resolver, rechazar) => {
        const id = ++siguiente
        const plazo = setTimeout(() => { esperando.delete(id); rechazar(new Error("cdp_tiempo")) }, tiempoMs)
        esperando.set(id, { resolver, rechazar, plazo })
        try {
          escribir.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0")
        } catch {
          esperando.delete(id)
          clearTimeout(plazo)
          rechazar(new Error("cdp_cerrado"))
        }
      })
    },
  }
}

const esInstagram = (url) => {
  try {
    const host = new URL(url).hostname
    return host === "instagram.com" || host.endsWith(".instagram.com")
  } catch {
    return false
  }
}

/** En qué paso está la persona, en una lista cerrada: lo mismo que apunta la ventana del servidor. */
export function paginaDeLaVentana(urls) {
  const ig = urls.filter(esInstagram)
  if (ig.length === 0) return urls.some((u) => String(u).startsWith("chrome-error:")) ? "sin_internet" : "fuera_de_instagram"
  let ruta = ""
  try { ruta = new URL(ig[0]).pathname.toLowerCase() } catch { return "otra" }
  if (ruta.includes("two_factor")) return "dos_pasos"
  if (ruta.startsWith("/accounts/login")) return "entrar"
  if (ruta.includes("/challenge") || ruta.includes("/checkpoint")) return "comprobacion"
  if (ruta.startsWith("/auth_platform")) return ruta.includes("passkey") ? "passkey" : "codigo"
  if (ruta.startsWith("/accounts/onetap")) return "guardar_datos"
  if (ruta === "/" || ruta === "") return "portada"
  return "otra"
}

const PASOS_SIN_ENTRAR = new Set(["entrar", "dos_pasos", "comprobacion", "passkey", "codigo", "sin_internet", "fuera_de_instagram"])

/**
 * Se ejecuta dentro de la página de Instagram (con la sesión recién abierta) y devuelve {nombre, pistas}. Es la misma
 * lectura que hace la ventana del servidor: varias vías, de la más fiable a la de reserva.
 */
export async function leerNombreEnLaPagina(id) {
  const VALIDO = /^[A-Za-z0-9._]{1,30}$/
  const pistas = []
  const h = { credentials: "include", headers: { "x-ig-app-id": "936619743392459", "x-requested-with": "XMLHttpRequest" } }
  const api = async (clave, ruta, sacar) => {
    try {
      const r = await fetch(ruta, h)
      pistas.push(clave + r.status)
      if (!r.ok) return ""
      const u = sacar(await r.json())
      return typeof u === "string" && VALIDO.test(u) ? u : ""
    } catch {
      pistas.push(clave + "x")
      return ""
    }
  }
  const enTexto = (crudo) => {
    const texto = crudo.replace(/\\"/g, '"')
    const a = new RegExp(`"(?:id|pk|pk_id)":"?${id}"?[^{}]{0,800}?"username":"([A-Za-z0-9._]{1,30})"`).exec(texto)
    const b = new RegExp(`"username":"([A-Za-z0-9._]{1,30})"[^{}]{0,800}?"(?:id|pk|pk_id)":"?${id}"?[,}]`).exec(texto)
    return (a && a[1]) || (b && b[1]) || ""
  }
  let nombre = await api("f", "/api/v1/accounts/edit/web_form_data/", (j) => j?.form_data?.username)
  if (!nombre) nombre = await api("c", "/api/v1/accounts/current_user/?edit=true", (j) => j?.user?.username)
  if (!nombre) nombre = await api("i", `/api/v1/users/${id}/info/`, (j) => j?.user?.username)
  if (!nombre) {
    nombre = enTexto(Array.from(document.scripts, (s) => s.textContent || "").join("\n"))
    pistas.push(nombre ? "d1" : "d0")
  }
  return { nombre, pistas: pistas.join(",") }
}

const HUELLA = `(()=>{const d=navigator.userAgentData;return {ua:navigator.userAgent,marcas:d?d.brands.map(b=>'"'+b.brand+'";v="'+b.version+'"').join(', '):'',plataforma:d?d.platform:''}})()`

/** Las cookies de Instagram de ese Chrome (el perfil es nuevo: no hay otras). */
async function cookiesDeInstagram(cdp) {
  const { cookies = [] } = await cdp.enviar("Storage.getCookies")
  const mapa = new Map()
  for (const c of cookies) {
    const dominio = String(c.domain ?? "").replace(/^\./, "")
    if (dominio === "instagram.com" || dominio.endsWith(".instagram.com")) mapa.set(c.name, c.value)
  }
  if (!OBLIGATORIAS.every((n) => COOKIE.test(mapa.get(n) ?? "")) || !/^\d{1,20}$/.test(mapa.get("ds_user_id"))) return null
  const elegidas = {}
  for (const n of [...OBLIGATORIAS, ...OPCIONALES]) if (COOKIE.test(mapa.get(n) ?? "")) elegidas[n] = mapa.get(n)
  return elegidas
}

async function evaluar(cdp, sesion, expresion, awaitPromise = false) {
  const r = await cdp.enviar("Runtime.evaluate", { expression: expresion, awaitPromise, returnByValue: true }, sesion)
  return r?.result?.value
}

/** Manda la sesión al servidor de scroll de Drazo. Devuelve "ok", "caducado", "reintentar" o "rechazada". */
async function mandarSesion({ servidor, token, cuerpo, fetchFn }) {
  try {
    const r = await fetchFn(`${servidor}/c/${token}/sesion`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
      // El servidor reintenta con Studio hasta unos 30 s: cortar antes haría que el reintento viera el enlace ya gastado
      signal: AbortSignal.timeout(45000),
      redirect: "error",
    })
    if (r.status === 200) return "ok"
    if (r.status === 404) return "caducado"
    if (r.status === 503 || r.status === 429) return "reintentar"
    return "rechazada"
  } catch {
    return "reintentar"
  }
}

const INSTRUCCIONES = {
  conectada: "Ya está conectada. La primera pasada es en unas horas y los virales que encuentre salen en el Descubridor.",
  sin_navegador: "No encuentro Google Chrome ni Microsoft Edge en este ordenador. Instala Google Chrome (google.com/chrome) y vuelve a pedirme que conecte la cuenta de research.",
  cerrada: "Se cerró la ventana antes de terminar de entrar. Cuando quieras, vuelve a pedírmelo y entra hasta ver la portada de Instagram.",
  caducado: "El enlace caducó (dura 15 minutos). Vuelve a pedírmelo y entra sin esperar.",
  salida_caida: "La salida de Drazo no responde ahora mismo. Vuelve a intentarlo en unos minutos; si sigue igual, escríbenos.",
  entrar: "Se quedó en la pantalla de entrar. Si Instagram decía que los datos eran incorrectos con la contraseña buena, es un freno suyo: espera unos 15 minutos y vuelve a intentarlo. Si se repite, escríbenos.",
  dos_pasos: "Instagram pedía el código de verificación y no llegó a ponerse. Vuelve a intentarlo con el código a mano.",
  codigo: "Instagram pedía un código y no llegó a ponerse. Vuelve a intentarlo con el móvil o el correo de esa cuenta a mano.",
  passkey: "La cuenta tiene llave de acceso (passkey). Quítala desde el móvil (Ajustes, Centro de cuentas, Contraseña y seguridad) y vuelve a intentarlo.",
  comprobacion: "Instagram pide confirmar la cuenta. Hazlo desde el móvil y, cuando esté, vuelve a pedirme que la conecte.",
  sin_nombre: "Entraste bien, pero no pude leer el nombre de la cuenta. Vuelve a intentarlo; si se repite, escríbenos.",
  rechazada: "Drazo no aceptó la sesión. Vuelve a intentarlo; si se repite, escríbenos.",
  sin_internet: "La ventana no llegaba a Instagram por la salida de Drazo. Vuelve a intentarlo en unos minutos; si sigue igual, escríbenos.",
  fuera_de_instagram: "La ventana se salió de Instagram. Vuelve a pedírmelo y entra solo en la página de Instagram que se abre.",
  tiempo: "Se acabó el tiempo del enlace sin terminar de entrar. Vuelve a pedírmelo cuando tengas a mano la contraseña y el código de la cuenta.",
}

/** Lo que se le cuenta a la persona: solo códigos y el texto que toca, nunca nada de la sesión. */
export function resultadoDe(motivo, extra = {}) {
  const conectada = motivo === "conectada"
  return { conectada, ...(conectada ? {} : { motivo }), ...extra, instrucciones: INSTRUCCIONES[motivo] ?? INSTRUCCIONES.rechazada }
}

/**
 * Vigila la ventana hasta que la persona ha entrado y manda la sesión. Devuelve el resultado para la persona.
 * `fin()` -> true cuando Chrome se ha cerrado.
 */
export async function vigilarYMandar({ cdp, sesion, pase, pasarela, fin, ahora = Date.now, dormir, fetchFn = globalThis.fetch, plazoMs }) {
  const limite = ahora() + plazoMs
  let pagina = "sin_mirar"
  let nombreNoAntesDe = 0
  let intentosNombre = 0
  let reintentosEnvio = 0
  while (ahora() < limite) {
    if (fin()) return resultadoDe("cerrada", { pagina })
    if (pasarela.estado.pase_rechazado > 0) return resultadoDe("caducado")
    try {
      const { targetInfos = [] } = await cdp.enviar("Target.getTargets")
      const paginas = targetInfos.filter((t) => t.type === "page")
      pagina = paginaDeLaVentana(paginas.map((t) => t.url ?? ""))
      if (pagina === "sin_internet" && pasarela.estado.salida_caida > 0 && pasarela.estado.tuneles === 0) return resultadoDe("salida_caida")
      const cookies = PASOS_SIN_ENTRAR.has(pagina) ? null : await cookiesDeInstagram(cdp)
      if (cookies && ahora() >= nombreNoAntesDe) {
        const leido = await evaluar(cdp, sesion, `(${leerNombreEnLaPagina.toString()})(${JSON.stringify(cookies.ds_user_id)})`, true)
        const nombre = typeof leido?.nombre === "string" ? leido.nombre : ""
        if (!USUARIO.test(nombre)) {
          intentosNombre++
          nombreNoAntesDe = ahora() + ESPERA_NOMBRE_MS
          if (intentosNombre >= 8) return resultadoDe("sin_nombre")
        } else {
          const huella = await evaluar(cdp, sesion, HUELLA)
          const enviado = await mandarSesion({ servidor: pase.servidor, token: pase.token, cuerpo: { usuario: nombre, cookies, huella }, fetchFn })
          if (enviado === "ok") return resultadoDe("conectada", { cuenta: nombre.toLowerCase() })
          if (enviado === "caducado") return resultadoDe("caducado")
          if (enviado === "rechazada" || ++reintentosEnvio >= 5) return resultadoDe("rechazada")
        }
      }
    } catch {
      if (fin()) return resultadoDe("cerrada", { pagina })
    }
    await dormir(INTERVALO_MS)
  }
  return resultadoDe(PASOS_SIN_ENTRAR.has(pagina) ? pagina : "tiempo", { pagina })
}

const PREFIJO_PERFIL = "drazo-research-"

/** Borra el perfil temporal; en Windows Chrome tarda un poco en soltar sus ficheros. */
function borrarPerfil(perfil) {
  try { rmSync(perfil, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) } catch { /* lo borra la próxima conexión */ }
}

/** Los perfiles que quedaran de una conexión cortada a medias (Claude cerrado, Windows sin soltar ficheros). */
export function borrarPerfilesViejos(carpeta = tmpdir(), ahora = Date.now()) {
  let entradas = []
  try { entradas = readdirSync(carpeta) } catch { return }
  for (const nombre of entradas) {
    if (!nombre.startsWith(PREFIJO_PERFIL)) continue
    const ruta = path.join(carpeta, nombre)
    try { if (ahora - statSync(ruta).mtimeMs > 30 * 60 * 1000) borrarPerfil(ruta) } catch { /* ya no está */ }
  }
}

/**
 * Todo el recorrido: pasarela, Chrome aparte, Instagram, sesión al servidor, ventana cerrada y perfil borrado.
 * `pase`: {token, servidor, proxy, zona_horaria, caduca_en_min} tal como lo da Drazo Studio.
 */
export async function conectarDesdeElOrdenador(pase, { navegador = buscarNavegador(), lanzar = spawn, dormir = (ms) => new Promise((r) => setTimeout(r, ms)), conectarTls } = {}) {
  if (!navegador) return resultadoDe("sin_navegador")
  borrarPerfilesViejos()
  const perfil = mkdtempSync(path.join(tmpdir(), PREFIJO_PERFIL))
  const pasarela = crearPasarela({ proxy: pase.proxy, token: pase.token, ...(conectarTls ? { conectarTls } : {}) })
  await new Promise((resolver) => pasarela.servidor.listen(0, "127.0.0.1", resolver))
  const hijo = lanzar(navegador, opcionesDelNavegador({ perfil, puerto: pasarela.servidor.address().port }), { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] })
  let cerrado = false
  hijo.once("exit", () => { cerrado = true })
  hijo.once("error", () => { cerrado = true })
  const cdp = crearCdpTuberia(hijo.stdio[3], hijo.stdio[4])
  try {
    const { targetInfos = [] } = await cdp.enviar("Target.getTargets")
    const inicial = targetInfos.find((t) => t.type === "page") ?? { targetId: (await cdp.enviar("Target.createTarget", { url: "about:blank" })).targetId }
    const { sessionId } = await cdp.enviar("Target.attachToTarget", { targetId: inicial.targetId, flatten: true })
    // La hora del navegador, la de la salida (Madrid por defecto): una IP de España con el reloj de otro país es rara
    if (pase.zona_horaria) await cdp.enviar("Emulation.setTimezoneOverride", { timezoneId: pase.zona_horaria }, sessionId).catch(() => {})
    await cdp.enviar("Page.navigate", { url: LOGIN }, sessionId)
    const plazoMs = Math.max(60_000, (Number(pase.caduca_en_min) || 15) * 60_000 - 45_000)
    return await vigilarYMandar({ cdp, sesion: sessionId, pase, pasarela, fin: () => cerrado, dormir, plazoMs })
  } catch {
    return resultadoDe(cerrado ? "cerrada" : "rechazada")
  } finally {
    if (!cerrado) {
      // Primero fuera las cookies: si el perfil no se pudiera borrar, que no quede la sesión en el disco
      await cdp.enviar("Storage.clearCookies").catch(() => {})
      await cdp.enviar("Browser.close").catch(() => {})
      await dormir(1500)
      if (!cerrado) hijo.kill()
    }
    pasarela.servidor.closeAllConnections?.()
    pasarela.servidor.close()
    borrarPerfil(perfil)
  }
}
