// "Ver" un reel en el ordenador del miembro, sin API de pago: baja el vídeo, lo transcribe en local con
// faster-whisper y deja imágenes de sus fotogramas para que el Claude del miembro las mire.
//
//   node reel-local.mjs <url> [--forzar] [--idioma es]     imprime el JSON del resultado
//   import { verReel } from "./reel-local.mjs"
//
// Descarga: Instagram por el embed (playwright-core, sin login ni cookies) y, si no trae vídeo, yt-dlp; el resto
// de plataformas, yt-dlp. Son 2-3 peticiones anónimas por reel y ningún reintento agresivo.

import { execFile } from "node:child_process"
import { createWriteStream, existsSync, readFileSync, readdirSync, realpathSync, rmSync, renameSync, writeFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"
import { MODELO_WHISPER, NAVEGADORES, NODE_HERRAMIENTAS, PYTHON, REELS, binario, esWindows } from "./rutas.mjs"

const MAX_BYTES = 200 * 1024 * 1024
const MAX_DURACION_DESCARGA_S = 900
const SEGUNDOS_ARRANQUE = 5
const ANCHO_FOTOGRAMA = 270
const FOTOGRAMAS_POR_HOJA = 30
const COLUMNAS_HOJA = 6
const UMBRAL_LARGO_S = 180
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
const EXTENSIONES_VIDEO = /^video\.(mp4|mkv|webm|mov|m4v)$/i
const GENERADOS = [/^video\.[a-z0-9]+(\.part)?$/i, /^video\.info\.json$/i, /^audio\.wav$/, /^arranque\.jpg$/, /^hoja-\d+\.jpg$/, /^resultado\.json$/, /^meta\.json$/]

const AYUDA_MANUAL = "Mientras tanto puedes abrir el reel, copiar lo que dice (o su transcripción) y pegármelo aquí: con eso trabajo igual aunque no vea los fotogramas."

// ---------- URL y clave ----------

/**
 * Reconoce el enlace y saca la clave estable: shortcode de Instagram, id de YouTube o id de TikTok.
 * Devuelve null si no es de una plataforma admitida. Los enlaces cortos de TikTok salen con clave null y corto: true.
 */
export function parsearUrl(entrada) {
  let u
  try { u = new URL(String(entrada ?? "").trim()) } catch { return null }
  if (!/^https?:$/.test(u.protocol)) return null
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "")
  const partes = u.pathname.split("/").filter(Boolean)

  if (host === "instagram.com" || host === "instagr.am") {
    const i = partes.findIndex((p, k) => k < 2 && ["reel", "reels", "p", "tv"].includes(p))
    const clave = i >= 0 ? partes[i + 1] : null
    if (!clave || !/^[\w-]+$/.test(clave)) return null
    return { plataforma: "instagram", clave, urlCanonica: `https://www.instagram.com/${partes[i] === "reels" ? "reel" : partes[i]}/${clave}/` }
  }

  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const i = partes.indexOf("video")
    const id = i >= 0 ? partes[i + 1] : null
    if (id && /^\d+$/.test(id)) return { plataforma: "tiktok", clave: id, urlCanonica: `https://www.tiktok.com${u.pathname}` }
    if (partes.length > 0 && (host !== "tiktok.com" || partes[0] === "t")) return { plataforma: "tiktok", clave: null, corto: true, urlCanonica: u.origin + u.pathname }
    return null
  }

  if (host === "youtube.com" || host === "music.youtube.com" || host === "youtu.be") {
    let id = null
    if (host === "youtu.be") id = partes[0]
    else if (["shorts", "embed", "live"].includes(partes[0])) id = partes[1]
    else if (partes[0] === "watch") id = u.searchParams.get("v")
    if (!id || !/^[\w-]{11}$/.test(id)) return null
    const corto = partes[0] === "shorts"
    return { plataforma: "youtube", clave: id, urlCanonica: corto ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}` }
  }
  return null
}

async function resolverCorto(info) {
  try {
    const res = await fetch(info.urlCanonica, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15000) })
    res.body?.cancel().catch(() => {})
    const resuelto = parsearUrl(res.url)
    if (resuelto?.clave) return resuelto
  } catch { /* se informa abajo */ }
  throw new Error("No he podido resolver el enlace corto de TikTok. Abre el enlace en el navegador y pega la dirección larga (tiktok.com/@usuario/video/123...), o pégame la transcripción a mano.")
}

// ---------- utilidades ----------

function ejecutar(comando, args, { timeout = 120000, env } = {}) {
  return new Promise((resolve, reject) => {
    execFile(comando, args, { timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: "utf8", env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      if (error) { error.stdout = stdout; error.stderr = stderr; reject(error) } else resolve({ stdout, stderr })
    })
  })
}

function resumirError(error) {
  if (error?.code === "ENOENT") return "no se encuentra el programa necesario"
  if (error?.killed) return "ha tardado demasiado y se ha cortado"
  const lineas = `${error?.stderr || ""}\n${error?.message || ""}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const linea = [...lineas].reverse().find((l) => /^ERROR/i.test(l)) || lineas.at(-1) || String(error)
  return linea.replace(/^ERROR:\s*/i, "").slice(0, 300)
}

function esFfmpegAusente(error) {
  return error?.code === "ENOENT"
}

async function sonda(archivo) {
  let salida
  try {
    salida = await ejecutar(binario("ffprobe"), ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", archivo], { timeout: 30000 })
  } catch (error) {
    if (esFfmpegAusente(error)) throw new Error("No encuentro ffprobe/ffmpeg en este ordenador. Ejecuta el doctor de Drazo Studio para instalarlo.")
    throw new Error(`El archivo no es un vídeo válido (${resumirError(error)})`)
  }
  const datos = JSON.parse(salida.stdout || "{}")
  const duracion = Number(datos.format?.duration)
  const tipos = (datos.streams ?? []).map((s) => s.codec_type)
  if (!Number.isFinite(duracion) || duracion <= 0 || !tipos.includes("video")) throw new Error("El archivo no es un vídeo válido")
  return { duracion, tieneAudio: tipos.includes("audio") }
}

function buscarVideo(carpeta) {
  if (!existsSync(carpeta)) return null
  const nombre = readdirSync(carpeta).find((f) => EXTENSIONES_VIDEO.test(f))
  return nombre ? path.join(carpeta, nombre) : null
}

function limpiarGenerados(carpeta) {
  if (!existsSync(carpeta)) return
  for (const nombre of readdirSync(carpeta)) {
    if (GENERADOS.some((r) => r.test(nombre))) rmSync(path.join(carpeta, nombre), { force: true })
  }
}

// ---------- descarga ----------

/** Carga playwright-core desde NODE_HERRAMIENTAS (o CONTENT_OS_PLAYWRIGHT, solo para pruebas). null si no está. */
export function cargarPlaywright() {
  const prueba = process.env.CONTENT_OS_PLAYWRIGHT?.trim()
  const ruta = prueba || path.join(NODE_HERRAMIENTAS, "node_modules", "playwright-core")
  if (!existsSync(ruta)) return null
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(NAVEGADORES)) process.env.PLAYWRIGHT_BROWSERS_PATH = NAVEGADORES
  try {
    const modulo = createRequire(import.meta.url)(ruta)
    return modulo?.chromium ? modulo : null
  } catch {
    return null
  }
}

function buscarHeadlessShell() {
  const porDefecto = esWindows
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "ms-playwright")
    : process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Caches", "ms-playwright")
      : path.join(os.homedir(), ".cache", "ms-playwright")
  const bases = [process.env.PLAYWRIGHT_BROWSERS_PATH, NAVEGADORES, porDefecto].filter((b) => b && existsSync(b))
  for (const base of bases) {
    const revisiones = readdirSync(base)
      .map((d) => d.match(/^chromium_headless_shell-(\d+)$/))
      .filter(Boolean)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
    for (const [nombre] of revisiones) {
      for (const sub of readdirSync(path.join(base, nombre))) {
        if (!sub.startsWith("chrome-headless-shell")) continue
        const exe = path.join(base, nombre, sub, esWindows ? "chrome-headless-shell.exe" : "chrome-headless-shell")
        if (existsSync(exe)) return exe
      }
    }
  }
  return null
}

async function lanzarNavegador(chromium) {
  try {
    return await chromium.launch({ headless: true })
  } catch (primero) {
    const ejecutable = buscarHeadlessShell()
    if (!ejecutable) throw primero
    return await chromium.launch({ headless: true, executablePath: ejecutable })
  }
}

async function descargarArchivo(url, destino) {
  const parcial = `${destino}.part`
  try {
    const res = await fetch(url, { headers: { Referer: "https://www.instagram.com/", "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(120000) })
    if (!res.ok || !res.body) throw new Error(`respuesta HTTP ${res.status}`)
    if (Number(res.headers.get("content-length") || 0) > MAX_BYTES) throw new Error("el vídeo pesa demasiado")
    let bytes = 0
    const limitar = new Transform({
      transform(trozo, _codificacion, listo) {
        bytes += trozo.length
        listo(bytes > MAX_BYTES ? new Error("el vídeo pesa demasiado") : null, trozo)
      },
    })
    await pipeline(Readable.fromWeb(res.body), limitar, createWriteStream(parcial))
    renameSync(parcial, destino)
    return destino
  } catch (error) {
    rmSync(parcial, { force: true })
    throw error
  }
}

/** Instagram por el embed público. Si no hay vídeo (música con licencia), devuelve archivo: null conservando autor y caption. */
async function bajarEmbed({ clave, carpeta }) {
  const playwright = cargarPlaywright()
  if (!playwright) return { archivo: null, motivo: "playwright-core no está instalado", sinPlaywright: true }
  let navegador
  try {
    navegador = await lanzarNavegador(playwright.chromium)
  } catch (error) {
    return { archivo: null, motivo: `no se ha podido abrir el navegador (${resumirError(error)})`, sinPlaywright: true }
  }
  let datos
  try {
    const pagina = await navegador.newPage({ viewport: { width: 600, height: 900 } })
    await pagina.goto(`https://www.instagram.com/p/${clave}/embed/captioned/`, { waitUntil: "domcontentloaded", timeout: 30000 })
    await pagina.waitForFunction(() => document.querySelector("video")?.currentSrc, null, { timeout: 12000 }).catch(() => {})
    datos = await pagina.evaluate(() => {
      const autor = document.querySelector(".UsernameText")?.textContent?.trim() || null
      const elemento = document.querySelector(".Caption")
      let caption = null
      if (elemento) {
        caption = elemento.innerText || ""
        const usuario = elemento.querySelector(".CaptionUsername")?.innerText?.trim()
        const comentarios = elemento.querySelector(".CaptionComments")?.innerText?.trim()
        if (usuario && caption.trimStart().startsWith(usuario)) caption = caption.trimStart().slice(usuario.length)
        if (comentarios && caption.trimEnd().endsWith(comentarios)) caption = caption.trimEnd().slice(0, -comentarios.length)
        caption = caption.trim()
      }
      return { video: document.querySelector("video")?.currentSrc || null, autor, caption }
    })
  } catch (error) {
    return { archivo: null, motivo: `el embed no ha cargado (${resumirError(error)})` }
  } finally {
    await navegador.close().catch(() => {})
  }
  if (!datos.video || !/^https?:/.test(datos.video)) {
    return { archivo: null, autor: datos.autor, caption: datos.caption, motivo: "el embed no trae vídeo (suele pasar con música con licencia)" }
  }
  try {
    const archivo = await descargarArchivo(datos.video, path.join(carpeta, "video.mp4"))
    return { archivo, autor: datos.autor, caption: datos.caption }
  } catch (error) {
    return { archivo: null, autor: datos.autor, caption: datos.caption, motivo: `no se ha podido bajar el mp4 (${resumirError(error)})` }
  }
}

function elegirAutor(info) {
  const candidatos = [info.uploader_id, info.channel, info.uploader].map((c) => String(c ?? "").replace(/^@/, "").trim())
  return candidatos.find((c) => c && !/^\d+$/.test(c)) || null
}

async function bajarYtDlp({ urlCanonica, carpeta, python }) {
  const args = [
    "-m", "yt_dlp", "--ignore-config", "--no-playlist", "--no-warnings", "--no-progress", "--no-cache-dir",
    "--retries", "1", "--fragment-retries", "1", "--extractor-retries", "1", "--socket-timeout", "20",
    "--max-filesize", "200M", "--match-filter", `duration<=?${MAX_DURACION_DESCARGA_S}`,
    "-f", "b[ext=mp4]/b", "--write-info-json", "--force-overwrites",
    "-o", path.join(carpeta, "video.%(ext)s"), "--", urlCanonica,
  ]
  let salida
  try {
    salida = await ejecutar(python, args, { timeout: 180000, env: { PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } })
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("no encuentro Python con yt-dlp (el instalador de Drazo Studio lo deja en su carpeta)")
    if (/No module named yt_dlp/i.test(error?.stderr || "")) throw new Error("yt-dlp no está instalado en el Python de Drazo Studio")
    throw new Error(resumirError(error))
  }
  const archivo = buscarVideo(carpeta)
  if (!archivo) {
    if (/does not pass filter/i.test(salida.stdout)) throw new Error(`el vídeo dura más de ${MAX_DURACION_DESCARGA_S / 60} minutos y no se descarga`)
    throw new Error("no ha bajado ningún vídeo (puede ser privado, borrado o un carrusel de fotos)")
  }
  let autor = null
  let caption = null
  try {
    const info = JSON.parse(readFileSync(path.join(carpeta, "video.info.json"), "utf8"))
    autor = elegirAutor(info)
    caption = info.description || info.title || null
  } catch { /* sin ficha: no pasa nada */ }
  return { archivo, autor, caption }
}

async function obtenerVideo(contexto) {
  const { info, opciones, avisos } = contexto
  const motivos = []
  let embed = { archivo: null }

  if (info.plataforma === "instagram") {
    try {
      embed = await (opciones.bajarEmbed ?? bajarEmbed)(contexto)
    } catch (error) {
      embed = { archivo: null, motivo: resumirError(error) }
    }
    if (embed.archivo) {
      try {
        await sonda(embed.archivo)
        return { archivo: embed.archivo, via: "embed", autor: embed.autor ?? null, caption: embed.caption ?? null }
      } catch (error) {
        embed = { ...embed, archivo: null, motivo: error.message }
      }
    }
    motivos.push(`embed de Instagram: ${embed.motivo ?? "sin vídeo"}`)
    if (embed.sinPlaywright) avisos.push("No he podido usar el navegador de Drazo Studio para el embed de Instagram, así que he bajado el vídeo con yt-dlp. Si se repite, ejecuta el doctor de Drazo Studio.")
    else if (embed.motivo) avisos.push(`El embed de Instagram no me ha dado el vídeo: ${embed.motivo}. Lo he bajado con yt-dlp.`)
  }

  try {
    const salida = await (opciones.bajarYtDlp ?? bajarYtDlp)(contexto)
    if (!salida?.archivo) throw new Error("no ha bajado ningún vídeo")
    await sonda(salida.archivo)
    return { archivo: salida.archivo, via: "yt-dlp", autor: embed.autor ?? salida.autor ?? null, caption: embed.caption ?? salida.caption ?? null }
  } catch (error) {
    motivos.push(`yt-dlp: ${error.message}`)
  }

  throw new Error(`No he podido bajar el reel ${info.urlCanonica}. Lo que ha fallado: ${motivos.join("; ")}. ${AYUDA_MANUAL}`)
}

// ---------- ffmpeg ----------

async function ffmpeg(args) {
  try {
    await ejecutar(binario("ffmpeg"), ["-y", "-v", "error", ...args], { timeout: 180000 })
  } catch (error) {
    if (esFfmpegAusente(error)) throw new Error("No encuentro ffmpeg en este ordenador. Ejecuta el doctor de Drazo Studio para instalarlo.")
    throw new Error(`ffmpeg ha fallado (${resumirError(error)})`)
  }
}

async function extraerAudio(video, carpeta) {
  const wav = path.join(carpeta, "audio.wav")
  await ffmpeg(["-i", video, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav])
  return wav
}

/** arranque.jpg = primeros 5 s a 1 fps en 5x1; hoja-N.jpg = el resto, hasta 30 fotogramas por hoja en 6 columnas (2 hojas si pasa de 60 s). */
async function crearImagenes(video, carpeta, duracion) {
  const arranque = path.join(carpeta, "arranque.jpg")
  const arranqueHecho = ffmpeg(["-t", String(SEGUNDOS_ARRANQUE), "-i", video, "-vf", `fps=1,scale=${ANCHO_FOTOGRAMA}:-1,tile=5x1`, "-frames:v", "1", "-q:v", "3", arranque])

  const inicio = duracion > SEGUNDOS_ARRANQUE + 0.5 ? SEGUNDOS_ARRANQUE : 0
  const nHojas = duracion > 60 ? 2 : 1
  const tramo = (duracion - inicio) / nHojas
  const fotogramas = Math.min(FOTOGRAMAS_POR_HOJA, Math.max(1, Math.ceil(tramo)))
  const columnas = Math.min(COLUMNAS_HOJA, fotogramas)
  const filas = Math.ceil(fotogramas / columnas)
  const hojas = Array.from({ length: nHojas }, (_, i) => path.join(carpeta, `hoja-${i + 1}.jpg`))
  await Promise.all(hojas.map((hoja, i) => ffmpeg([
    "-ss", (inicio + i * tramo).toFixed(3), "-t", tramo.toFixed(3), "-i", video,
    "-vf", `fps=${(fotogramas / tramo).toFixed(6)},scale=${ANCHO_FOTOGRAMA}:-1,tile=${columnas}x${filas}`,
    "-frames:v", "1", "-q:v", "4", hoja,
  ])))
  await arranqueHecho
  return { arranque, hojas }
}

// ---------- transcripción y avisos ----------

async function transcribirLocal(wav, { idioma, modelo, python }) {
  const script = fileURLToPath(new URL("./transcribir.py", import.meta.url))
  const { stdout } = await ejecutar(python, [script, wav, "--modelo", modelo, "--idioma", idioma], {
    timeout: 20 * 60 * 1000,
    env: { PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", HF_HUB_DISABLE_PROGRESS_BARS: "1" },
  })
  const linea = stdout.split(/\r?\n/).reverse().find((l) => l.trim().startsWith("{"))
  if (!linea) throw new Error("el transcriptor no ha devuelto resultado")
  return JSON.parse(linea)
}

const normalizar = (texto) => String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()

const FRASES_INVENTADAS = [
  /thank(s| you)( so much)? for (watching|listening)/,
  /gracias por (ver|vernos|mirar|escucharnos?)/,
  /amara\.?org/,
  /subtitulos? (realizados?|creados?|hechos?|por|de) /,
  /subtitled by|subtitles by/,
  /^\s*[\[(]?(musica|music|aplausos|applause)[\])]?\s*$/,
]

/** Avisos en español sobre una transcripción sospechosa o un vídeo fuera de lo normal. */
export function generarAvisos({ transcripcion, segmentos = [], duracion }) {
  const avisos = []
  const palabras = String(transcripcion ?? "").trim().split(/\s+/).filter(Boolean).length
  const segundos = Math.round(duracion)

  if (palabras === 0) {
    avisos.push("No se ha oído voz en el vídeo (transcripción vacía): puede ser solo música o sonido ambiente. Para saber de qué va, mira los fotogramas o pega la transcripción a mano.")
  } else if (duracion >= 10 && palabras < duracion * 0.3) {
    avisos.push(`La transcripción es muy corta para lo que dura el vídeo (${palabras} ${palabras === 1 ? "palabra" : "palabras"} en ${segundos} s): puede haber mucha música o pausas largas, o que no se haya captado todo.`)
  }

  const textos = segmentos.length ? segmentos.map((s) => s.texto) : [transcripcion]
  const inventada = textos.find((t) => FRASES_INVENTADAS.some((r) => r.test(normalizar(t))))
  if (inventada || /♪/.test(transcripcion ?? "")) {
    avisos.push(`La transcripción contiene algo que Whisper suele inventarse cuando solo hay música o silencio${inventada ? ` («${String(inventada).trim().slice(0, 80)}»)` : ""}. Revísala antes de fiarte de ella.`)
  }

  const repeticiones = new Map()
  for (const s of segmentos) {
    const clave = normalizar(s.texto)
    if (clave) repeticiones.set(clave, (repeticiones.get(clave) ?? 0) + 1)
  }
  if ([...repeticiones.values()].some((n) => n >= 3)) {
    avisos.push("Hay frases que se repiten tres o más veces seguidas en la transcripción: suele ser un fallo de Whisper con la música, no lo que dice el vídeo.")
  }

  if (duracion > UMBRAL_LARGO_S) {
    avisos.push(`El vídeo dura ${Math.floor(duracion / 60)} min ${segundos % 60} s (más de 3 minutos): no parece un reel. Los fotogramas son solo una muestra de todo el vídeo.`)
  }
  return avisos
}

// ---------- verReel ----------

function resultadoEnCache(carpeta, info) {
  const ruta = path.join(carpeta, "resultado.json")
  if (!existsSync(ruta)) return null
  try {
    const guardado = JSON.parse(readFileSync(ruta, "utf8"))
    const imagenes = [guardado.imagenes?.arranque, ...(guardado.imagenes?.hojas ?? [])]
    if (guardado.ok !== true || guardado.clave !== info.clave || guardado.plataforma !== info.plataforma) return null
    if (!imagenes.every((i) => i && existsSync(i))) return null
    return guardado
  } catch {
    return null
  }
}

/**
 * Baja el reel, lo transcribe y prepara sus fotogramas. Devuelve el resultado (también guardado en REELS/<clave>/resultado.json).
 * opciones: forzar, idioma ("auto" por defecto), modelo, python, progreso(mensaje) y, para pruebas, transcribir(wav, {idioma, modelo}),
 * bajarEmbed(contexto) y bajarYtDlp(contexto).
 */
export async function verReel(url, opciones = {}) {
  let info = parsearUrl(url)
  if (!info) {
    throw new Error("No reconozco ese enlace. Admito reels de Instagram (instagram.com/reel/..., /p/..., /tv/...), vídeos de TikTok y YouTube Shorts. Si es otro tipo de enlace, pégame la transcripción a mano.")
  }
  const progreso = opciones.progreso ?? (() => {})
  if (info.corto) {
    progreso("Resolviendo el enlace corto de TikTok")
    info = await resolverCorto(info)
  }

  const carpeta = path.join(REELS, info.clave)
  mkdirSync(carpeta, { recursive: true })
  const python = opciones.python || PYTHON
  const idioma = opciones.idioma || "auto"
  const modelo = opciones.modelo || MODELO_WHISPER

  if (opciones.forzar) limpiarGenerados(carpeta)
  else {
    const guardado = resultadoEnCache(carpeta, info)
    if (guardado) return guardado
  }

  let video = buscarVideo(carpeta)
  let meta = null
  if (video && existsSync(path.join(carpeta, "meta.json"))) {
    try { meta = JSON.parse(readFileSync(path.join(carpeta, "meta.json"), "utf8")) } catch { meta = null }
  }
  const avisos = []
  if (video && meta) {
    progreso("Reutilizando el vídeo ya descargado")
    avisos.push(...(meta.avisos ?? []))
  } else {
    limpiarGenerados(carpeta)
    progreso("Bajando el vídeo")
    const bajado = await obtenerVideo({ info, url: info.urlCanonica, urlCanonica: info.urlCanonica, plataforma: info.plataforma, clave: info.clave, carpeta, python, opciones, avisos })
    video = bajado.archivo
    meta = { via: bajado.via, autor: bajado.autor, caption: bajado.caption, avisos: [...avisos] }
    writeFileSync(path.join(carpeta, "meta.json"), JSON.stringify(meta, null, 2))
  }

  const { duracion, tieneAudio } = await sonda(video)
  progreso("Sacando los fotogramas y el audio")
  const audioListo = tieneAudio ? extraerAudio(video, carpeta).then((wav) => ({ wav }), (error) => ({ error })) : null
  const imagenes = await crearImagenes(video, carpeta, duracion)
  const audio = await audioListo

  let transcripcion = ""
  let segmentos = []
  let idiomaDetectado = null
  let transcrito = true
  if (tieneAudio) {
    try {
      if (audio.error) throw audio.error
      progreso("Transcribiendo en local (puede tardar un poco)")
      const wav = audio.wav
      const salida = await (opciones.transcribir ?? transcribirLocal)(wav, { idioma, modelo, python })
      transcripcion = String(salida?.texto ?? "").trim()
      // Whisper a veces inventa un último segmento que dura más que el propio vídeo.
      segmentos = (salida?.segmentos ?? []).map((s) => ({ ...s, fin: Math.min(s.fin, Math.round(duracion * 100) / 100) }))
      idiomaDetectado = salida?.idioma ?? null
    } catch (error) {
      transcrito = false
      avisos.push(`No he podido transcribir en local (${resumirError(error)}). Los fotogramas sí están; si quieres, pégame la transcripción a mano.`)
    }
  } else {
    avisos.push("El vídeo no tiene pista de audio, así que no hay transcripción. Mira los fotogramas.")
  }
  if (transcrito) avisos.push(...generarAvisos({ transcripcion, segmentos, duracion }))

  const resultado = {
    ok: true,
    url: String(url).trim(),
    plataforma: info.plataforma,
    clave: info.clave,
    autor: meta.autor ?? null,
    caption: meta.caption ?? "",
    duracion_s: Math.round(duracion * 10) / 10,
    transcripcion,
    segmentos,
    idioma: idiomaDetectado,
    imagenes,
    carpeta,
    via: meta.via,
    avisos,
  }
  // Una transcripción que ha fallado no se guarda: la siguiente llamada la reintenta sin volver a bajar el vídeo.
  if (transcrito) writeFileSync(path.join(carpeta, "resultado.json"), JSON.stringify(resultado, null, 2))
  return resultado
}

// ---------- CLI ----------

function esEjecucionDirecta() {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false }
}

if (esEjecucionDirecta()) {
  const argumentos = process.argv.slice(2)
  const forzar = argumentos.includes("--forzar")
  const indiceIdioma = argumentos.indexOf("--idioma")
  const idioma = indiceIdioma >= 0 ? argumentos[indiceIdioma + 1] : undefined
  const url = argumentos.find((a, i) => !a.startsWith("--") && (indiceIdioma < 0 || i !== indiceIdioma + 1))
  if (!url) {
    console.error("Uso: node reel-local.mjs <url> [--forzar] [--idioma es]")
    process.exit(2)
  }
  try {
    const resultado = await verReel(url, { forzar, idioma, progreso: (m) => console.error(`- ${m}`) })
    console.log(JSON.stringify(resultado, null, 2))
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
