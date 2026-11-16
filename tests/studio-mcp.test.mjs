// El servidor MCP del plugin 3.x contra un servidor HTTP falso: cada herramienta pide lo que toca, con sus cabeceras,
// y en el ordenador del miembro no hace nada más. Uso: node --test plugin/tests/studio-mcp.test.mjs

import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import test, { after, before } from "node:test"
import { fileURLToPath } from "node:url"

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "plugins", "drazo-studio")
const script = path.join(raiz, "scripts", "mcp-drazo-studio.mjs")
const LICENCIA = "drz_prueba_0123456789abcdef0123456789abcdef"
const HOJA = Buffer.from("imagen de prueba").toString("base64")

const recibidas = []
let servidor
let puerto
let datos

before(async () => {
  datos = mkdtempSync(path.join(tmpdir(), "drazo-mcp-"))
  servidor = createServer(async (peticion, respuesta) => {
    let cuerpo = ""
    for await (const trozo of peticion) cuerpo += trozo
    const url = new URL(peticion.url, "http://x")
    recibidas.push({ metodo: peticion.method, ruta: url.pathname, consulta: url.search, cabeceras: peticion.headers, cuerpo: cuerpo ? JSON.parse(cuerpo) : null })
    const enviar = (estado, valor) => { respuesta.writeHead(estado, { "Content-Type": "application/json" }); respuesta.end(JSON.stringify(valor)) }
    if (url.pathname === "/api/studio/viral") return enviar(200, { id: "v1", transcripcion: "hola", hojas: [{ mime: "image/jpeg", base64: HOJA }, { mime: "image/jpeg", base64: HOJA }] })
    if (url.pathname === "/api/studio/metodo-contexto") return enviar(200, { contexto: "EL MÉTODO DE LA TAREA", parte: 1, partes: 2, siguiente: "Falta leer más" })
    if (url.pathname === "/api/studio/puntuar-idea") return enviar(429, { error: "cupo_agotado", mensaje: "Has usado las 20 ideas con nota de tu Reto." })
    return enviar(200, { ok: true, recurso: url.pathname })
  })
  await new Promise((listo) => servidor.listen(0, "127.0.0.1", listo))
  puerto = servidor.address().port
})

after(() => {
  servidor.close()
  rmSync(datos, { recursive: true, force: true })
})

/** Una sesión MCP por stdio: arranca el servidor, hace las llamadas y lo cierra. */
async function sesion(llamadas, entorno = {}) {
  const hijo = spawn(process.execPath, [script], {
    env: { ...process.env, DRAZO_LICENCIA: LICENCIA, DRAZO_SERVIDOR: `http://127.0.0.1:${puerto}/`, DRAZO_STUDIO_DATOS: datos, ...entorno },
    stdio: ["pipe", "pipe", "pipe"],
  })
  const mensajes = []
  let resto = ""
  hijo.stdout.on("data", (trozo) => {
    resto += trozo.toString()
    const lineas = resto.split("\n")
    resto = lineas.pop()
    for (const linea of lineas) if (linea.trim()) mensajes.push(JSON.parse(linea))
  })
  const esperar = (id) => new Promise((resolver, rechazar) => {
    let intentos = 200
    const mirar = () => {
      const encontrado = mensajes.find((m) => m.id === id)
      if (encontrado) return resolver(encontrado)
      if (--intentos <= 0) return rechazar(new Error(`sin respuesta del MCP a ${id}`))
      setTimeout(mirar, 25)
    }
    mirar()
  })
  const pedir = (id, method, params) => { hijo.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); return esperar(id) }
  await pedir(1, "initialize", { protocolVersion: "2024-11-05" })
  const respuestas = []
  let id = 10
  for (const [method, params] of llamadas) respuestas.push(await pedir(id++, method, params))
  hijo.stdin.end()
  return respuestas
}

const llamar = (nombre, argumentos = {}) => ["tools/call", { name: nombre, arguments: argumentos }]

const TABLA = [
  ["estado", {}, "GET", "/estado"],
  ["conectar", {}, "POST", "/conectar"],
  ["research", {}, "GET", "/research"],
  ["research", { accion: "conectar", acepto: true }, "POST", "/research"],
  ["research", { accion: "ya_esta" }, "POST", "/research"],
  ["research", { accion: "desconectar" }, "POST", "/research"],
  ["panel", {}, "POST", "/panel"],
  ["material_marca", { texto: "Lo que ya sé de esta persona: vende clases de inglés a adultos." }, "POST", "/material-marca"],
  ["marca", {}, "GET", "/marca"],
  ["guardar_marca", { nombre: "Marca" }, "POST", "/marca"],
  ["referencias", {}, "GET", "/referencias"],
  ["referencias", { anadir: ["cuenta"] }, "POST", "/referencias"],
  ["radar", {}, "POST", "/radar"],
  ["semana", {}, "GET", "/semana"],
  ["descubridor", {}, "GET", "/descubridor"],
  ["viral", { id: "v1" }, "GET", "/viral"],
  ["guardar_enlace", { url: "https://www.instagram.com/reel/ABC/" }, "POST", "/enlace"],
  ["metodo_contexto", { tarea: "guion", parte: 2 }, "POST", "/metodo-contexto"],
  ["metodo_verificar", { ids: ["GUI-001"], texto: "texto" }, "POST", "/metodo-verificar"],
  ["guardar_propuesta", { gancho: "gancho" }, "POST", "/propuesta"],
  ["programar", { brief_id: "b1", fecha: null }, "POST", "/programar"],
  ["calendario", { estado: "new", limite: 5 }, "GET", "/calendario"],
  ["cifras", {}, "GET", "/cifras"],
  ["memoria", {}, "GET", "/memoria"],
  ["guardar_memoria", { texto: "nota" }, "POST", "/memoria"],
]

test("las 22 herramientas, cada una a su ruta y con las tres cabeceras", async () => {
  recibidas.length = 0
  const [lista, ...resultados] = await sesion([["tools/list", {}], ...TABLA.map(([nombre, argumentos]) => llamar(nombre, argumentos))])
  const nombres = lista.result.tools.map((h) => h.name)
  assert.equal(nombres.length, 22)
  assert.deepEqual([...new Set(TABLA.map(([nombre]) => nombre)), "puntuar_idea"].sort(), [...nombres].sort())
  assert.equal(recibidas.length, TABLA.length)
  TABLA.forEach(([nombre, argumentos, metodo, ruta], i) => {
    const peticion = recibidas[i]
    assert.equal(peticion.metodo, metodo, nombre)
    assert.equal(peticion.ruta, `/api/studio${ruta}`, nombre)
    assert.equal(peticion.cabeceras["x-drazo-licencia"], LICENCIA)
    assert.match(peticion.cabeceras["x-drazo-instalacion"], /^[0-9a-f-]{36}$/)
    assert.equal(peticion.cabeceras["x-drazo-plugin"], "3.2.0")
    if (metodo === "POST" && Object.keys(argumentos).length) assert.deepEqual(peticion.cuerpo, argumentos, nombre)
    assert.ok(!resultados[i].result.isError, nombre)
  })
  assert.equal(recibidas[TABLA.findIndex(([n]) => n === "calendario")].consulta, "?estado=new&limite=5")
  assert.equal(recibidas[TABLA.findIndex(([n]) => n === "viral")].consulta, "?id=v1")
})

test("research sin acepto no llama al servidor y devuelve el aviso para leérselo a la persona", async () => {
  recibidas.length = 0
  const [respuesta] = await sesion([llamar("research", { accion: "conectar" })])
  assert.ok(!respuesta.result.isError)
  assert.match(respuesta.result.content[0].text, /incumple las condiciones de uso de Instagram/)
  assert.equal(recibidas.length, 0)
})

test("viral devuelve el texto sin las hojas y una imagen por hoja; metodo_contexto, el método primero", async () => {
  const [viral, metodo] = await sesion([llamar("viral", { url: "https://www.instagram.com/reel/ABC/" }), llamar("metodo_contexto", { tarea: "gancho" })])
  const [texto, ...imagenes] = viral.result.content
  assert.equal(texto.type, "text")
  assert.ok(!texto.text.includes("hojas") && !texto.text.includes(HOJA))
  assert.deepEqual(imagenes, [{ type: "image", data: HOJA, mimeType: "image/jpeg" }, { type: "image", data: HOJA, mimeType: "image/jpeg" }])
  assert.equal(metodo.result.content[0].text, "EL MÉTODO DE LA TAREA")
  assert.equal(JSON.parse(metodo.result.content[1].text).partes, 2)
})

test("un cupo agotado llega con el mensaje para la persona, no con el código", async () => {
  const [respuesta] = await sesion([llamar("puntuar_idea", { idea: "una idea de prueba" })])
  assert.equal(respuesta.result.isError, true)
  assert.match(respuesta.result.content[0].text, /Has usado las 20 ideas con nota de tu Reto\./)
  assert.ok(!respuesta.result.content[0].text.includes("cupo_agotado"))
})

test("sin licencia no se llama al servidor y se dice dónde pegarla", async () => {
  recibidas.length = 0
  for (const valor of ["", "${user_config.licencia}"]) {
    const [respuesta] = await sesion([llamar("estado")], { DRAZO_LICENCIA: valor })
    assert.equal(respuesta.result.isError, true)
    assert.match(respuesta.result.content[0].text, /Falta tu licencia de Drazo Studio/)
  }
  assert.equal(recibidas.length, 0)
})

test("la instalación se identifica con un id que se crea una vez y se reutiliza", async () => {
  recibidas.length = 0
  await sesion([llamar("estado")])
  await sesion([llamar("estado")])
  assert.equal(recibidas[0].cabeceras["x-drazo-instalacion"], recibidas[1].cabeceras["x-drazo-instalacion"])
  assert.equal(JSON.parse(readFileSync(path.join(datos, "instalacion.json"), "utf8")).id, recibidas[0].cabeceras["x-drazo-instalacion"])
})

test("el servidor no responde: mensaje llano y sin la licencia", async () => {
  const [respuesta] = await sesion([llamar("estado")], { DRAZO_SERVIDOR: "http://127.0.0.1:9" })
  assert.equal(respuesta.result.isError, true)
  assert.match(respuesta.result.content[0].text, /No llego al servidor de Drazo Studio/)
  assert.ok(!respuesta.result.content[0].text.includes(LICENCIA))
})

test("el plugin es solo un mando a distancia: ni restos de la versión instalada ni método en sus ficheros", () => {
  const ficheros = (carpeta) => readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = path.join(carpeta, entrada.name)
    return entrada.isDirectory() ? ficheros(ruta) : [ruta]
  })
  const todos = ficheros(raiz)
  assert.deepEqual(todos.map((f) => path.relative(raiz, f).replaceAll("\\", "/")).sort(), [
    ".claude-plugin/plugin.json", ".mcp.json", "scripts/mcp-comun.mjs", "scripts/mcp-drazo-studio.mjs", "skills/drazo-studio/SKILL.md",
  ])
  const texto = todos.map((f) => readFileSync(f, "utf8")).join("\n")
  for (const resto of ["INSTANCIA_", "reel-local", "ver_reel", "x-instancia-token", "child_process", "yt-dlp", "whisper"]) assert.ok(!texto.includes(resto), resto)
  // Ningún código de regla del canon ni la política del servidor en lo que se instala en el ordenador del miembro
  assert.ok(!/\b(SIS|ALG|MET|CUE|IDE|GAN|GUI|FOR|EDI|HIS|PUB|EMB|VEN)-\d{3}\b/.test(texto))
  assert.ok(!texto.includes("CÓMO RESPONDES") && !texto.includes("CÓMO SE ENTREGA"))
})

test("«utiliza el método Drazo» activa el skill y en lo instalado no aparece la palabra canon", () => {
  const skill = readFileSync(path.join(raiz, "skills", "drazo-studio", "SKILL.md"), "utf8")
  const descripcion = skill.split("\n").find((linea) => linea.startsWith("description:"))
  assert.match(descripcion, /utiliza el método Drazo/)
  assert.match(skill, /\| «Utiliza el método Drazo»/)
})
