// Pruebas de reel-local.mjs. Las automáticas no usan red ni el modelo de Whisper: el vídeo es sintético (ffmpeg) y el
// transcriptor se inyecta. Si no hay ffmpeg en el PATH, las que lo necesitan se saltan.
//
// Prueba manual de punta a punta (2-3 peticiones anónimas; transcribe de verdad si el modelo ya está en la caché de HF,
// nunca descarga el modelo salvo que se pase CONTENT_OS_PRUEBA_MODELO=1):
//   CONTENT_OS_PRUEBA_RED=https://www.instagram.com/reel/<codigo>/ CONTENT_OS_PYTHON=<python con faster-whisper y yt-dlp> \
//   CONTENT_OS_PLAYWRIGHT=<ruta a un módulo playwright> node --test plugin/tests/reel-local.test.mjs

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const URL_RED = process.env.CONTENT_OS_PRUEBA_RED
const PLAYWRIGHT_REAL = process.env.CONTENT_OS_PLAYWRIGHT
const DATOS_TEMPORALES = fs.mkdtempSync(path.join(os.tmpdir(), "drazo-studio-reel-"))
process.env.CONTENT_OS_DATOS = DATOS_TEMPORALES
delete process.env.CONTENT_OS_PLAYWRIGHT
test.after(() => fs.rmSync(DATOS_TEMPORALES, { recursive: true, force: true }))

const { REELS } = await import("../plugins/drazo-studio/scripts/rutas.mjs")
const { verReel, parsearUrl, generarAvisos, cargarPlaywright } = await import("../plugins/drazo-studio/scripts/reel-local.mjs")

const carpetaScripts = fileURLToPath(new URL("../plugins/drazo-studio/scripts/", import.meta.url))
const ffmpegDisponible = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0
const sinFfmpeg = ffmpegDisponible ? false : "ffmpeg no está en el PATH"
const PYTHON_PRUEBA = process.env.CONTENT_OS_PYTHON?.trim() || "python"
const sinPython = spawnSync(PYTHON_PRUEBA, ["-c", "import numpy"]).status === 0 ? false : "no hay Python con numpy"

const fixtures = new Map()
/** Vídeo sintético vertical; se genera una vez por combinación y se copia donde haga falta. */
function fixture({ segundos = 12, audio = true } = {}) {
  const clave = `${segundos}-${audio}`
  if (!fixtures.has(clave)) {
    const archivo = path.join(DATOS_TEMPORALES, `fixture-${clave}.mp4`)
    const args = ["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc=size=270x480:rate=5:duration=${segundos}`]
    if (audio) args.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${segundos}`, "-c:a", "aac")
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", archivo)
    const r = spawnSync("ffmpeg", args, { encoding: "utf8" })
    assert.equal(r.status, 0, r.stderr)
    fixtures.set(clave, archivo)
  }
  return fixtures.get(clave)
}

function ffprobe(argumentos) {
  const r = spawnSync("ffprobe", ["-v", "error", ...argumentos], { encoding: "utf8" })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim()
}

function dimensiones(imagen) {
  const [ancho, alto] = ffprobe(["-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", imagen]).split(",").map(Number)
  return { ancho, alto }
}

/** Deja un vídeo sintético ya "bajado" en REELS/<clave>/ para que el flujo lo reutilice sin red. */
function prepararBajado(clave, opcionesVideo, meta = {}) {
  const carpeta = path.join(REELS, clave)
  fs.mkdirSync(carpeta, { recursive: true })
  fs.copyFileSync(fixture(opcionesVideo), path.join(carpeta, "video.mp4"))
  fs.writeFileSync(path.join(carpeta, "meta.json"), JSON.stringify({ via: "embed", autor: "cuenta_prueba", caption: "pie de prueba", avisos: [], ...meta }))
  return carpeta
}

const TEXTO_NORMAL = "hola esto es una prueba de transcripción con bastantes palabras para que no sea corta"

function transcriptor(texto = TEXTO_NORMAL) {
  const llamadas = []
  const funcion = async (wav, opciones) => {
    llamadas.push({ wav, opciones })
    return { texto, idioma: "es", segmentos: texto ? [{ inicio: 0, fin: 3, texto }] : [] }
  }
  funcion.llamadas = llamadas
  return funcion
}

/** Descargador falso: copia el vídeo sintético donde el flujo lo espera y cuenta las llamadas. */
function descargadorFalso(nombre, { video = fixture(), fallo, extra = {} } = {}) {
  const funcion = async ({ carpeta }) => {
    funcion.llamadas++
    if (fallo) throw new Error(fallo)
    const archivo = path.join(carpeta, "video.mp4")
    fs.copyFileSync(video, archivo)
    return { archivo, ...extra }
  }
  funcion.llamadas = 0
  funcion.nombre = nombre
  return funcion
}

// ---------- URL y clave ----------

test("clave de Instagram: reel, reels, p, tv y enlaces con usuario y parámetros", () => {
  for (const [url, clave] of [
    ["https://www.instagram.com/reel/DewISZ8TV80/", "DewISZ8TV80"],
    ["https://instagram.com/reel/DewISZ8TV80/?igsh=abc&utm_source=qr", "DewISZ8TV80"],
    ["https://www.instagram.com/reels/DeZB7rpJfGZ/", "DeZB7rpJfGZ"],
    ["https://www.instagram.com/p/DfALvrURxFL", "DfALvrURxFL"],
    ["https://www.instagram.com/tv/Ab-_1234567/", "Ab-_1234567"],
    ["https://www.instagram.com/davidmadrazo.ia/reel/DeRhJKwJCG3/", "DeRhJKwJCG3"],
    ["  https://m.instagram.com/reel/DewISZ8TV80  ", "DewISZ8TV80"],
  ]) {
    const info = parsearUrl(url)
    assert.equal(info?.plataforma, "instagram", url)
    assert.equal(info.clave, clave, url)
  }
  assert.equal(parsearUrl("https://www.instagram.com/reels/DeZB7rpJfGZ/").urlCanonica, "https://www.instagram.com/reel/DeZB7rpJfGZ/")
})

test("clave de TikTok y de YouTube", () => {
  const tiktok = parsearUrl("https://www.tiktok.com/@alguien/video/7234567890123456789?is_from_webapp=1")
  assert.equal(tiktok.plataforma, "tiktok")
  assert.equal(tiktok.clave, "7234567890123456789")

  for (const url of ["https://vm.tiktok.com/ZMabc123/", "https://www.tiktok.com/t/ZTabc123/"]) {
    const corto = parsearUrl(url)
    assert.equal(corto.plataforma, "tiktok", url)
    assert.equal(corto.clave, null, url)
    assert.equal(corto.corto, true, url)
  }

  for (const url of [
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?si=xyz",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3s",
    "https://m.youtube.com/shorts/dQw4w9WgXcQ",
  ]) {
    const info = parsearUrl(url)
    assert.equal(info?.plataforma, "youtube", url)
    assert.equal(info.clave, "dQw4w9WgXcQ", url)
  }
})

test("enlaces no admitidos o con clave peligrosa devuelven null, y verReel avisa en español", async () => {
  for (const url of [
    "https://example.com/video/123",
    "https://www.instagram.com/davidmadrazo.ia/",
    "https://www.instagram.com/reels/",
    "https://www.instagram.com/reel/abc%2F..%2Fx/",
    "https://www.instagram.com/reel/../../etc/",
    "https://www.youtube.com/watch?v=corto",
    "https://www.tiktok.com/@alguien",
    "javascript:alert(1)",
    "no es una url",
    "",
    null,
  ]) {
    assert.equal(parsearUrl(url), null, String(url))
  }
  await assert.rejects(() => verReel("https://example.com/algo"), /No reconozco ese enlace/)
})

// ---------- avisos ----------

test("avisos: vacía, muy corta, frases inventadas, repeticiones y vídeo largo", () => {
  assert.deepEqual(generarAvisos({ transcripcion: "hola que tal como estas todo bien hoy", segmentos: [], duracion: 8 }), [])

  const vacia = generarAvisos({ transcripcion: "", segmentos: [], duracion: 20 })
  assert.equal(vacia.length, 1)
  assert.match(vacia[0], /vacía/)
  assert.match(vacia[0], /solo música/)

  assert.match(generarAvisos({ transcripcion: "solo cuatro palabras sueltas", segmentos: [], duracion: 40 }).join(" "), /muy corta/)

  for (const frase of ["Thank you for watching!", "Subtítulos realizados por la comunidad de Amara.org", "Gracias por ver el vídeo", "[Música]"]) {
    const avisos = generarAvisos({ transcripcion: frase, segmentos: [{ inicio: 0, fin: 2, texto: frase }], duracion: 3 })
    assert.match(avisos.join(" "), /Whisper suele inventarse/, frase)
  }

  const repetidas = generarAvisos({
    transcripcion: "a ver a ver a ver",
    segmentos: [1, 2, 3].map((n) => ({ inicio: n, fin: n + 1, texto: "A ver." })),
    duracion: 5,
  })
  assert.match(repetidas.join(" "), /se repiten/)

  const larga = generarAvisos({ transcripcion: "palabra ".repeat(600), segmentos: [], duracion: 200 })
  assert.match(larga.join(" "), /3 min 20 s \(más de 3 minutos\)/)
})

test("sin playwright-core instalado, cargarPlaywright devuelve null", () => {
  assert.equal(cargarPlaywright(), null)
})

// ---------- flujo con vídeo sintético ----------

test("vídeo de 12 s: WAV, arranque, hoja y resultado.json", { skip: sinFfmpeg }, async () => {
  const carpeta = prepararBajado("PruebaSinte1")
  const transcribir = transcriptor()
  const progreso = []
  const r = await verReel("https://www.instagram.com/reel/PruebaSinte1/?igsh=zzz", { transcribir, progreso: (m) => progreso.push(m) })

  assert.equal(r.ok, true)
  assert.equal(r.url, "https://www.instagram.com/reel/PruebaSinte1/?igsh=zzz")
  assert.equal(r.plataforma, "instagram")
  assert.equal(r.clave, "PruebaSinte1")
  assert.equal(r.via, "embed")
  assert.equal(r.autor, "cuenta_prueba")
  assert.equal(r.caption, "pie de prueba")
  assert.ok(Math.abs(r.duracion_s - 12) < 0.6, `duración ${r.duracion_s}`)
  assert.equal(r.idioma, "es")
  assert.equal(r.transcripcion, TEXTO_NORMAL)
  assert.equal(r.segmentos.length, 1)
  assert.equal(r.segmentos[0].fin, 3)
  assert.equal(r.carpeta, carpeta)
  assert.deepEqual(r.avisos, [])
  assert.ok(progreso.length >= 3)

  // El transcriptor recibe el WAV de 16 kHz mono y el idioma por defecto.
  assert.equal(transcribir.llamadas.length, 1)
  assert.equal(transcribir.llamadas[0].wav, path.join(carpeta, "audio.wav"))
  assert.equal(transcribir.llamadas[0].opciones.idioma, "auto")
  assert.equal(ffprobe(["-select_streams", "a:0", "-show_entries", "stream=codec_name,sample_rate,channels", "-of", "csv=p=0", path.join(carpeta, "audio.wav")]), "pcm_s16le,16000,1")

  // arranque: 5 fotogramas de 270 de ancho en una fila.
  assert.equal(r.imagenes.arranque, path.join(carpeta, "arranque.jpg"))
  assert.deepEqual(dimensiones(r.imagenes.arranque), { ancho: 5 * 270, alto: 480 })

  // Quedan 7 s tras el arranque: 7 fotogramas, en filas de 6.
  assert.deepEqual(r.imagenes.hojas, [path.join(carpeta, "hoja-1.jpg")])
  assert.deepEqual(dimensiones(r.imagenes.hojas[0]), { ancho: 6 * 270, alto: 2 * 480 })
  assert.ok(!fs.existsSync(path.join(carpeta, "hoja-2.jpg")))

  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(carpeta, "resultado.json"), "utf8")), JSON.parse(JSON.stringify(r)))
})

test("vídeo de más de 60 s: dos hojas de 30 fotogramas en 6x5", { skip: sinFfmpeg }, async () => {
  const carpeta = prepararBajado("PruebaLarga1", { segundos: 75 })
  const r = await verReel("https://www.instagram.com/reel/PruebaLarga1/", { transcribir: transcriptor("palabra ".repeat(300).trim()) })
  assert.ok(Math.abs(r.duracion_s - 75) < 0.6, `duración ${r.duracion_s}`)
  assert.deepEqual(r.imagenes.hojas, [path.join(carpeta, "hoja-1.jpg"), path.join(carpeta, "hoja-2.jpg")])
  for (const hoja of r.imagenes.hojas) assert.deepEqual(dimensiones(hoja), { ancho: 6 * 270, alto: 5 * 480 })
  assert.deepEqual(r.avisos.filter((a) => /3 minutos/.test(a)), [])
})

test("vídeo de 3 s: arranque con lo que hay y una hoja con todo el vídeo", { skip: sinFfmpeg }, async () => {
  prepararBajado("PruebaCorta1", { segundos: 3 })
  const r = await verReel("https://www.instagram.com/reel/PruebaCorta1/", { transcribir: transcriptor("una frase corta") })
  assert.ok(fs.statSync(r.imagenes.arranque).size > 0)
  assert.equal(r.imagenes.hojas.length, 1)
  assert.deepEqual(dimensiones(r.imagenes.hojas[0]), { ancho: 3 * 270, alto: 480 })
})

test("la caché de resultado.json se reutiliza, se invalida si faltan imágenes y forzar la rehace", { skip: sinFfmpeg }, async () => {
  prepararBajado("PruebaCache1")
  const transcribir = transcriptor()
  const url = "https://www.instagram.com/reel/PruebaCache1/"

  const primero = await verReel(url, { transcribir })
  const segundo = await verReel(url, { transcribir })
  assert.equal(transcribir.llamadas.length, 1, "la segunda llamada sale de la caché")
  assert.deepEqual(segundo, primero)

  fs.rmSync(primero.imagenes.arranque)
  await verReel(url, { transcribir })
  assert.equal(transcribir.llamadas.length, 2, "sin las imágenes la caché no vale")
  assert.ok(fs.existsSync(primero.imagenes.arranque))

  // forzar borra lo generado en esa carpeta (vídeo incluido) y vuelve a bajarlo.
  const embed = descargadorFalso("embed", { extra: { autor: "otra_cuenta", caption: "otro pie" } })
  const forzado = await verReel(url, { transcribir, forzar: true, bajarEmbed: embed })
  assert.equal(embed.llamadas, 1)
  assert.equal(transcribir.llamadas.length, 3)
  assert.equal(forzado.autor, "otra_cuenta")
  assert.equal(forzado.via, "embed")
})

test("forzar solo toca la carpeta del reel", { skip: sinFfmpeg }, async () => {
  const vecina = prepararBajado("PruebaVecina1")
  const marca = path.join(vecina, "notas-del-miembro.txt")
  fs.writeFileSync(marca, "no se toca")
  prepararBajado("PruebaForzar1")
  fs.writeFileSync(path.join(REELS, "PruebaForzar1", "notas-del-miembro.txt"), "tampoco se toca")
  await verReel("https://www.instagram.com/reel/PruebaForzar1/", { transcribir: transcriptor(), forzar: true, bajarEmbed: descargadorFalso("embed") })
  assert.ok(fs.existsSync(path.join(vecina, "video.mp4")))
  assert.equal(fs.readFileSync(marca, "utf8"), "no se toca")
  assert.equal(fs.readFileSync(path.join(REELS, "PruebaForzar1", "notas-del-miembro.txt"), "utf8"), "tampoco se toca")
})

// ---------- transcripción y casos de audio ----------

test("los segmentos que acaban después del vídeo se recortan a su duración", { skip: sinFfmpeg }, async () => {
  prepararBajado("PruebaRecorte1", { segundos: 3 })
  const largo = async () => ({ texto: "una frase y Gracias por ver el video.", idioma: "es", segmentos: [{ inicio: 0, fin: 2, texto: "una frase" }, { inicio: 2.9, fin: 59.98, texto: "Gracias por ver el video." }] })
  const r = await verReel("https://www.instagram.com/reel/PruebaRecorte1/", { transcribir: largo })
  assert.ok(r.segmentos.every((s) => s.fin <= r.duracion_s + 0.05), JSON.stringify(r.segmentos))
  assert.match(r.avisos.join(" "), /Whisper suele inventarse/)
})

test("transcripción vacía y vídeo sin audio dan avisos en español", { skip: sinFfmpeg }, async () => {
  prepararBajado("PruebaVacia1")
  const vacia = await verReel("https://www.instagram.com/reel/PruebaVacia1/", { transcribir: transcriptor("") })
  assert.equal(vacia.transcripcion, "")
  assert.equal(vacia.ok, true)
  assert.match(vacia.avisos.join(" "), /No se ha oído voz/)

  prepararBajado("PruebaMudo1", { audio: false })
  const transcribir = transcriptor()
  const muda = await verReel("https://www.instagram.com/reel/PruebaMudo1/", { transcribir })
  assert.equal(transcribir.llamadas.length, 0)
  assert.equal(muda.transcripcion, "")
  assert.match(muda.avisos.join(" "), /no tiene pista de audio/)
  assert.ok(fs.existsSync(muda.imagenes.arranque))
})

test("si falla el transcriptor, hay fotogramas y aviso, no se cachea y el reintento no vuelve a bajar", { skip: sinFfmpeg }, async () => {
  prepararBajado("PruebaFallaT1")
  const url = "https://www.instagram.com/reel/PruebaFallaT1/"
  const roto = async () => { throw new Error("falta faster-whisper") }
  const r = await verReel(url, { transcribir: roto })
  assert.equal(r.ok, true)
  assert.equal(r.transcripcion, "")
  assert.match(r.avisos.join(" "), /No he podido transcribir en local \(falta faster-whisper\)/)
  assert.ok(fs.existsSync(r.imagenes.arranque))
  assert.ok(!fs.existsSync(path.join(r.carpeta, "resultado.json")))

  const embed = descargadorFalso("embed")
  const ytdlp = descargadorFalso("yt-dlp")
  const bueno = await verReel(url, { transcribir: transcriptor(), bajarEmbed: embed, bajarYtDlp: ytdlp })
  assert.equal(embed.llamadas + ytdlp.llamadas, 0, "el vídeo ya estaba descargado")
  assert.equal(bueno.transcripcion, TEXTO_NORMAL)
  assert.ok(fs.existsSync(path.join(bueno.carpeta, "resultado.json")))
})

// ---------- orden de descarga ----------

test("Instagram: si el embed trae el vídeo no se llama a yt-dlp", { skip: sinFfmpeg }, async () => {
  const embed = descargadorFalso("embed", { extra: { autor: "autora", caption: "Pie con\nsaltos" } })
  const ytdlp = descargadorFalso("yt-dlp")
  const r = await verReel("https://www.instagram.com/reel/PruebaEmbed1/", { transcribir: transcriptor(), bajarEmbed: embed, bajarYtDlp: ytdlp })
  assert.equal(r.via, "embed")
  assert.equal(r.autor, "autora")
  assert.equal(r.caption, "Pie con\nsaltos")
  assert.equal(embed.llamadas, 1)
  assert.equal(ytdlp.llamadas, 0)
})

test("Instagram: embed sin vídeo pasa a yt-dlp y conserva autor y caption del embed", { skip: sinFfmpeg }, async () => {
  const embed = async () => ({ archivo: null, autor: "andrea", caption: "Con música con licencia", motivo: "el embed no trae vídeo (suele pasar con música con licencia)" })
  const ytdlp = descargadorFalso("yt-dlp", { extra: { autor: "otro", caption: "otro" } })
  const r = await verReel("https://www.instagram.com/reel/PruebaYtdlp1/", { transcribir: transcriptor(), bajarEmbed: embed, bajarYtDlp: ytdlp })
  assert.equal(r.via, "yt-dlp")
  assert.equal(r.autor, "andrea")
  assert.equal(r.caption, "Con música con licencia")
  assert.equal(ytdlp.llamadas, 1)
  assert.match(r.avisos.join(" "), /embed de Instagram no me ha dado el vídeo/)
})

test("Instagram: un archivo del embed que no es vídeo pasa a yt-dlp", { skip: sinFfmpeg }, async () => {
  const embed = async ({ carpeta }) => {
    const archivo = path.join(carpeta, "video.mp4")
    fs.writeFileSync(archivo, "esto no es un mp4")
    return { archivo, autor: "autora", caption: "pie" }
  }
  const ytdlp = descargadorFalso("yt-dlp")
  const r = await verReel("https://www.instagram.com/reel/PruebaBasura1/", { transcribir: transcriptor(), bajarEmbed: embed, bajarYtDlp: ytdlp })
  assert.equal(r.via, "yt-dlp")
  assert.equal(r.autor, "autora")
})

test("sin playwright-core el embed se salta con aviso y se usa yt-dlp", { skip: sinFfmpeg }, async () => {
  const ytdlp = descargadorFalso("yt-dlp", { extra: { autor: "cuenta", caption: "pie" } })
  const r = await verReel("https://www.instagram.com/reel/PruebaSinPw1/", { transcribir: transcriptor(), bajarYtDlp: ytdlp })
  assert.equal(r.via, "yt-dlp")
  assert.equal(ytdlp.llamadas, 1)
  assert.match(r.avisos.join(" "), /No he podido usar el navegador de Drazo Studio/)
})

test("TikTok y YouTube van directos a yt-dlp, sin tocar el embed", { skip: sinFfmpeg }, async () => {
  const embed = descargadorFalso("embed")
  for (const [url, clave] of [
    ["https://www.tiktok.com/@alguien/video/7234567890123456789", "7234567890123456789"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ]) {
    const ytdlp = descargadorFalso("yt-dlp", { extra: { autor: "canal", caption: "descripción" } })
    const r = await verReel(url, { transcribir: transcriptor(), bajarEmbed: embed, bajarYtDlp: ytdlp })
    assert.equal(r.via, "yt-dlp")
    assert.equal(r.clave, clave)
    assert.equal(r.carpeta, path.join(REELS, clave))
    assert.equal(ytdlp.llamadas, 1)
  }
  assert.equal(embed.llamadas, 0)
})

test("si no se puede bajar, el error es claro, en español y deja la salida manual", { skip: sinFfmpeg }, async () => {
  const embed = async () => ({ archivo: null, motivo: "el embed no trae vídeo" })
  const ytdlp = descargadorFalso("yt-dlp", { fallo: "Login required" })
  await assert.rejects(
    () => verReel("https://www.instagram.com/reel/PruebaPrivado1/", { transcribir: transcriptor(), bajarEmbed: embed, bajarYtDlp: ytdlp }),
    (error) => {
      assert.match(error.message, /No he podido bajar el reel/)
      assert.match(error.message, /embed de Instagram: el embed no trae vídeo/)
      assert.match(error.message, /yt-dlp: Login required/)
      assert.match(error.message, /pegármelo aquí/)
      return true
    },
  )
  assert.ok(!fs.existsSync(path.join(REELS, "PruebaPrivado1", "resultado.json")))
})

// ---------- transcribir.py ----------

test("transcribir.py: errores por stderr con código distinto de 0", { skip: sinPython }, () => {
  const script = path.join(carpetaScripts, "transcribir.py")
  const inexistente = spawnSync(PYTHON_PRUEBA, [script, path.join(DATOS_TEMPORALES, "no-existe.wav")], { encoding: "utf8" })
  assert.notEqual(inexistente.status, 0)
  assert.match(inexistente.stderr, /transcribir\.py:/)
  assert.equal(inexistente.stdout, "")

  const sinArgumentos = spawnSync(PYTHON_PRUEBA, [script], { encoding: "utf8" })
  assert.notEqual(sinArgumentos.status, 0)
})

test("transcribir.py: un WAV vacío da JSON vacío sin cargar el modelo, y uno a otra frecuencia se rechaza", { skip: sinPython }, () => {
  const script = path.join(carpetaScripts, "transcribir.py")
  const wav = (tasa) => {
    const archivo = path.join(DATOS_TEMPORALES, `vacio-${tasa}.wav`)
    const h = Buffer.alloc(44)
    h.write("RIFF", 0); h.writeUInt32LE(36, 4); h.write("WAVE", 8); h.write("fmt ", 12)
    h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
    h.writeUInt32LE(tasa, 24); h.writeUInt32LE(tasa * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
    h.write("data", 36); h.writeUInt32LE(0, 40)
    fs.writeFileSync(archivo, h)
    return archivo
  }
  const vacio = spawnSync(PYTHON_PRUEBA, [script, wav(16000), "--idioma", "es"], { encoding: "utf8" })
  assert.equal(vacio.status, 0, vacio.stderr)
  assert.deepEqual(JSON.parse(vacio.stdout), { texto: "", idioma: "es", segmentos: [] })

  const otraFrecuencia = spawnSync(PYTHON_PRUEBA, [script, wav(44100)], { encoding: "utf8" })
  assert.notEqual(otraFrecuencia.status, 0)
  assert.match(otraFrecuencia.stderr, /16000 Hz/)
})

// ---------- punta a punta (manual, con red) ----------

test("punta a punta con un reel público real", { skip: URL_RED ? false : "define CONTENT_OS_PRUEBA_RED con la URL de un reel público", timeout: 20 * 60 * 1000 }, () => {
  const env = { ...process.env, CONTENT_OS_DATOS: DATOS_TEMPORALES }
  if (PLAYWRIGHT_REAL) env.CONTENT_OS_PLAYWRIGHT = PLAYWRIGHT_REAL
  if (!process.env.CONTENT_OS_PRUEBA_MODELO) env.HF_HUB_OFFLINE = "1"
  const r = spawnSync(process.execPath, [path.join(carpetaScripts, "reel-local.mjs"), URL_RED], { encoding: "utf8", env, timeout: 20 * 60 * 1000 })
  assert.equal(r.status, 0, r.stderr)
  const resultado = JSON.parse(r.stdout)
  assert.equal(resultado.ok, true)
  assert.ok(resultado.duracion_s > 0)
  assert.ok(fs.existsSync(resultado.imagenes.arranque))
  assert.ok(resultado.imagenes.hojas.length >= 1)
  console.log(`punta a punta: via=${resultado.via} autor=${resultado.autor} duracion=${resultado.duracion_s}s palabras=${resultado.transcripcion.split(/\s+/).filter(Boolean).length} idioma=${resultado.idioma}`)
  console.log(`caption: ${resultado.caption.slice(0, 120)}`)
  console.log(`avisos: ${JSON.stringify(resultado.avisos)}`)
  console.log(`transcripcion: ${resultado.transcripcion.slice(0, 200)}`)
})
