// Servidor MCP local de Drazo Studio 3.x: un mando a distancia. Cada herramienta hace una petición HTTP al
// servidor de Drazo Studio con la licencia del miembro y devuelve la respuesta. No ejecuta nada más en su
// ordenador. Entorno: DRAZO_LICENCIA y DRAZO_SERVIDOR (los pone el plugin).

import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { servirStdio } from "./mcp-comun.mjs"

const VERSION = JSON.parse(readFileSync(new URL("../.claude-plugin/plugin.json", import.meta.url), "utf8")).version

const SERVIDOR_POR_DEFECTO = "https://drazostudio.profimaxia.com"
const MENSAJE_SIN_LICENCIA = "Falta tu licencia de Drazo Studio. Pégala en la configuración del plugin (/plugin, Drazo Studio, Configurar) y vuelve a intentarlo."
const MENSAJE_SIN_CONEXION = "No llego al servidor de Drazo Studio. Mira tu conexión y vuelve a intentarlo en un momento."

/** La dirección del servidor: la de por defecto si no hay o no está sustituida. */
function servidorConfigurado() {
  const valor = (process.env.DRAZO_SERVIDOR ?? "").trim()
  if (!valor || valor.startsWith("${")) return SERVIDOR_POR_DEFECTO
  return valor.replace(/\/+$/, "")
}

const SERVIDOR = servidorConfigurado()

function licenciaActual() {
  const valor = (process.env.DRAZO_LICENCIA ?? "").trim()
  return !valor || valor.startsWith("${") ? "" : valor
}

function carpetaDatos() {
  const propia = (process.env.DRAZO_STUDIO_DATOS ?? "").trim()
  return propia || join(homedir(), ".drazo-studio")
}

let idGuardado
/** El identificador de esta instalación: se crea la primera vez y se reutiliza. */
export function idInstalacion() {
  if (idGuardado) return idGuardado
  const carpeta = carpetaDatos()
  mkdirSync(carpeta, { recursive: true })
  const fichero = join(carpeta, "instalacion.json")
  try {
    const leido = JSON.parse(readFileSync(fichero, "utf8"))
    if (leido?.id) {
      idGuardado = leido.id
      return idGuardado
    }
  } catch {}
  const id = randomUUID()
  writeFileSync(fichero, `${JSON.stringify({ id }, null, 1)}\n`)
  idGuardado = id
  return id
}

/** Compara versiones x.y.z: negativo si a es anterior a b. */
export function compararVersiones(a, b) {
  const partes = (v) => String(v).split(".").map((n) => Number.parseInt(n, 10) || 0)
  const [x, y] = [partes(a), partes(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

async function pedir(metodo, ruta, cuerpo, tiempoMs = 120_000) {
  const licencia = licenciaActual()
  if (!licencia) throw new Error(MENSAJE_SIN_LICENCIA)
  const llevaCuerpo = cuerpo !== undefined && cuerpo !== null
  let respuesta
  try {
    respuesta = await fetch(`${SERVIDOR}/api/studio${ruta}`, {
      method: metodo,
      headers: {
        "x-drazo-licencia": licencia,
        "x-drazo-instalacion": idInstalacion(),
        "x-drazo-plugin": VERSION,
        ...(llevaCuerpo ? { "Content-Type": "application/json" } : {}),
      },
      ...(llevaCuerpo ? { body: JSON.stringify(cuerpo) } : {}),
      signal: AbortSignal.timeout(tiempoMs),
    })
  } catch {
    throw new Error(MENSAJE_SIN_CONEXION)
  }
  const texto = await respuesta.text()
  let datos
  try { datos = texto ? JSON.parse(texto) : {} } catch { datos = {} }
  if (!respuesta.ok) throw new Error(datos?.mensaje || datos?.error || `Error ${respuesta.status}`)
  return datos
}

const comoTexto = (datos) => JSON.stringify(datos, null, 1)

const consulta = (valores) => {
  const parametros = new URLSearchParams()
  for (const [clave, valor] of Object.entries(valores)) if (valor !== undefined && valor !== null && valor !== "") parametros.set(clave, String(valor))
  const texto = parametros.toString()
  return texto ? `?${texto}` : ""
}

export const HERRAMIENTAS = [
  {
    name: "estado",
    description: "Te dice cómo va tu cuenta de Drazo Studio: qué plan tienes, cuánto llevas usado este mes y qué pasos te faltan por hacer.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "conectar",
    description: "Te da un enlace para conectar tu cuenta de Apify con Drazo Studio. Ábrelo en el navegador y pega ahí tu clave.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "panel",
    description: "Te da un enlace y un código para abrir tu panel de Drazo Studio (tu semana de virales, tus guardados, tu calendario, tu marca y tu cuenta). El enlace se abre en el navegador; el código se escribe en la app instalada o en el móvil. Valen 15 minutos y una sola vez; ese dispositivo se queda con la sesión abierta 30 días.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "marca",
    description: "Te muestra la ficha de tu marca tal y como está guardada: nombre, nichos, pilares, cuentas de referencia y lo que todavía falta.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "guardar_marca",
    description: "Guarda los datos de su marca que le pases; lo demás se queda como estaba. La forma de cada campo la devuelve la herramienta marca.",
    inputSchema: {
      type: "object",
      properties: {
        nombre: { type: "string" },
        handle_propio: { type: "string" },
        nichos: { type: "array", items: { type: "string" } },
        bible: { type: "object" },
        pilares: {
          type: "array",
          items: {
            type: "object",
            properties: {
              position: { type: "integer", minimum: 1, maximum: 7 },
              name: { type: "string" },
              percentage: { type: "integer" },
              description: { type: "string" },
            },
            required: ["position", "name", "percentage", "description"],
          },
        },
      },
    },
  },
  {
    name: "material_marca",
    description: "Entrega a Drazo Studio lo que ya sabes de esta persona y de su negocio (su estrategia, su público, su oferta, cómo habla, sus hechos con cifras) para que le proponga su marca. Tú no redactas la marca: pasas el material tal cual, en un solo texto.",
    inputSchema: {
      type: "object",
      properties: { texto: { type: "string", description: "El material, en texto plano, de 40 a 20.000 caracteres." } },
      required: ["texto"],
    },
  },
  {
    name: "referencias",
    description: "Te enseña las cuentas de Instagram que sigues para inspirarte. Si le pasas cuentas para añadir o quitar, las actualiza.",
    inputSchema: {
      type: "object",
      properties: {
        anadir: { type: "array", items: { type: "string" } },
        quitar: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "radar",
    description: "Revisa ahora tus cuentas de referencia y busca los vídeos que mejor funcionan, sin esperar a la revisión automática. Puede tardar unos minutos.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "semana",
    description: "Te enseña los virales más destacados de tus cuentas de referencia de esta semana.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "viral",
    description: "Un viral de su banco entero: lo que dice, lo que se ve, por qué funcionó y dos hojas de fotogramas (los cinco primeros segundos y el vídeo completo). Se pide por su id (el de semana) o por su enlace. Indica uno de los dos.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        url: { type: "string" },
      },
    },
  },
  {
    name: "guardar_enlace",
    description: "Cuando la persona quiere replicar un vídeo concreto: manda su enlace de Instagram para que el servidor lo estudie. Tarda unos minutos; después se pide con viral y ese mismo enlace.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "metodo_contexto",
    description: "Pide el método de una tarea ANTES de escribir: ideas, ganchos, guion, corrección de guion, historias o carrusel. Cada apertura cuenta en el plan de la persona; dentro de la conversación se itera sin volver a abrirla. Si la respuesta dice que hay más partes, pídelas con parte 2, 3… antes de empezar. Con viral_id entra el viral que quiere replicar.",
    inputSchema: {
      type: "object",
      properties: {
        tarea: { type: "string", enum: ["idea", "gancho", "guion", "corregir_guion", "historias", "carrusel"] },
        viral_id: { type: "string" },
        max_ejemplos: { type: "integer", minimum: 0, maximum: 12 },
        parte: { type: "integer", minimum: 1, maximum: 12 },
      },
      required: ["tarea"],
    },
  },
  {
    name: "metodo_verificar",
    description: "Verifica lo escrito ANTES de enseñarlo: los ids de las reglas aplicadas de verdad y el texto que se va a entregar. Si pasa, devuelve el texto listo y un sello para guardar_propuesta; si no, dice qué corregir.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
        texto: { type: "string" },
      },
      required: ["ids", "texto"],
    },
  },
  {
    name: "puntuar_idea",
    description: "Pone nota a una idea de vídeo (una frase) y dice qué criterios cumple. Cuenta en el plan de la persona.",
    inputSchema: {
      type: "object",
      properties: {
        idea: { type: "string" },
        formato: { type: "string" },
        apoyo: { type: "string", description: "De qué viral sale la idea (enlace y veces sobre lo normal) y por qué el tema es de ahora. Sin datos de la marca." },
      },
      required: ["idea"],
    },
  },
  {
    name: "guardar_propuesta",
    description: "Guarda un vídeo en su calendario con su gancho y su guion. Hace falta el sello que devolvió metodo_verificar.",
    inputSchema: {
      type: "object",
      properties: {
        gancho: { type: "string", description: "El gancho elegido, en una frase." },
        guion: { type: "string", description: "El guion entero, tal como lo devolvió metodo_verificar." },
        opciones_gancho: { type: "array", items: { type: "string" }, description: "Las otras opciones de gancho que se le ofrecieron." },
        angulo: { type: "string", description: "El ángulo del vídeo en una frase." },
        pilar: { type: "string", description: "El pilar de su marca al que pertenece." },
        notas: { type: "string", description: "Notas de grabación." },
        url_origen: { type: "string", description: "El enlace del viral del que parte, si replica uno." },
        brief_id: { type: "string", description: "Para cambiar un vídeo que ya está en su calendario en vez de crear otro." },
        sello: { type: "object", description: "El sello que devolvió metodo_verificar, tal cual." },
      },
      required: ["gancho"],
    },
  },
  {
    name: "programar",
    description: "Pone fecha a un vídeo de su calendario (fecha en ISO con zona, por ejemplo 2026-11-20T18:00:00+01:00) o se la quita (null).",
    inputSchema: {
      type: "object",
      properties: {
        brief_id: { type: "string" },
        fecha: { type: ["string", "null"] },
      },
      required: ["brief_id", "fecha"],
    },
  },
  {
    name: "calendario",
    description: "Te enseña tus vídeos según su estado: por hacer, programados, grabando o publicados.",
    inputSchema: {
      type: "object",
      properties: {
        estado: { type: "string" },
        limite: { type: "integer" },
      },
    },
  },
  {
    name: "cifras",
    description: "Te enseña cómo van tus vídeos de los últimos 30 días: cuántos son, las visitas habituales y los mejores.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "memoria",
    description: "Te enseña las notas y los hechos que has pedido recordar.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "guardar_memoria",
    description: "Guarda una nota para que Drazo Studio la recuerde, o borra una que ya no quieras.",
    inputSchema: {
      type: "object",
      properties: {
        texto: { type: "string" },
        tipo: { type: "string", enum: ["regla", "hecho", "aprendido"] },
        olvidar: { type: "string" },
      },
    },
  },
]

export async function ejecutarHerramienta(nombre, argumentos = {}) {
  const a = argumentos ?? {}
  switch (nombre) {
    case "estado": return comoTexto(await pedir("GET", "/estado"))
    case "conectar": return comoTexto(await pedir("POST", "/conectar", {}))
    case "panel": return comoTexto(await pedir("POST", "/panel", {}))
    case "material_marca": return comoTexto(await pedir("POST", "/material-marca", { texto: argumentos.texto }))
    case "marca": return comoTexto(await pedir("GET", "/marca"))
    case "guardar_marca": return comoTexto(await pedir("POST", "/marca", a))
    case "referencias":
      if (a.anadir !== undefined || a.quitar !== undefined) return comoTexto(await pedir("POST", "/referencias", a))
      return comoTexto(await pedir("GET", "/referencias"))
    case "radar": return comoTexto(await pedir("POST", "/radar", {}, 300_000))
    case "semana": return comoTexto(await pedir("GET", "/semana"))
    case "viral": {
      if (!a.id && !a.url) throw new Error("Indica el id del viral o su enlace.")
      const ruta = a.id ? `/viral?id=${encodeURIComponent(a.id)}` : `/viral?url=${encodeURIComponent(a.url)}`
      const { hojas, ...resto } = await pedir("GET", ruta)
      return [
        { type: "text", text: comoTexto(resto) },
        ...(hojas ?? []).map((hoja) => ({ type: "image", data: hoja.base64, mimeType: hoja.mime })),
      ]
    }
    case "guardar_enlace": return comoTexto(await pedir("POST", "/enlace", { url: a.url }))
    case "metodo_contexto": {
      const { contexto, ...resto } = await pedir("POST", "/metodo-contexto", a)
      return [{ type: "text", text: contexto }, { type: "text", text: comoTexto(resto) }]
    }
    case "metodo_verificar": return comoTexto(await pedir("POST", "/metodo-verificar", a))
    case "puntuar_idea": return comoTexto(await pedir("POST", "/puntuar-idea", a))
    case "guardar_propuesta": return comoTexto(await pedir("POST", "/propuesta", a))
    case "programar": return comoTexto(await pedir("POST", "/programar", a))
    case "calendario": return comoTexto(await pedir("GET", `/calendario${consulta({ estado: a.estado, limite: a.limite })}`))
    case "cifras": return comoTexto(await pedir("GET", "/cifras"))
    case "memoria": return comoTexto(await pedir("GET", "/memoria"))
    case "guardar_memoria": return comoTexto(await pedir("POST", "/memoria", a))
    default: throw new Error(`Herramienta desconocida: ${nombre}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  servirStdio({ nombre: "drazo-studio", version: VERSION, herramientas: HERRAMIENTAS, ejecutar: ejecutarHerramienta })
}
