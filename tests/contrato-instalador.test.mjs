// Que los instaladores de Windows y Mac, el doctor y los scripts de node cuenten lo mismo: constantes, pasos, carpetas
// de datos (las de rutas.mjs), versiones fijadas, ficheros que baja el instalador suelto, BOM de los .ps1 y finales de línea
// de los .sh. No ejecuta ningún instalador.
// Uso: node --test tests/contrato-instalador.test.mjs
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { ESPERA_MCP_MS, ID_PLUGIN, MARKETPLACE, REPO } from "../plugins/drazo-studio/scripts/ajustes-claude.mjs"
import { NODE_MINIMO, RAMA_NODE } from "../plugins/drazo-studio/scripts/node-parcheado.mjs"

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..")
const SCRIPTS = join(PLUGIN, "plugins", "drazo-studio", "scripts")
const leer = (...partes) => readFileSync(join(PLUGIN, ...partes), "utf8")
const instalarPs1 = leer("instalar.ps1")
const instalarSh = leer("instalar.sh")
const comunPs1 = leer("plugins", "drazo-studio", "scripts", "comun.ps1")
const comunSh = leer("plugins", "drazo-studio", "scripts", "comun.sh")
const PASOS = ["git", "node", "claude", "ffmpeg", "python", "venv", "modelo", "playwright", "registrar"]

// Lo que genera el instalador (el resto del plugin lo escribe quien mantiene el plugin y puede venir con otros finales de línea)
const MIOS = [
  "instalar.ps1", "instalar.sh", "plugins/drazo-studio/hooks/hooks.json", "plugins/drazo-studio/bin/drazo-studio-doctor",
  ...["comun.ps1", "comun.sh", "doctor.ps1", "doctor.sh", "ajustes-claude.mjs", "node-parcheado.mjs", "comprobar-python.py",
    "requisitos-python.txt", "comprobar-instancia.mjs", "aviso-node.sh"].map((f) => `plugins/drazo-studio/scripts/${f}`),
]

function ficheros(carpeta) {
  return readdirSync(carpeta).flatMap((nombre) => {
    if (nombre === "node_modules") return []
    const ruta = join(carpeta, nombre)
    return statSync(ruta).isDirectory() ? ficheros(ruta) : [ruta]
  })
}

test("constantes al principio de cada instalador: repo, rama, marketplace y plugin", () => {
  assert.equal(REPO, "davidmadrazo/drazo-studio")
  assert.equal(MARKETPLACE, "drazo-studio")
  assert.equal(ID_PLUGIN, "drazo-studio@drazo-studio")
  assert.match(instalarPs1, /^\$RepoPlugin = 'davidmadrazo\/drazo-studio'$/m)
  assert.match(instalarPs1, /^\$RamaPlugin = 'main'$/m)
  assert.match(instalarPs1, /^\$NombreMarketplace = 'drazo-studio'$/m)
  assert.match(instalarPs1, /^\$IdPlugin = 'drazo-studio@drazo-studio'$/m)
  assert.match(instalarSh, /^REPO_PLUGIN="davidmadrazo\/drazo-studio"$/m)
  assert.match(instalarSh, /^RAMA_PLUGIN="main"$/m)
  assert.match(instalarSh, /^NOMBRE_MARKETPLACE="drazo-studio"$/m)
  assert.match(instalarSh, /^ID_PLUGIN="drazo-studio@drazo-studio"$/m)
  // Y van antes que cualquier función
  assert.ok(instalarPs1.indexOf("$RepoPlugin") < instalarPs1.indexOf("function "))
  assert.ok(instalarSh.indexOf("REPO_PLUGIN=") < instalarSh.indexOf("() {"))
})

test("los dos instaladores tienen los mismos pasos, en el mismo orden", () => {
  assert.match(instalarSh, new RegExp(`^PASOS_VALIDOS="${PASOS.join(" ")}"$`, "m"))
  const catalogo = instalarPs1.slice(instalarPs1.indexOf("function Nuevo-Catalogo"), instalarPs1.indexOf("# Un paso está hecho"))
  const claves = [...catalogo.matchAll(/^\s{8}(\w+)\s+= @\{ Comprobar/gm)].map((m) => m[1])
  assert.deepEqual(claves, PASOS)
  assert.match(instalarPs1, /^# Pasos: git node claude ffmpeg python venv modelo playwright registrar$/m)
  assert.match(instalarSh, /^# Pasos: git node claude ffmpeg python venv modelo playwright registrar$/m)
})

test("no queda ningún paso heredado: chrome, navegador de HyperFrames, skills, fuentes, telemetría, tesseract", () => {
  const sobrante = /chrome(?!-headless)|hyperframes|tesseract|telemetr|fuentes/i
  for (const [nombre, texto] of Object.entries({ instalarPs1, instalarSh, comunPs1, comunSh })) {
    assert.ok(!sobrante.test(texto), `${nombre} nombra algo heredado: ${sobrante.exec(texto)?.[0]}`)
  }
})

test("las carpetas de datos son las de rutas.mjs", async () => {
  const datos = join(PLUGIN, "datos-de-prueba-que-no-existe")
  process.env.CONTENT_OS_DATOS = datos
  const rutas = await import("../plugins/drazo-studio/scripts/rutas.mjs")
  assert.equal(rutas.DATOS, datos)
  assert.equal(rutas.VENV, join(datos, "venv"))
  assert.equal(rutas.NODE_HERRAMIENTAS, join(datos, "node"))
  assert.equal(rutas.NAVEGADORES, join(datos, "ms-playwright"))
  assert.equal(rutas.FFMPEG_DIR, join(datos, "ffmpeg"))
  assert.equal(rutas.MODELO_WHISPER, "large-v3-turbo")
  const fuente = leer("plugins", "drazo-studio", "scripts", "rutas.mjs")
  assert.match(fuente, /"DrazoStudio"/)
  assert.match(fuente, /"\.local", "share", "drazo-studio"/)
  // Windows
  assert.match(comunPs1, /Join-Path \$env:LOCALAPPDATA 'DrazoStudio'/)
  assert.match(comunPs1, /\$CosVenv\s+= Join-Path \$CosDatos 'venv'/)
  assert.match(comunPs1, /\$CosPython\s+= Join-Path \$CosVenv 'Scripts\\python\.exe'/)
  assert.match(comunPs1, /\$CosNode\s+= Join-Path \$CosDatos 'node'/)
  assert.match(comunPs1, /\$CosNavegadores\s+= Join-Path \$CosDatos 'ms-playwright'/)
  assert.match(comunPs1, /\$CosFfmpeg\s+= Join-Path \$CosDatos 'ffmpeg'/)
  assert.match(comunPs1, /\$env:CONTENT_OS_DATOS/)
  // Mac
  assert.match(comunSh, /^COS_DATOS="\$\{CONTENT_OS_DATOS:-\$HOME\/\.local\/share\/drazo-studio\}"$/m)
  assert.match(comunSh, /^COS_VENV="\$COS_DATOS\/venv"$/m)
  assert.match(comunSh, /^COS_PYTHON="\$COS_VENV\/bin\/python"$/m)
  assert.match(comunSh, /^COS_NODE="\$COS_DATOS\/node"$/m)
  assert.match(comunSh, /^COS_NAVEGADORES="\$COS_DATOS\/ms-playwright"$/m)
  assert.match(comunSh, /^COS_FFMPEG="\$COS_DATOS\/ffmpeg"$/m)
  assert.match(comunSh, /^COS_ENTORNO="\$COS_DATOS\/entorno\.sh"$/m)
  // El PLAYWRIGHT_BROWSERS_PATH del instalador es el que lee el plugin
  assert.match(instalarPs1, /\$env:PLAYWRIGHT_BROWSERS_PATH = \$CosNavegadores/)
  assert.match(instalarSh, /PLAYWRIGHT_BROWSERS_PATH="\$COS_NAVEGADORES"/)
})

test("las versiones fijadas coinciden en Windows y Mac", () => {
  const ps = (nombre) => new RegExp(`^\\$${nombre}\\s*= '([^']+)'$`, "m").exec(comunPs1)?.[1]
  const sh = (nombre) => new RegExp(`^${nombre}="([^"]+)"$`, "m").exec(comunSh)?.[1]
  assert.equal(ps("VersionPlaywright"), "1.64.1")
  assert.equal(sh("VERSION_PLAYWRIGHT"), ps("VersionPlaywright"))
  assert.equal(sh("VERSION_NODE_RESPALDO"), ps("VersionNodeRespaldo"))
  assert.match(comunPs1, new RegExp(`^\\$RamaNode\\s*= ${RAMA_NODE}$`, "m"))
  assert.match(comunSh, new RegExp(`^RAMA_NODE=${RAMA_NODE}$`, "m"))
  assert.match(comunPs1, new RegExp(`^\\$NodeMinimo\\s*= \\[version\\]'${NODE_MINIMO}\\.0\\.0'$`, "m"))
  assert.match(comunSh, new RegExp(`^NODE_MINIMO=${NODE_MINIMO}$`, "m"))
  assert.match(comunPs1, /^\$DiscoMinimoGB\s*= 4$/m)
  assert.match(comunSh, /^DISCO_MINIMO_GB=4$/m)
  assert.equal(ESPERA_MCP_MS, 900_000)
})

test("playwright: versión fijada, solo el headless shell y sin npx", () => {
  assert.match(instalarPs1, /--save-exact "playwright-core@\$VersionPlaywright"/)
  assert.match(instalarSh, /--save-exact "playwright-core@\$VERSION_PLAYWRIGHT"/)
  assert.match(instalarPs1, /cli\.js\$?'? install chromium-headless-shell|\$cli install chromium-headless-shell/)
  assert.match(instalarSh, /playwright-core\/cli\.js" install chromium-headless-shell/)
  // «install --only-shell» a secas bajaría también Firefox y WebKit
  assert.doesNotMatch(instalarPs1.replace(/#.*$/gm, ""), /--only-shell/)
  assert.doesNotMatch(instalarSh.replace(/#.*$/gm, ""), /--only-shell/)
})

test("el paso registrar pasa dirección, token y carpeta, y no escribe CLAUDE.md", () => {
  for (const [nombre, texto] of Object.entries({ instalarPs1, instalarSh })) {
    assert.match(texto, /--instancia-url/, nombre)
    assert.match(texto, /--token/, nombre)
    assert.match(texto, /--fuente-local/, nombre)
    assert.match(texto, /instalar-plugin/, nombre)
    assert.doesNotMatch(texto.replace(/#.*$/gm, ""), /CLAUDE\.md/, nombre)
  }
  assert.match(instalarPs1, /\[string\]\$InstanciaUrl/)
  assert.match(instalarPs1, /\[string\]\$Token/)
  assert.match(instalarPs1, /\[string\]\$Carpeta/)
  assert.match(instalarPs1, /\[string\]\$Marketplace/)
  assert.match(instalarSh, /--instancia-url\|--token\|--marketplace\|--carpeta/)
  assert.doesNotMatch(leer("plugins", "drazo-studio", "scripts", "ajustes-claude.mjs").replace(/\/\/.*$/gm, ""), /CLAUDE\.md/)
})

test("el instalador suelto baja todo lo que necesita y existe en el plugin", () => {
  const ps = [...instalarPs1.slice(instalarPs1.indexOf("$FicherosPlugin"), instalarPs1.indexOf("$CarpetaTemporal")).matchAll(/'([^']+)'/g)].map((m) => m[1])
  const sh = /^FICHEROS_PLUGIN="([^"]+)"$/m.exec(instalarSh)[1].split(" ")
  const necesarios = ["comun", "doctor"].flatMap((n) => [`scripts/${n}.ps1`, `scripts/${n}.sh`])
  const comunes = ["comprobar-instancia.mjs", "ajustes-claude.mjs", "node-parcheado.mjs", "comprobar-python.py", "requisitos-python.txt"].map((f) => `scripts/${f}`)
  assert.deepEqual([...ps].sort(), [...necesarios.filter((f) => f.endsWith(".ps1")), ...comunes].sort())
  assert.deepEqual([...sh].sort(), [...necesarios.filter((f) => f.endsWith(".sh")), ...comunes].sort())
  for (const f of [...ps, ...sh]) assert.ok(existsSync(join(PLUGIN, "plugins", "drazo-studio", f)), f)
})

test("las importaciones de los scripts de node están entre los ficheros que se bajan", () => {
  for (const f of ["comprobar-instancia.mjs", "ajustes-claude.mjs", "node-parcheado.mjs"]) {
    for (const m of leer("plugins", "drazo-studio", "scripts", f).matchAll(/from "\.\/([^"]+)"/g)) {
      assert.ok(["ajustes-claude.mjs"].includes(m[1]), `${f} importa ${m[1]}, que el instalador suelto no baja`)
    }
  }
})

test("hook de arranque: avisa del Node sin parchear y nunca bloquea", () => {
  const hooks = JSON.parse(leer("plugins", "drazo-studio", "hooks", "hooks.json"))
  const arranque = hooks.hooks.SessionStart
  assert.equal(arranque.length, 1)
  assert.equal(arranque[0].matcher, "startup")
  assert.equal(arranque[0].hooks[0].type, "command")
  assert.equal(arranque[0].hooks[0].command, 'bash "${CLAUDE_PLUGIN_ROOT}/scripts/aviso-node.sh"')
  assert.ok(arranque[0].hooks[0].timeout <= 15)
  const aviso = leer("plugins", "drazo-studio", "scripts", "aviso-node.sh")
  assert.match(aviso, /^#!\/bin\/bash/)
  assert.match(aviso, /node-parcheado\.mjs" aviso/)
  assert.match(aviso, /exit 0\s*$/)
})

test("drazo-studio-doctor llama a los dos doctores", () => {
  const bin = leer("plugins", "drazo-studio", "bin", "drazo-studio-doctor")
  assert.match(bin, /^#!\/usr\/bin\/env bash/)
  assert.match(bin, /scripts\/doctor\.sh/)
  assert.match(bin, /scripts\/doctor\.ps1/)
})

test("los .ps1 llevan BOM y los .sh, los .mjs y el bin, solo LF", () => {
  const todos = [...MIOS, ...ficheros(join(PLUGIN, "tests")).map((f) => relative(PLUGIN, f))]
  let ps1 = 0
  for (const nombre of todos) {
    const bytes = readFileSync(join(PLUGIN, nombre))
    const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    if (/\.ps1$/.test(nombre)) { ps1++; assert.ok(bom, `${nombre} sin BOM`) }
    if (/\.(sh|mjs|py)$/.test(nombre) || /drazo-studio-doctor$/.test(nombre)) assert.ok(!bom, `${nombre} lleva BOM`)
    if (/\.(sh|mjs|py|json|txt)$/.test(nombre) || /drazo-studio-doctor$/.test(nombre)) assert.ok(!bytes.includes(13), `${nombre} tiene CRLF`)
  }
  assert.ok(ps1 >= 5, "se han mirado los .ps1")
})

// El instalador viene del editor de la casa: no puede quedar nada suyo (su licencia, su repo, sus motores ni su
// nombre comercial). «Drazo Studio» sí es el nombre de este producto.
test("ni rastro del editor del que viene el instalador", () => {
  const editor = new RegExp(["drz_", "drazo-pro", "Drazo (?:Pro|Editor)", "Hyper" + "Frames", "Tess" + "eract", "\\.local/share/drazo/",
    "LOCALAPPDATA\\\\Drazo\\\\", "(?<![a-z])drazo(?![ -]?studio)"].join("|"), "i")
  const esta = relative(PLUGIN, fileURLToPath(import.meta.url))
  const todos = [...MIOS, ...ficheros(join(PLUGIN, "tests")).map((f) => relative(PLUGIN, f))].filter((f) => f !== esta)
  for (const f of todos) {
    const texto = readFileSync(join(PLUGIN, f), "utf8").replace(/davidmadrazo/gi, "")
    assert.ok(!editor.test(texto), `${f} nombra al editor de origen: ${editor.exec(texto)?.[0]}`)
  }
  assert.ok(existsSync(SCRIPTS))
})
