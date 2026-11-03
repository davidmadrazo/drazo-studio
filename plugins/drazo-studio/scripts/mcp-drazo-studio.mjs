// Servidor MCP local de Drazo Studio. Habla con la app del miembro (su Vercel, sus datos) con su token: la app
// pide al núcleo las piezas con método y las guarda como cuando se generan desde la web. Lo mecánico (ver un
// reel) corre aquí, en su ordenador. Entorno: INSTANCIA_URL e INSTANCIA_TOKEN (los pone el instalador).

import { readFileSync } from "node:fs"
import { servirStdio } from "./mcp-comun.mjs"

const VERSION = JSON.parse(readFileSync(new URL("../.claude-plugin/plugin.json", import.meta.url), "utf8")).version
// Sin configurar, el servidor arranca igual: cada herramienta dice qué falta en vez de dejar el plugin caído
const url = (process.env.INSTANCIA_URL ?? "").trim().replace(/\/+$/, "")
const token = (process.env.INSTANCIA_TOKEN ?? "").trim()

/** Compara versiones x.y.z: negativo si a es anterior a b. */
export function compararVersiones(a, b) {
  const partes = (v) => String(v).split(".").map((n) => Number.parseInt(n, 10) || 0)
  const [x, y] = [partes(a), partes(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

async function pedir(metodo, ruta, cuerpo, tiempoMs = 300000) {
  if (!url || !token) {
    throw new Error("Drazo Studio no está configurado en este Claude: falta la dirección de tu app o su token. Dile a Claude «revisa mi instalación de Drazo Studio» o vuelve a pasar el paso del plugin de INSTALAR.md.")
  }
  let respuesta
  try {
    respuesta = await fetch(`${url}${ruta}`, {
      method: metodo,
      headers: { "x-instancia-token": token, "x-drazo-studio-plugin": VERSION, ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
      ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
      signal: AbortSignal.timeout(tiempoMs),
    })
  } catch (error) {
    throw new Error(`No llego a tu Drazo Studio (${url}): ${error?.cause?.code ?? error?.message ?? error}. Mira que tu app está publicada o pasa «revisa mi instalación».`)
  }
  const texto = await respuesta.text()
  let datos
  try { datos = texto ? JSON.parse(texto) : {} } catch { datos = { mensaje: texto.slice(0, 300) } }
  if (!respuesta.ok) {
    const codigo = datos.error ?? `http_${respuesta.status}`
    const mensaje = datos.mensaje ?? (typeof datos.error === "string" && !datos.mensaje ? datos.error : "") ?? ""
    throw new Error(`${codigo}${mensaje && mensaje !== codigo ? `: ${mensaje}` : ""}`)
  }
  return datos
}

const consulta = (valores) => {
  const parametros = new URLSearchParams()
  for (const [clave, valor] of Object.entries(valores)) if (valor !== undefined && valor !== null && valor !== "") parametros.set(clave, String(valor))
  const texto = parametros.toString()
  return texto ? `?${texto}` : ""
}

const PILAR = { type: "integer", minimum: 1, maximum: 7, description: "Posición del pilar (la de marca.pilares). Sin él, elige el núcleo." }

export const HERRAMIENTAS = [
  {
    name: "estado",
    description: "Cómo está su Drazo Studio: versión, licencia, cuánto lleva del plan este mes por tarea, coste frente al techo y si falta Apify o Instagram. Úsala al saludar y cuando pregunte cuántas le quedan.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "marca",
    description: "Su ficha de marca: nombre, nichos, bible (posicionamiento, promesa, avatar, tono, hechos verificados), pilares, cuentas de referencia, si está completa y qué falta, y los nichos disponibles.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "guardar_marca",
    description: "Guarda el alta o cambios de su marca. Los pilares sustituyen a los que hubiera y sus porcentajes suman 100; las referencias se añaden. La bible se mezcla con la que ya hay. Solo hechos que el miembro haya dicho: nada inventado.",
    inputSchema: {
      type: "object",
      properties: {
        nombre: { type: "string", maxLength: 80 },
        nichos: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3, description: "Claves de marca.nichos_disponibles (slug)." },
        bible: {
          type: "object",
          description: "Campos: positioning, mission, category, character, tone (lista), unique_promise, anti_positioning (lista), avatar_primary y avatar_secondary ({name, age, location, profile, pain, desire, monetization}), verified_facts (lista de hechos comprobados), pov (first_person|third_person), content_style, voice_rules ({first_person_always, no_ai_slop, must_have}).",
        },
        pilares: {
          type: "array", minItems: 1, maxItems: 7,
          items: { type: "object", properties: { position: { type: "integer" }, name: { type: "string" }, percentage: { type: "integer" }, description: { type: "string" } }, required: ["position", "name", "percentage", "description"] },
        },
        referencias: {
          type: "array", maxItems: 30,
          items: { type: "object", properties: { platform: { type: "string", enum: ["instagram", "tiktok", "youtube"] }, handle: { type: "string" } }, required: ["handle"] },
        },
      },
    },
  },
  {
    name: "banco",
    description: "Los virales de sus cuentas de referencia que más se salen de la media de su creador (veces la media), con si ya están vistos. pendientes=true da los que faltan por ver: son los que dan referencias a los ganchos.",
    inputSchema: { type: "object", properties: { pendientes: { type: "boolean" }, limite: { type: "integer", minimum: 1, maximum: 50 } } },
  },
  {
    name: "radar",
    description: "Lee ya sus cuentas de referencia con su Apify y marca los virales nuevos en su banco, sin esperar a las tareas de lunes y jueves. Úsalo tras el alta o si añade referencias. Gasta de su Apify y tarda unos minutos.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "guardados",
    description: "Los reels que guardó o pegó, con si ya están vistos y si les falta la propuesta. pendientes=true da los que no tienen propuesta.",
    inputSchema: { type: "object", properties: { pendientes: { type: "boolean" }, limite: { type: "integer", minimum: 1, maximum: 50 } } },
  },
  {
    name: "guardar_enlace",
    description: "Añade un reel a sus Guardados pegando su enlace. Con Apify saca sus visitas y la media de su cuenta. Si el enlace no lleva el @, pásalo en handle (lo da ver_reel).",
    inputSchema: { type: "object", properties: { url: { type: "string" }, handle: { type: "string" }, caption: { type: "string" } }, required: ["url"] },
  },
  {
    name: "ver_reel",
    description: "Ve un reel en su ordenador: lo baja, lo transcribe en local y prepara imágenes de sus fotogramas (arranque y hojas). Devuelve la transcripción y las rutas de las imágenes: ábrelas con Read para describir lo que se ve antes de guardar_diseccion. Puede tardar unos minutos.",
    inputSchema: { type: "object", properties: { url: { type: "string" }, idioma: { type: "string", description: "es, en… o auto (por defecto)" }, forzar: { type: "boolean" } }, required: ["url"] },
  },
  {
    name: "guardar_diseccion",
    description: "Guarda en su app lo visto de un reel: la transcripción de ver_reel y lo que se ve en los fotogramas, solo lo que se ve. Así el banco lo usa como referencia y se puede analizar o adaptar.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" }, autor: { type: "string" }, caption: { type: "string" }, duracion_s: { type: "number" },
        plataforma: { type: "string", enum: ["instagram", "tiktok", "youtube"] }, transcripcion: { type: "string" },
        visual: {
          type: "object",
          properties: {
            first_5s_visual: { type: "string", description: "Qué se ve en los primeros 5 s, plano a plano" },
            visual_hook: { type: "string", description: "El elemento visual más potente del arranque" },
            on_screen_text: { type: "array", items: { type: "string" }, description: "Texto en pantalla, literal" },
            scene_setting: { type: "string" }, cut_rhythm: { type: "string", description: "Cortes contados en las hojas" },
            broll_style: { type: "string" }, notable_visual_techniques: { type: "array", items: { type: "string" } }, motion_notes: { type: "string" },
          },
        },
      },
      required: ["url", "transcripcion"],
    },
  },
  {
    name: "analizar_viral",
    description: "Por qué funcionó un viral (gancho, estructura, llamada a la acción, retención), con el método. El reel tiene que estar visto antes (ver_reel + guardar_diseccion).",
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  {
    name: "puntuar_idea",
    description: "Nota de una idea de vídeo y si merece grabarse. Una idea por llamada.",
    inputSchema: { type: "object", properties: { idea: { type: "string", minLength: 5, maxLength: 600 }, formato: { type: "string", maxLength: 40 } }, required: ["idea"] },
  },
  {
    name: "ganchos",
    description: "Una tanda de ganchos para un tema, apoyados en los virales vistos de su banco. Cada gancho vuelve con su id: pásalo a guion.",
    inputSchema: {
      type: "object",
      properties: { tema: { type: "string", minLength: 3, maxLength: 3000 }, pilar: PILAR, idioma: { type: "string" }, tipos: { type: "array", items: { type: "string" } } },
      required: ["tema"],
    },
  },
  {
    name: "guion",
    description: "El guion completo desde el gancho elegido (mejor por gancho_id), con llamada a la acción, notas de grabación, subtítulos y puntos de re-enganche. Para adaptar un viral visto, pasa su enlace en referencia_url.",
    inputSchema: {
      type: "object",
      properties: {
        gancho_id: { type: "string" }, gancho: { type: "string", description: "El texto del gancho si no hay id" },
        plataforma: { type: "string", enum: ["instagram", "tiktok", "youtube", "x", "linkedin"] },
        formato: { type: "string", enum: ["reel", "tiktok", "short", "post", "thread"] },
        duracion_s: { type: "integer", minimum: 10, maximum: 600 }, idea: { type: "string" }, referencia_url: { type: "string" },
      },
    },
  },
  {
    name: "corregir",
    description: "Corrige un guion, un gancho o una llamada a la acción: valoración, qué falla, cambios seguros y varias versiones con sus supuestos.",
    inputSchema: {
      type: "object",
      properties: { texto: { type: "string", minLength: 1, maxLength: 20000 }, tipo: { type: "string", enum: ["auto", "gancho", "cta", "guion_completo"] }, contexto: { type: "string", maxLength: 12000 } },
      required: ["texto"],
    },
  },
  {
    name: "historias",
    description: "Una secuencia de historias de Instagram para un tema.",
    inputSchema: {
      type: "object",
      properties: { tema: { type: "string" }, pilar: PILAR, total: { type: "integer", minimum: 5, maximum: 12 }, plantilla: { type: "string", enum: ["daily_vlog", "educational", "product_launch", "polls_engagement"] } },
      required: ["tema"],
    },
  },
  {
    name: "carrusel",
    description: "Un carrusel completo (diapositivas y pie) para un tema.",
    inputSchema: {
      type: "object",
      properties: { tema: { type: "string" }, plataforma: { type: "string", enum: ["instagram", "linkedin", "tiktok"] }, pilar: PILAR, diapositivas: { type: "integer", minimum: 6, maximum: 12 } },
      required: ["tema"],
    },
  },
  {
    name: "guardar_propuesta",
    description: "Mete un vídeo en su calendario (o completa uno pendiente) con el gancho elegido, el guion y su pilar. Con url_origen completa la propuesta de ese guardado.",
    inputSchema: {
      type: "object",
      properties: {
        brief_id: { type: "string" }, url_origen: { type: "string" }, gancho: { type: "string" }, opciones_gancho: { type: "array", items: { type: "string" } },
        guion: { type: "string" }, angulo: { type: "string" }, pilar: { type: "string" }, notas: { type: "string" },
        extras: { type: "object", description: "Lo que acompañe al guion: cta, notas de grabación, sello…" },
      },
      required: ["gancho"],
    },
  },
  {
    name: "programar",
    description: "Pone fecha a un vídeo del calendario (ISO con zona, por ejemplo 2026-11-10T09:00:00+01:00) o se la quita (fecha null).",
    inputSchema: { type: "object", properties: { brief_id: { type: "string" }, fecha: { type: ["string", "null"] } }, required: ["brief_id", "fecha"] },
  },
  {
    name: "calendario",
    description: "Sus vídeos: por hacer (new), programados (scheduled), grabando (recording) y, si lo pide, publicados (published).",
    inputSchema: { type: "object", properties: { estado: { type: "string", description: "Lista separada por comas" }, limite: { type: "integer", minimum: 1, maximum: 100 } } },
  },
  {
    name: "cifras",
    description: "Sus vídeos de los últimos 30 días: cuántos, la mediana de visitas y los cinco mejores con cuántas veces su mediana.",
    inputSchema: { type: "object", properties: {} },
  },
]

let verReel
async function cargarVerReel() {
  verReel ??= (await import("./reel-local.mjs")).verReel
  return verReel
}

export async function ejecutar(nombre, a = {}) {
  switch (nombre) {
    case "estado": {
      const estado = await pedir("GET", "/api/instancia/estado", null, 60000)
      const desfasado = estado.plugin_minimo && compararVersiones(VERSION, estado.plugin_minimo) < 0
      return { ...estado, plugin: VERSION, ...(desfasado ? { aviso_plugin: `Tu plugin de Drazo Studio (${VERSION}) es anterior al que pide tu app (${estado.plugin_minimo}): actualízalo.` } : {}) }
    }
    case "marca": return pedir("GET", "/api/instancia/marca", null, 60000)
    case "guardar_marca": return pedir("POST", "/api/instancia/marca", a, 60000)
    case "banco": return pedir("GET", `/api/instancia/banco${consulta({ pendientes: a.pendientes ? 1 : undefined, limite: a.limite })}`, null, 60000)
    case "radar": return pedir("POST", "/api/instancia/radar", {}, 300000)
    case "guardados": return pedir("GET", `/api/instancia/guardados${consulta({ pendientes: a.pendientes ? 1 : undefined, limite: a.limite })}`, null, 60000)
    case "guardar_enlace": return pedir("POST", "/api/saved/add", { url: a.url, ...(a.handle ? { handle: a.handle } : {}), ...(a.caption ? { caption: a.caption } : {}) })
    case "ver_reel": {
      const ver = await cargarVerReel()
      return ver(String(a.url ?? ""), { forzar: Boolean(a.forzar), ...(a.idioma ? { idioma: a.idioma } : {}) })
    }
    case "guardar_diseccion": return pedir("POST", "/api/instancia/diseccion", a, 60000)
    case "analizar_viral": return pedir("POST", "/api/outliers/analyze", { url: a.url })
    case "puntuar_idea": return pedir("POST", "/api/ideas/score", { idea: a.idea, ...(a.formato ? { formato: a.formato } : {}) })
    case "ganchos":
      return pedir("POST", "/api/hooks/generate", {
        topic: a.tema, ...(a.pilar ? { pillar_position: a.pilar } : {}), ...(a.idioma ? { language: a.idioma } : {}), ...(a.tipos?.length ? { hook_types: a.tipos } : {}),
      })
    case "guion":
      if (!a.gancho_id && !a.gancho) throw new Error("Falta el gancho: pasa gancho_id (de la tanda de ganchos) o el texto en gancho.")
      return pedir("POST", "/api/scripts/generate", {
        ...(a.gancho_id ? { hook_id: a.gancho_id } : { hook_text: a.gancho }),
        platform: a.plataforma ?? "instagram", content_type: a.formato ?? "reel",
        ...(a.duracion_s ? { target_duration_s: a.duracion_s } : {}), ...(a.idea ? { idea: a.idea } : {}), ...(a.referencia_url ? { referencia_url: a.referencia_url } : {}),
      })
    case "corregir":
      return pedir("POST", "/api/scripts/correct", { texto: a.texto, ...(a.tipo || a.contexto ? { revision: { tipo: a.tipo ?? "auto", contexto: a.contexto ?? "" } } : {}) })
    case "historias":
      return pedir("POST", "/api/stories/generate", { theme: a.tema, ...(a.pilar ? { pillar_position: a.pilar } : {}), ...(a.total ? { total: a.total } : {}), ...(a.plantilla ? { template: a.plantilla } : {}) })
    case "carrusel":
      return pedir("POST", "/api/carousels/generate", { topic: a.tema, platform: a.plataforma ?? "instagram", ...(a.pilar ? { pillar_position: a.pilar } : {}), ...(a.diapositivas ? { slide_count: a.diapositivas } : {}) })
    case "guardar_propuesta": return pedir("POST", "/api/instancia/propuesta", a, 60000)
    case "programar": return pedir("POST", "/api/instancia/programar", { brief_id: a.brief_id, fecha: a.fecha ?? null }, 60000)
    case "calendario": return pedir("GET", `/api/instancia/calendario${consulta({ estado: a.estado, limite: a.limite })}`, null, 60000)
    case "cifras": return pedir("GET", "/api/instancia/cifras", null, 60000)
    default: throw new Error(`Herramienta desconocida: ${nombre}`)
  }
}

servirStdio({ nombre: "drazo-studio", version: VERSION, herramientas: HERRAMIENTAS, ejecutar })
