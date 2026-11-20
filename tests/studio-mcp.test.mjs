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
const CUENTA = "drzc_prueba_0123456789abcdef0123456789abcdef"
const MARCAS = [
  { slug: "cafe-del-mar", nombre: "Café del Mar", instagram: "cafedelmar", estado: "activa", baja_el: null },
  { slug: "clinica-sol", nombre: "Clínica Sol", instagram: "clinicasol", estado: "baja_programada", baja_el: "2026-12-31" },
  { slug: "clinica-luna", nombre: "Clínica Luna", instagram: "lunaclinic", estado: "pausada", baja_el: null },
  { slug: "horno-1", nombre: "Panadería Horno", instagram: "hornopan", estado: "activa", baja_el: null },
  { slug: "horno-2", nombre: "Panadería Horno", instagram: "hornopan2", estado: "activa", baja_el: null },
]
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
    const llevaMarca = peticion.headers["x-drazo-marca"]
    if (url.pathname === "/api/studio/marcas") return enviar(200, { cuenta: { nombre: "Agencia Sol" }, marcas: MARCAS, actual: llevaMarca ?? null })
    if (url.pathname === "/api/studio/estado" && String(peticion.headers["x-drazo-licencia"]).startsWith("drzc_") && !llevaMarca) {
      return enviar(409, { error: "marca_sin_elegir", mensaje: "Esta cuenta lleva varias marcas: Café del Mar (cafe-del-mar), Clínica Sol (clinica-sol). Pregunta con cuál trabajamos y elígela con usar_marca." })
    }
    if (url.pathname === "/api/studio/viral") return enviar(200, { id: "v1", transcripcion: "hola", hojas: [{ mime: "image/jpeg", base64: HOJA }, { mime: "image/jpeg", base64: HOJA }] })
    if (url.pathname === "/api/studio/metodo-contexto") return enviar(200, { contexto: "EL MÉTODO DE LA TAREA", parte: 1, partes: 2, siguiente: "Falta leer más" })
    if (url.pathname === "/api/studio/version" || url.pathname === "/api/studio/version-ajuste") return enviar(200, { ok: true, brief_id: "b1", guion: { original: "x" } })
    if (url.pathname === "/api/studio/puntuar-idea") return enviar(429, { error: "cupo_agotado", mensaje: "Has usado las 20 ideas con nota de tu plan." })
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
  ["guardar_marca", { nombre: "Marca", respuestas: { sector: "Cafetería", publico: "Vecinos del barrio" } }, "POST", "/marca"],
  ["referencias", {}, "GET", "/referencias"],
  ["referencias", { anadir: ["cuenta"] }, "POST", "/referencias"],
  ["radar", {}, "POST", "/radar"],
  ["semana", {}, "GET", "/semana"],
  ["descubridor", {}, "GET", "/descubridor"],
  ["viral", { id: "v1" }, "GET", "/viral"],
  ["guardar_enlace", { url: "https://www.instagram.com/reel/ABC/" }, "POST", "/enlace"],
  ["metodo_contexto", { tarea: "guion", parte: 2 }, "POST", "/metodo-contexto"],
  ["metodo_contexto", { tarea: "marca" }, "POST", "/metodo-contexto"],
  ["metodo_verificar", { ids: ["GUI-001"], texto: "texto" }, "POST", "/metodo-verificar"],
  ["ventas_contexto", { enfoque: "vender", parte: 2 }, "POST", "/ventas-contexto"],
  ["guardar_propuesta", { gancho: "gancho" }, "POST", "/propuesta"],
  ["programar", { brief_id: "b1", fecha: null }, "POST", "/programar"],
  ["calendario", { estado: "new", limite: 5 }, "GET", "/calendario"],
  ["cifras", {}, "GET", "/cifras"],
  ["memoria", {}, "GET", "/memoria"],
  ["guardar_memoria", { texto: "nota" }, "POST", "/memoria"],
  ["mi_version", { viral_id: "5b2f2a5e-0c1d-4d57-9a53-2f6a6f0c9a11" }, "POST", "/version"],
  ["mi_version", { brief_id: "5b2f2a5e-0c1d-4d57-9a53-2f6a6f0c9a12", cambio: "Que el cierre hable de mi oferta." }, "POST", "/version-ajuste"],
]

test("las 26 herramientas, cada una a su ruta y con las tres cabeceras (y sin marca con una licencia de una sola marca)", async () => {
  recibidas.length = 0
  const [lista, ...resultados] = await sesion([["tools/list", {}], ...TABLA.map(([nombre, argumentos]) => llamar(nombre, argumentos))])
  const nombres = lista.result.tools.map((h) => h.name)
  assert.equal(nombres.length, 26)
  assert.deepEqual([...new Set(TABLA.map(([nombre]) => nombre)), "puntuar_idea", "marcas", "usar_marca"].sort(), [...nombres].sort())
  assert.equal(recibidas.length, TABLA.length)
  TABLA.forEach(([nombre, argumentos, metodo, ruta], i) => {
    const peticion = recibidas[i]
    assert.equal(peticion.metodo, metodo, nombre)
    assert.equal(peticion.ruta, `/api/studio${ruta}`, nombre)
    assert.equal(peticion.cabeceras["x-drazo-licencia"], LICENCIA)
    assert.match(peticion.cabeceras["x-drazo-instalacion"], /^[0-9a-f-]{36}$/)
    assert.equal(peticion.cabeceras["x-drazo-plugin"], "3.5.0")
    assert.equal(peticion.cabeceras["x-drazo-marca"], undefined)
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
  assert.match(respuesta.result.content[0].text, /Has usado las 20 ideas con nota de tu plan\./)
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
    "skills/experto-de-ventas/SKILL.md",
  ])
  const texto = todos.map((f) => readFileSync(f, "utf8")).join("\n")
  for (const resto of ["INSTANCIA_", "reel-local", "ver_reel", "x-instancia-token", "child_process", "yt-dlp", "whisper"]) assert.ok(!texto.includes(resto), resto)
  // Ningún código de regla del canon ni la política del servidor en lo que se instala en el ordenador del miembro
  assert.ok(!/\b(SIS|ALG|MET|CUE|IDE|GAN|GUI|FOR|EDI|HIS|PUB|EMB|VEN)-\d{3}\b/.test(texto))
  assert.ok(!texto.includes("CÓMO RESPONDES") && !texto.includes("CÓMO SE ENTREGA"))
})

test("el experto de ventas se activa con lo de vender, pide su método al servidor y no envía nada", () => {
  const skill = readFileSync(path.join(raiz, "skills", "experto-de-ventas", "SKILL.md"), "utf8")
  const descripcion = skill.split("\n").find((linea) => linea.startsWith("description:"))
  for (const frase of [/oferta/, /lanzamiento/, /bio/, /qué contestar a un cliente/, /me lo pienso/]) assert.match(descripcion, frase)
  assert.match(skill, /`ventas_contexto`/)
  assert.match(skill, /Nunca envías nada/)
  assert.ok(!/canon/i.test(skill))
  assert.match(readFileSync(path.join(raiz, "skills", "drazo-studio", "SKILL.md"), "utf8"), /experto-de-ventas/)
})

test("«utiliza el método Drazo» activa el skill y en lo instalado no aparece la palabra canon", () => {
  const skill = readFileSync(path.join(raiz, "skills", "drazo-studio", "SKILL.md"), "utf8")
  const descripcion = skill.split("\n").find((linea) => linea.startsWith("description:"))
  assert.match(descripcion, /utiliza el método Drazo/)
  assert.match(skill, /\| «Utiliza el método Drazo»/)
})

test("mi_version: con el vídeo manda solo las respuestas que vienen; con brief_id y cambio, solo esos dos", async () => {
  recibidas.length = 0
  const [lista, ...resultados] = await sesion([
    ["tools/list", {}],
    llamar("mi_version", { url: "https://www.instagram.com/reel/ABC/", que_ensenas: "Mi panel", destino: "Escríbeme PLAZA" }),
    llamar("mi_version", { viral_id: "v1", cifra: "12 clientes", brief_id: "b1" }),
    llamar("mi_version", { brief_id: "b1", cambio: "Más corto y sin cifras inventadas.", cifra: "ignorada" }),
    llamar("mi_version", {}),
  ])
  assert.ok(lista.result.tools.some((h) => h.name === "mi_version"))
  assert.equal(recibidas.length, 3)
  assert.equal(recibidas[0].ruta, "/api/studio/version")
  assert.deepEqual(recibidas[0].cuerpo, { url: "https://www.instagram.com/reel/ABC/", respuestas: { que_ensenas: "Mi panel", destino: "Escríbeme PLAZA" } })
  assert.equal(recibidas[1].ruta, "/api/studio/version")
  assert.deepEqual(recibidas[1].cuerpo, { viral_id: "v1", respuestas: { cifra: "12 clientes" } })
  assert.equal(recibidas[2].ruta, "/api/studio/version-ajuste")
  assert.deepEqual(recibidas[2].cuerpo, { brief_id: "b1", cambio: "Más corto y sin cifras inventadas." })
  assert.ok(!resultados[0].result.isError && !resultados[2].result.isError)
  assert.equal(resultados[3].result.isError, true)
})

const texto = (respuesta) => respuesta.result.content.map((c) => c.text).join("\n")

test("con una clave de cuenta, marcas y usar_marca piden GET /marcas, y la marca elegida viaja en x-drazo-marca", async () => {
  recibidas.length = 0
  const [lista, antes, elegir, estado, marcas] = await sesion([
    ["tools/list", {}],
    llamar("marcas"),
    llamar("usar_marca", { marca: "cafe del mar" }),
    llamar("estado"),
    llamar("marcas"),
  ], { DRAZO_LICENCIA: CUENTA })
  assert.ok(["marcas", "usar_marca"].every((n) => lista.result.tools.some((h) => h.name === n)))
  assert.deepEqual(recibidas.map((p) => [p.metodo, p.ruta]), [
    ["GET", "/api/studio/marcas"], ["GET", "/api/studio/marcas"], ["GET", "/api/studio/estado"], ["GET", "/api/studio/marcas"],
  ])
  assert.ok(recibidas.every((p) => p.cabeceras["x-drazo-licencia"] === CUENTA && p.cabeceras["x-drazo-plugin"] === "3.5.0"))
  assert.equal(recibidas[0].cabeceras["x-drazo-marca"], undefined)
  assert.equal(recibidas[1].cabeceras["x-drazo-marca"], undefined)
  assert.equal(recibidas[2].cabeceras["x-drazo-marca"], "cafe-del-mar")
  assert.equal(recibidas[3].cabeceras["x-drazo-marca"], "cafe-del-mar")
  assert.match(texto(antes), /Cuenta: Agencia Sol/)
  assert.match(texto(antes), /Clínica Sol \(clinica-sol\) · @clinicasol · baja_programada · de baja el 2026-12-31/)
  assert.match(texto(antes), /Clínica Luna \(clinica-luna\) · @lunaclinic · pausada/)
  assert.match(texto(antes), /Ninguna marca elegida todavía/)
  assert.equal(texto(elegir), "Ahora trabajamos con Café del Mar.")
  assert.ok(!estado.result.isError)
  assert.match(texto(marcas), /Marca actual: Café del Mar \(cafe-del-mar\)\./)
})

test("usar_marca encuentra la marca por slug, nombre sin acentos ni mayúsculas o Instagram sin @", async () => {
  for (const [pedida, slug] of [["clinica-sol", "clinica-sol"], ["CLINICA LUNA", "clinica-luna"], ["@lunaclinic", "clinica-luna"], ["Café del Mar", "cafe-del-mar"], ["cafedelmar", "cafe-del-mar"]]) {
    recibidas.length = 0
    const [elegir] = await sesion([llamar("usar_marca", { marca: pedida }), llamar("cifras")], { DRAZO_LICENCIA: CUENTA })
    assert.match(texto(elegir), /^Ahora trabajamos con /, pedida)
    assert.equal(recibidas.at(-1).cabeceras["x-drazo-marca"], slug, pedida)
  }
})

test("usar_marca dice el estado de la marca solo si no es activa ni de baja programada", async () => {
  const [activa, programada, pausada] = await sesion([llamar("usar_marca", { marca: "cafe-del-mar" }), llamar("usar_marca", { marca: "clinica-sol" }), llamar("usar_marca", { marca: "clinica-luna" })], { DRAZO_LICENCIA: CUENTA })
  assert.equal(texto(activa), "Ahora trabajamos con Café del Mar.")
  assert.equal(texto(programada), "Ahora trabajamos con Clínica Sol.")
  assert.match(texto(pausada), /^Ahora trabajamos con Clínica Luna\. La marca Clínica Luna no está activa/)
})

test("usar_marca sin coincidencia o con varias enseña la lista y no fija nada", async () => {
  recibidas.length = 0
  const [ninguna, varias, estado] = await sesion([llamar("usar_marca", { marca: "pizzería" }), llamar("usar_marca", { marca: "panaderia horno" }), llamar("estado")], { DRAZO_LICENCIA: CUENTA })
  assert.match(texto(ninguna), /Esa marca no está en tu cuenta/)
  assert.match(texto(ninguna), /Café del Mar \(cafe-del-mar\)/)
  assert.match(texto(varias), /Hay varias marcas que encajan/)
  assert.match(texto(varias), /horno-1/)
  assert.match(texto(varias), /horno-2/)
  assert.ok(!ninguna.result.isError && !varias.result.isError)
  assert.equal(recibidas.at(-1).ruta, "/api/studio/estado")
  assert.equal(recibidas.at(-1).cabeceras["x-drazo-marca"], undefined)
  assert.equal(estado.result.isError, true)
})

test("con una licencia de una sola marca, marcas y usar_marca contestan en local y la cabecera de marca no sale nunca", async () => {
  recibidas.length = 0
  const [marcas, usar, estado] = await sesion([llamar("marcas"), llamar("usar_marca", { marca: "cafe-del-mar" }), llamar("estado")])
  assert.equal(texto(marcas), "Tu licencia es de una sola marca.")
  assert.equal(texto(usar), "Tu licencia es de una sola marca.")
  assert.ok(!marcas.result.isError && !usar.result.isError && !estado.result.isError)
  assert.equal(recibidas.length, 1)
  assert.equal(recibidas[0].ruta, "/api/studio/estado")
  assert.equal(recibidas[0].cabeceras["x-drazo-marca"], undefined)
})

test("marca_sin_elegir llega con su mensaje y sin la clave", async () => {
  const [respuesta] = await sesion([llamar("estado")], { DRAZO_LICENCIA: CUENTA })
  assert.equal(respuesta.result.isError, true)
  assert.match(texto(respuesta), /Esta cuenta lleva varias marcas: Café del Mar \(cafe-del-mar\), Clínica Sol \(clinica-sol\)\. Pregunta con cuál trabajamos y elígela con usar_marca\./)
  assert.ok(!texto(respuesta).includes(CUENTA) && !texto(respuesta).includes("marca_sin_elegir"))
})

test("la versión es la 3.5.0 en plugin.json", () => {
  assert.equal(JSON.parse(readFileSync(path.join(raiz, ".claude-plugin", "plugin.json"), "utf8")).version, "3.5.0")
})

test("ningún fichero de plugin/ (salvo lo aparcado) nombra lo que una cuenta de agencia no debe ver", () => {
  const prohibido = new RegExp(["hazlo ?viral", "hazlo" + "-viral", "comuni" + "dad", "\\breto\\b", ["plan", "completo"].join(" ")].join("|"), "i")
  const base = path.join(raiz, "..", "..")
  const ficheros = (carpeta) => readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    if (["aparcado", "node_modules", ".git"].includes(entrada.name)) return []
    const ruta = path.join(carpeta, entrada.name)
    return entrada.isDirectory() ? ficheros(ruta) : [ruta]
  })
  const todos = ficheros(base)
  assert.ok(todos.length >= 8)
  for (const fichero of todos) assert.ok(!prohibido.test(readFileSync(fichero, "utf8")), path.relative(base, fichero))
})
