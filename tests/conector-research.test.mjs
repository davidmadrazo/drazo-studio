// El conector de la cuenta de research (desde el ordenador del miembro) con dobles: ni Chrome, ni Instagram, ni el
// proxy ni el servidor de Drazo de verdad. Uso: node --test plugin/tests/conector-research.test.mjs

import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { existsSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import path from "node:path"
import { PassThrough } from "node:stream"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "plugins", "drazo-studio")
const conector = await import(pathToFileURL(path.join(raiz, "scripts", "conector-research.mjs")).href)
const { buscarNavegador, conectarDesdeElOrdenador, crearCdpTuberia, crearPasarela, destinoPermitido, opcionesDelNavegador, paginaDeLaVentana } = conector

const TOKEN = "K".repeat(43)
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"

test("solo Instagram, Facebook y el captcha, y solo por el 443", () => {
  for (const bueno of ["www.instagram.com:443", "scontent-mad1-1.cdninstagram.com:443", "static.xx.fbcdn.net:443", "www.google.com:443", "WWW.GSTATIC.COM:443"]) assert.ok(destinoPermitido(bueno), bueno)
  for (const malo of ["www.instagram.com:80", "evilinstagram.com:443", "accounts.google.com:443", "instagram.com.evil.net:443", "127.0.0.1:443", ""]) assert.ok(!destinoPermitido(malo), malo)
})

test("busca Chrome, después Edge y Brave, en cada sistema", () => {
  const conjunto = (rutas) => (ruta) => rutas.includes(ruta)
  const win = { PROGRAMFILES: "C:\\Program Files", "PROGRAMFILES(X86)": "C:\\Program Files (x86)", LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }
  assert.equal(buscarNavegador({ plataforma: "win32", entorno: win, existe: conjunto(["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"]) }), "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe")
  assert.equal(buscarNavegador({ plataforma: "win32", entorno: win, existe: conjunto(["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"]) }), "C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe")
  assert.equal(buscarNavegador({ plataforma: "darwin", entorno: { HOME: "/Users/a" }, existe: conjunto(["/Users/a/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]) }), "/Users/a/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
  assert.equal(buscarNavegador({ plataforma: "linux", entorno: { PATH: "/usr/bin:/snap/bin" }, existe: conjunto(["/snap/bin/chromium"]) }), "/snap/bin/chromium")
  assert.equal(buscarNavegador({ plataforma: "win32", entorno: win, existe: () => false }), null)
})

test("Chrome se abre con un perfil aparte, por la pasarela y sin WebRTC fuera del proxy", () => {
  const opciones = opcionesDelNavegador({ perfil: "/tmp/x", puerto: 4567 })
  assert.ok(opciones.includes("--user-data-dir=/tmp/x"))
  assert.ok(opciones.includes("--proxy-server=http://127.0.0.1:4567"))
  assert.ok(opciones.includes("--remote-debugging-pipe"))
  assert.ok(opciones.includes("--force-webrtc-ip-handling-policy=disable_non_proxied_udp"))
  assert.ok(!opciones.some((o) => o.startsWith("--remote-debugging-port") || o === "--enable-automation" || o === "--headless"))
})

test("en qué paso está la persona", () => {
  assert.equal(paginaDeLaVentana(["about:blank"]), "fuera_de_instagram")
  assert.equal(paginaDeLaVentana(["https://www.instagram.com/accounts/login/"]), "entrar")
  assert.equal(paginaDeLaVentana(["https://www.instagram.com/accounts/login/two_factor?next=%2F"]), "dos_pasos")
  assert.equal(paginaDeLaVentana(["https://www.instagram.com/challenge/abc/"]), "comprobacion")
  assert.equal(paginaDeLaVentana(["https://www.instagram.com/auth_platform/passkey/"]), "passkey")
  assert.equal(paginaDeLaVentana(["https://www.instagram.com/"]), "portada")
})

/** Un proxy de Drazo falso (sin TLS): acepta el pase bueno, contesta 407 al resto y hace de eco. */
async function proxyFalso() {
  const vistos = []
  const servidor = net.createServer((s) => {
    s.on("error", () => {})
    let buf = ""
    const leer = (d) => {
      buf += d
      const fin = buf.indexOf("\r\n\r\n")
      if (fin < 0) return
      s.off("data", leer)
      const linea = buf.slice(0, buf.indexOf("\r\n"))
      const auth = /Proxy-Authorization: Basic (\S+)/.exec(buf)?.[1]
      vistos.push({ linea, auth: auth ? Buffer.from(auth, "base64").toString() : null })
      if (auth !== Buffer.from(`enlace:${TOKEN}`).toString("base64")) return s.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n")
      s.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      s.on("data", (x) => s.write(`eco:${x}`))
    }
    s.on("data", leer)
  })
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r))
  const conectarTls = ({ port }) => {
    const socket = net.connect({ host: "127.0.0.1", port })
    socket.once("connect", () => socket.emit("secureConnect"))
    return socket
  }
  return { servidor, vistos, conectarTls, puerto: servidor.address().port }
}

function connect(puerto, destino) {
  return new Promise((resolver, rechazar) => {
    const req = http.request({ host: "127.0.0.1", port: puerto, method: "CONNECT", path: destino })
    req.on("connect", (res, socket) => resolver({ estado: res.statusCode, socket }))
    req.on("response", (res) => { res.resume(); resolver({ estado: res.statusCode }) })
    req.on("error", rechazar)
    req.end()
  })
}

test("la pasarela lleva cada túnel permitido al proxy de Drazo con el pase y corta lo demás aquí", async () => {
  const falso = await proxyFalso()
  const pasarela = crearPasarela({ proxy: `https://researchproxy.ejemplo.com:${falso.puerto}`, token: TOKEN, conectarTls: falso.conectarTls, tiempoMs: 2000 })
  await new Promise((r) => pasarela.servidor.listen(0, "127.0.0.1", r))
  const puerto = pasarela.servidor.address().port
  try {
    const bien = await connect(puerto, "www.instagram.com:443")
    assert.equal(bien.estado, 200)
    const eco = await new Promise((resolver) => { bien.socket.once("data", (d) => resolver(String(d))); bien.socket.write("hola") })
    assert.equal(eco, "eco:hola")
    bien.socket.destroy()
    assert.deepEqual(falso.vistos[0], { linea: "CONNECT www.instagram.com:443 HTTP/1.1", auth: `enlace:${TOKEN}` })

    assert.equal((await connect(puerto, "accounts.google.com:443")).estado, 403)
    assert.equal(falso.vistos.length, 1)
    assert.equal(pasarela.estado.tuneles, 1)
    assert.equal(pasarela.estado.bloqueados, 1)
  } finally {
    pasarela.servidor.closeAllConnections()
    pasarela.servidor.close()
    falso.servidor.close()
  }
})

test("si el proxy de Drazo contesta 503 un momento, la pasarela reintenta; un 407 no se reintenta", async () => {
  let llamadas = 0
  const servidor = net.createServer((s) => {
    s.on("error", () => {})
    s.once("data", () => {
      llamadas++
      if (llamadas < 3) return s.end("HTTP/1.1 503 Service Unavailable\r\n\r\n")
      s.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      s.on("data", (x) => s.write(`eco:${x}`))
    })
  })
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r))
  const conectarTls = ({ port }) => {
    const socket = net.connect({ host: "127.0.0.1", port })
    socket.once("connect", () => socket.emit("secureConnect"))
    return socket
  }
  const pasarela = crearPasarela({ proxy: `https://researchproxy.ejemplo.com:${servidor.address().port}`, token: TOKEN, conectarTls, tiempoMs: 3000, esperasReintentoMs: [20, 20, 20] })
  await new Promise((r) => pasarela.servidor.listen(0, "127.0.0.1", r))
  try {
    const r = await connect(pasarela.servidor.address().port, "www.instagram.com:443")
    assert.equal(r.estado, 200)
    assert.equal(llamadas, 3)
    r.socket.destroy()
    assert.equal(pasarela.estado.salida_caida, 0)
  } finally {
    pasarela.servidor.closeAllConnections()
    pasarela.servidor.close()
    servidor.close()
  }
})

test("con el pase caducado el proxy contesta 407 y la pasarela lo apunta", async () => {
  const falso = await proxyFalso()
  const pasarela = crearPasarela({ proxy: `https://researchproxy.ejemplo.com:${falso.puerto}`, token: "Z".repeat(43), conectarTls: falso.conectarTls, tiempoMs: 2000 })
  await new Promise((r) => pasarela.servidor.listen(0, "127.0.0.1", r))
  try {
    assert.equal((await connect(pasarela.servidor.address().port, "www.instagram.com:443")).estado, 502)
    assert.equal(pasarela.estado.pase_rechazado, 1)
  } finally {
    pasarela.servidor.closeAllConnections()
    pasarela.servidor.close()
    falso.servidor.close()
  }
})

test("la tubería de depuración: respuestas por id aunque lleguen a trozos, y error si Chrome se cierra", async () => {
  const aChrome = new PassThrough()
  const deChrome = new PassThrough()
  const cdp = crearCdpTuberia(aChrome, deChrome, { tiempoMs: 1000 })
  aChrome.on("data", (d) => {
    for (const texto of String(d).split("\0").filter(Boolean)) {
      const { id } = JSON.parse(texto)
      const respuesta = Buffer.from(JSON.stringify({ id, result: { eco: id } }) + "\0")
      deChrome.write(respuesta.subarray(0, 5))
      setTimeout(() => deChrome.write(respuesta.subarray(5)), 5)
    }
  })
  assert.deepEqual(await cdp.enviar("Target.getTargets"), { eco: 1 })
  const pendiente = cdp.enviar("Algo.queNoContesta").catch((e) => e.message)
  aChrome.removeAllListeners("data")
  deChrome.end()
  deChrome.destroy()
  assert.match(await pendiente, /cdp_(cerrado|tiempo)/)
})

/** Un Chrome falso: contesta por la tubería como Chrome y hace como si la persona entrase en Instagram. */
function chromeFalso({ entraTrasMs = 30, nombre = "Ana.Research" } = {}) {
  const hijo = new EventEmitter()
  const aChrome = new PassThrough()
  const deChrome = new PassThrough()
  hijo.stdio = [null, null, null, aChrome, deChrome]
  hijo.opciones = null
  hijo.kill = () => hijo.emit("exit", 0)
  const inicio = Date.now()
  const urlActual = () => (Date.now() - inicio > entraTrasMs ? "https://www.instagram.com/" : "https://www.instagram.com/accounts/login/")
  const comandos = []
  aChrome.on("data", (d) => {
    for (const texto of String(d).split("\0").filter(Boolean)) {
      const { id, method, params, sessionId } = JSON.parse(texto)
      comandos.push({ method, params, sessionId })
      let result = {}
      if (method === "Target.getTargets") result = { targetInfos: [{ targetId: "t1", type: "page", url: comandos.some((c) => c.method === "Page.navigate") ? urlActual() : "about:blank" }] }
      if (method === "Target.attachToTarget") result = { sessionId: "s1" }
      if (method === "Storage.getCookies") {
        result = { cookies: urlActual().endsWith("/login/") ? [] : [
          { name: "sessionid", value: "5%3Aabc%3A12", domain: ".instagram.com" },
          { name: "ds_user_id", value: "5", domain: ".instagram.com" },
          { name: "csrftoken", value: "csrf", domain: ".instagram.com" },
          { name: "otra", value: "x", domain: ".google.com" },
        ] }
      }
      if (method === "Runtime.evaluate") {
        result = params.expression.includes("web_form_data") ? { result: { value: { nombre, pistas: "f200" } } } : { result: { value: { ua: UA, marcas: '"Chromium";v="142"', plataforma: "Windows" } } }
      }
      if (method === "Browser.close") setTimeout(() => hijo.emit("exit", 0), 5)
      deChrome.write(JSON.stringify({ id, result }) + "\0")
    }
  })
  return { hijo, comandos }
}

async function servidorDrazo(estado = 200) {
  const recibidas = []
  const servidor = http.createServer(async (req, res) => {
    let cuerpo = ""
    for await (const t of req) cuerpo += t
    recibidas.push({ ruta: req.url, cuerpo: JSON.parse(cuerpo) })
    res.writeHead(estado, { "content-type": "application/json" })
    res.end(JSON.stringify(estado === 200 ? { ok: true } : { ok: false }))
  })
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r))
  return { servidor, recibidas, url: `http://127.0.0.1:${servidor.address().port}` }
}

test("de punta a punta: abre su Chrome, la persona entra, la sesión va al servidor de Drazo, se cierra y se borra el perfil", async () => {
  const drazo = await servidorDrazo()
  const { hijo, comandos } = chromeFalso()
  let lanzado
  const lanzar = (ruta, opciones, extra) => {
    lanzado = { ruta, opciones, extra }
    return hijo
  }
  const pase = { token: TOKEN, servidor: drazo.url, proxy: "https://researchproxy.ejemplo.com", zona_horaria: "Europe/Madrid", caduca_en_min: 15 }
  try {
    const resultado = await conectarDesdeElOrdenador(pase, { navegador: "C:/chrome.exe", lanzar, dormir: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))) })
    assert.deepEqual(resultado, { conectada: true, cuenta: "ana.research", instrucciones: resultado.instrucciones })
    assert.equal(lanzado.ruta, "C:/chrome.exe")
    assert.deepEqual(lanzado.extra.stdio, ["ignore", "ignore", "ignore", "pipe", "pipe"])
    const perfil = lanzado.opciones.find((o) => o.startsWith("--user-data-dir=")).slice("--user-data-dir=".length)
    assert.ok(!existsSync(perfil), "el perfil temporal se borra")

    // La zona horaria se pone antes de ir a Instagram, en su pestaña
    const metodos = comandos.map((c) => c.method)
    assert.ok(metodos.indexOf("Emulation.setTimezoneOverride") < metodos.indexOf("Page.navigate"))
    assert.deepEqual(comandos.find((c) => c.method === "Emulation.setTimezoneOverride"), { method: "Emulation.setTimezoneOverride", params: { timezoneId: "Europe/Madrid" }, sessionId: "s1" })
    assert.equal(comandos.find((c) => c.method === "Page.navigate").params.url, "https://www.instagram.com/accounts/login/")
    assert.ok(metodos.includes("Browser.close"))

    // Al servidor solo va lo del contrato: nombre, las cookies de Instagram de la lista y la huella
    assert.equal(drazo.recibidas.length, 1)
    assert.equal(drazo.recibidas[0].ruta, `/c/${TOKEN}/sesion`)
    assert.deepEqual(drazo.recibidas[0].cuerpo, {
      usuario: "Ana.Research",
      cookies: { sessionid: "5%3Aabc%3A12", ds_user_id: "5", csrftoken: "csrf" },
      huella: { ua: UA, marcas: '"Chromium";v="142"', plataforma: "Windows" },
    })
    // Lo que vuelve a Claude no lleva nada de la sesión ni el pase
    assert.ok(!JSON.stringify(resultado).includes("abc%3A12"))
    assert.ok(!JSON.stringify(resultado).includes(TOKEN))
  } finally {
    drazo.servidor.close()
  }
})

test("si la persona cierra la ventana antes de entrar, no se manda nada", async () => {
  const drazo = await servidorDrazo()
  const { hijo } = chromeFalso({ entraTrasMs: 60_000 })
  setTimeout(() => hijo.emit("exit", 0), 80)
  try {
    const resultado = await conectarDesdeElOrdenador({ token: TOKEN, servidor: drazo.url, proxy: "https://researchproxy.ejemplo.com", zona_horaria: null, caduca_en_min: 15 }, { navegador: "chrome", lanzar: () => hijo, dormir: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))) })
    assert.equal(resultado.conectada, false)
    assert.equal(resultado.motivo, "cerrada")
    assert.equal(drazo.recibidas.length, 0)
  } finally {
    drazo.servidor.close()
  }
})

test("con el enlace ya gastado el servidor contesta 404 y se le dice que pida otro", async () => {
  const drazo = await servidorDrazo(404)
  const { hijo } = chromeFalso()
  try {
    const resultado = await conectarDesdeElOrdenador({ token: TOKEN, servidor: drazo.url, proxy: "https://researchproxy.ejemplo.com", zona_horaria: null, caduca_en_min: 15 }, { navegador: "chrome", lanzar: () => hijo, dormir: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))) })
    assert.equal(resultado.motivo, "caducado")
  } finally {
    drazo.servidor.close()
  }
})

test("sin navegador no se abre nada", async () => {
  const resultado = await conectarDesdeElOrdenador({ token: TOKEN }, { navegador: null, lanzar: () => assert.fail("no debía lanzar") })
  assert.equal(resultado.motivo, "sin_navegador")
})

test("los perfiles que quedaran de una conexión cortada se borran a la siguiente; los recientes, no", async () => {
  const { mkdtempSync, mkdirSync, utimesSync, writeFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const carpeta = mkdtempSync(path.join(tmpdir(), "prueba-perfiles-"))
  try {
    const viejo = path.join(carpeta, "drazo-research-viejo")
    const nuevo = path.join(carpeta, "drazo-research-nuevo")
    const ajeno = path.join(carpeta, "otra-cosa")
    for (const d of [viejo, nuevo, ajeno]) { mkdirSync(d); writeFileSync(path.join(d, "Cookies"), "x") }
    const haceUnaHora = (Date.now() - 60 * 60 * 1000) / 1000
    utimesSync(viejo, haceUnaHora, haceUnaHora)
    utimesSync(ajeno, haceUnaHora, haceUnaHora)
    conector.borrarPerfilesViejos(carpeta)
    assert.ok(!existsSync(viejo))
    assert.ok(existsSync(nuevo))
    assert.ok(existsSync(ajeno))
  } finally {
    rmSync(carpeta, { recursive: true, force: true })
  }
})

test("antes de cerrar Chrome se borran sus cookies", async () => {
  const drazo = await servidorDrazo()
  const { hijo, comandos } = chromeFalso()
  try {
    await conectarDesdeElOrdenador({ token: TOKEN, servidor: drazo.url, proxy: "https://researchproxy.ejemplo.com", zona_horaria: null, caduca_en_min: 15 }, { navegador: "chrome", lanzar: () => hijo, dormir: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))) })
    const metodos = comandos.map((c) => c.method)
    assert.ok(metodos.includes("Storage.clearCookies"))
    assert.ok(metodos.indexOf("Storage.clearCookies") < metodos.indexOf("Browser.close"))
  } finally {
    drazo.servidor.close()
  }
})
