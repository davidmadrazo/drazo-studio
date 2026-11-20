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

const esClaveCuenta = (licencia) => licencia.startsWith("drzc_")

/** La marca de esta conversación (una por proceso, que es una por conversación): su nombre corto en la cuenta. */
let marcaActual = null

const MENSAJE_UNA_MARCA = "Tu licencia es de una sola marca."
const ESTADO_MARCA = {
  pausada: (nombre) => `La marca ${nombre} no está activa: o todavía no ha empezado o está pausada hasta que se pague su cuota. Lo tienes en «Tu cuenta» del panel.`,
  de_baja: (nombre) => `La marca ${nombre} está de baja. Si quieres recuperarla, dala de alta otra vez desde «Tu cuenta».`,
  suspendida: (nombre) => `La marca ${nombre} está suspendida. Escríbenos para revisarla.`,
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

async function pedir(metodo, ruta, cuerpo, tiempoMs = 120_000, { conMarca = true } = {}) {
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
        ...(conMarca && marcaActual && esClaveCuenta(licencia) ? { "x-drazo-marca": marcaActual } : {}),
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

const AVISO_RESEARCH =
  "Automatizar una cuenta de Instagram incumple las condiciones de uso de Instagram y esa cuenta puede quedar limitada o cerrada. " +
  "Conecta solo una cuenta nueva creada para esto, nunca la tuya. Drazo no responde de una cuenta de research cerrada."

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
    description: "Te dice cómo va tu cuenta de Drazo Studio: qué plan tienes, cuánto llevas usado este mes y qué pasos te faltan por hacer. En una cuenta con varias marcas, dice también con cuál se trabaja.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "conectar",
    description: "Te da un enlace para conectar tu cuenta de Apify con Drazo Studio. Ábrelo en el navegador y pega ahí tu clave.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "research",
    description: "La cuenta de research: una cuenta de Instagram nueva, creada solo para esto, con la que Drazo Studio mira una vez al día lo que Instagram le enseña y saca más virales de su nicho. Con accion estado (por defecto) dice cómo va; con conectar da un enlace de un solo uso para que la persona entre ella misma en Instagram (exige acepto: true, y antes hay que leerle el aviso entero y que diga que sí; sin acepto devuelve el aviso); con ya_esta reanuda tras una comprobación de Instagram; con desconectar la retira.",
    inputSchema: {
      type: "object",
      properties: {
        accion: { type: "string", enum: ["estado", "conectar", "ya_esta", "desconectar"] },
        acepto: { type: "boolean", description: "Solo con conectar: true si la persona ha leído el aviso y ha dicho que sí." },
      },
    },
  },
  {
    name: "panel",
    description: "Abre tu panel de Drazo Studio (tu semana de virales, tus guardados, tu calendario, tu marca y tu cuenta). Devuelve lo que hace falta para entrar: sigue lo que devuelva.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "marcas",
    description: "Las marcas de tu cuenta de Drazo Studio, con su estado y la marca con la que se trabaja ahora. Si tu licencia es de una sola marca, lo dice sin más.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "usar_marca",
    description: "Elige la marca con la que trabajas en esta conversación (solo para cuentas con varias marcas): por su nombre corto, su nombre o su Instagram. Desde ahí, todo lo demás va a esa marca.",
    inputSchema: {
      type: "object",
      properties: { marca: { type: "string", description: "El nombre corto, el nombre o el Instagram de la marca." } },
      required: ["marca"],
    },
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
        respuestas: { type: "object", additionalProperties: { type: "string" }, description: "Las respuestas del cuestionario de la marca, por el id de cada pregunta." },
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
    name: "descubridor",
    description: "Te enseña los virales que ha encontrado el scroll de tu cuenta de research, aparte de los de tus cuentas de referencia. Cada uno se abre con `viral` por su id.",
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
    description: "Pide el método de una tarea ANTES de escribir: ideas, ganchos, guion, corrección de guion, historias, carrusel o, en una marca de agencia, la definición de su marca (marca). Cada apertura cuenta en el plan de la persona; dentro de la conversación se itera sin volver a abrirla. Si la respuesta dice que hay más partes, pídelas con parte 2, 3… antes de empezar. Con viral_id entra el viral que quiere replicar.",
    inputSchema: {
      type: "object",
      properties: {
        tarea: { type: "string", enum: ["idea", "gancho", "guion", "corregir_guion", "historias", "carrusel", "marca"] },
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
    name: "ventas_contexto",
    description: "El experto de ventas: pide su método ANTES de contestar sobre vender. Enfoque vender (oferta, precio, lanzamiento, qué contestar a un cliente, objeciones, llamadas, clientes que se van), embudo (del vídeo a la venta, lista, grupo o clase abierta, casos de éxito) o perfil (bio, enlace, destacadas, historias que venden). Si la pregunta toca dos, abre los dos. Dentro de la conversación se itera sin volver a abrirlo. Si la respuesta dice que hay más partes, pídelas con parte 2, 3… antes de contestar.",
    inputSchema: {
      type: "object",
      properties: {
        enfoque: { type: "string", enum: ["vender", "embudo", "perfil"] },
        parte: { type: "integer", minimum: 1, maximum: 12 },
      },
      required: ["enfoque"],
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
  {
    name: "mi_version",
    description: "Pide a Drazo Studio el guion ya hecho de la versión de la persona de un vídeo de su banco. Solo existe en los planes que lo llevan (si el tuyo no, el servidor lo dice) y el vídeo tiene que estar ya estudiado (por su id de semana o por su enlace). Antes de llamarla, hazle tres preguntas cortas y opcionales: qué va a enseñar suyo, qué cifra o resultado real puede dar y a qué quiere llevar al final; pasa sus respuestas tal cual en que_ensenas, cifra y destino. Tarda un par de minutos. El guion queda guardado en su calendario, sin fecha: entrégaselo tal cual, sin reescribirlo ni añadir consejos tuyos. Para pedir un cambio sobre un guion ya hecho, pasa su brief_id y lo que quiere cambiar en cambio.",
    inputSchema: {
      type: "object",
      properties: {
        viral_id: { type: "string", description: "El id del viral (el de semana)." },
        url: { type: "string", description: "El enlace del vídeo, si no se usa el id." },
        que_ensenas: { type: "string", description: "Qué va a enseñar de suyo en el vídeo." },
        cifra: { type: "string", description: "Qué cifra o resultado real puede dar." },
        destino: { type: "string", description: "A qué quiere llevar a quien lo vea, al final." },
        brief_id: { type: "string", description: "El guion ya hecho sobre el que pide un cambio." },
        cambio: { type: "string", description: "Lo que quiere cambiar, de 10 a 1000 caracteres." },
      },
    },
  },
]

const sinAcentos = (texto) => String(texto ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
const sinArroba = (texto) => sinAcentos(texto).replace(/^@+/, "")

function lineaDeMarca(marca) {
  const partes = [`${marca.nombre} (${marca.slug})`]
  if (marca.instagram) partes.push(`@${String(marca.instagram).replace(/^@+/, "")}`)
  partes.push(marca.estado ?? "activa")
  if (marca.baja_el) partes.push(`de baja el ${marca.baja_el}`)
  return `- ${partes.join(" · ")}`
}

async function listarMarcas() {
  if (!esClaveCuenta(licenciaActual())) {
    if (!licenciaActual()) throw new Error(MENSAJE_SIN_LICENCIA)
    return MENSAJE_UNA_MARCA
  }
  const datos = await pedir("GET", "/marcas")
  const marcas = datos.marcas ?? []
  const actual = datos.actual ?? marcaActual
  const elegida = marcas.find((m) => m.slug === actual)
  return [
    datos.cuenta?.nombre ? `Cuenta: ${datos.cuenta.nombre}` : "Tu cuenta:",
    marcas.length ? marcas.map(lineaDeMarca).join("\n") : "Todavía no tiene ninguna marca.",
    elegida ? `Marca actual: ${elegida.nombre} (${elegida.slug}).` : "Ninguna marca elegida todavía: dime con cuál trabajamos y la elijo con usar_marca.",
  ].join("\n")
}

async function elegirMarca(buscada) {
  const licencia = licenciaActual()
  if (!licencia) throw new Error(MENSAJE_SIN_LICENCIA)
  if (!esClaveCuenta(licencia)) return MENSAJE_UNA_MARCA
  const pedida = sinAcentos(buscada)
  if (!pedida) throw new Error("Dime con qué marca quieres trabajar.")
  const { marcas = [] } = await pedir("GET", "/marcas", undefined, undefined, { conMarca: false })
  const arroba = sinArroba(buscada)
  const coinciden = marcas.filter((m) => sinAcentos(m.slug) === pedida || sinAcentos(m.nombre) === pedida || (m.instagram && sinArroba(m.instagram) === arroba))
  if (coinciden.length !== 1) {
    const lista = marcas.length ? marcas.map(lineaDeMarca).join("\n") : "Tu cuenta todavía no tiene ninguna marca."
    const motivo = coinciden.length ? "Hay varias marcas que encajan con eso" : "Esa marca no está en tu cuenta"
    return `${motivo}. Tus marcas:\n${lista}\nNo he cambiado nada: dime cuál de ellas.`
  }
  const [marca] = coinciden
  marcaActual = marca.slug
  const normal = !marca.estado || marca.estado === "activa" || marca.estado === "baja_programada"
  const aviso = normal ? null : (ESTADO_MARCA[marca.estado]?.(marca.nombre) ?? `Su estado es ${marca.estado}.`)
  return [`Ahora trabajamos con ${marca.nombre}.`, aviso].filter(Boolean).join(" ")
}

export async function ejecutarHerramienta(nombre, argumentos = {}) {
  const a = argumentos ?? {}
  switch (nombre) {
    case "estado": return comoTexto(await pedir("GET", "/estado"))
    case "conectar": return comoTexto(await pedir("POST", "/conectar", {}))
    case "research": {
      const accion = a.accion ?? "estado"
      if (accion === "estado") return comoTexto(await pedir("GET", "/research"))
      if (accion === "conectar") {
        if (a.acepto !== true) return comoTexto({ aviso: AVISO_RESEARCH, instrucciones: "Léele este aviso entero a la persona y pregúntale si lo entiende y lo acepta. Solo si dice que sí, vuelve a llamar con accion conectar y acepto true." })
        return comoTexto(await pedir("POST", "/research", { accion: "conectar", acepto: true }))
      }
      if (accion === "ya_esta" || accion === "desconectar") return comoTexto(await pedir("POST", "/research", { accion }))
      throw new Error("La acción de research tiene que ser estado, conectar, ya_esta o desconectar.")
    }
    case "marcas": return await listarMarcas()
    case "usar_marca": return await elegirMarca(a.marca)
    case "panel": return comoTexto(await pedir("POST", "/panel", {}))
    case "material_marca": return comoTexto(await pedir("POST", "/material-marca", { texto: argumentos.texto }))
    case "marca": return comoTexto(await pedir("GET", "/marca"))
    case "guardar_marca": return comoTexto(await pedir("POST", "/marca", a))
    case "referencias":
      if (a.anadir !== undefined || a.quitar !== undefined) return comoTexto(await pedir("POST", "/referencias", a))
      return comoTexto(await pedir("GET", "/referencias"))
    case "radar": return comoTexto(await pedir("POST", "/radar", {}, 300_000))
    case "semana": return comoTexto(await pedir("GET", "/semana"))
    case "descubridor": return comoTexto(await pedir("GET", "/descubridor"))
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
    case "ventas_contexto": {
      const { contexto, ...resto } = await pedir("POST", "/ventas-contexto", a)
      return [{ type: "text", text: contexto }, { type: "text", text: comoTexto(resto) }]
    }
    case "mi_version": {
      if (a.brief_id && a.cambio) return comoTexto(await pedir("POST", "/version-ajuste", { brief_id: a.brief_id, cambio: a.cambio }, 300_000))
      if (!a.viral_id && !a.url) throw new Error("Indica el id del viral o su enlace.")
      const respuestas = {}
      for (const campo of ["que_ensenas", "cifra", "destino"]) if (a[campo]) respuestas[campo] = a[campo]
      return comoTexto(await pedir("POST", "/version", { ...(a.viral_id ? { viral_id: a.viral_id } : { url: a.url }), ...(Object.keys(respuestas).length ? { respuestas } : {}) }, 300_000))
    }
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
