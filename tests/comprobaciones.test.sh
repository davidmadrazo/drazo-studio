#!/bin/bash
# Pruebas de las comprobaciones de Mac (comun.sh) y de los caminos seguros del instalador (instalar.sh), todo en
# carpetas temporales con datos de mentira: no instala nada, no toca la carpeta de datos ni los ajustes de Claude de
# verdad. Los programas de macOS (uname, sw_vers, sysctl, vm_stat, xcode-select) y la orden «claude» son falsos y van
# los primeros en el PATH, así el instalador cree que está en un Mac y se puede probar también desde Git Bash.
# Uso: bash tests/comprobaciones.test.sh
raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)" || exit 1
trap '[ -n "$tmp" ] && [ -d "$tmp" ] && rm -rf "$tmp"' EXIT
# node (que lee estas variables) no entiende /tmp/... de MSYS: ruta con letra de unidad en Windows, la normal en Mac
mixto() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi; }
tmp="$(cd "$tmp" && pwd -P)"
base="$(mixto "$tmp")"

fallos=0
igual() {
    if [ "$2" = "$3" ]; then echo "ok    $1"; else echo "FALLA $1: esperaba «$3» y sale «$2»"; fallos=$((fallos + 1)); fi
}
contiene() {
    case "$2" in *"$3"*) echo "ok    $1" ;; *) echo "FALLA $1: no aparece «$3» en «$2»"; fallos=$((fallos + 1)) ;; esac
}
no_contiene() {
    case "$2" in *"$3"*) echo "FALLA $1: no debería aparecer «$3»"; fallos=$((fallos + 1)) ;; *) echo "ok    $1" ;; esac
}

# --- Programas falsos ---
falsos="$tmp/falsos"; mkdir -p "$falsos"
llamadas_claude="$tmp/claude-llamado.txt"
cat > "$falsos/uname" <<'EOF'
#!/bin/bash
case "$1" in -m) echo arm64 ;; *) echo Darwin ;; esac
EOF
cat > "$falsos/sw_vers" <<'EOF'
#!/bin/bash
echo 14.5
EOF
cat > "$falsos/sysctl" <<'EOF'
#!/bin/bash
case "$*" in
    *proc_translated*) ;;
    *hw.memsize*) echo 17179869184 ;;
    *hw.pagesize*) echo 16384 ;;
esac
EOF
cat > "$falsos/vm_stat" <<'EOF'
#!/bin/bash
printf 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 100000.\nPages inactive: 100000.\nPages speculative: 10000.\n'
EOF
cat > "$falsos/xcode-select" <<'EOF'
#!/bin/bash
[ "$1" = "-p" ] && echo /Library/Developer/CommandLineTools
exit 0
EOF
cat > "$falsos/claude" <<EOF
#!/bin/bash
echo "\$*" >> "$tmp/claude-llamado.txt"
exit 0
EOF
chmod +x "$falsos"/*

PATH_ORIGINAL="$PATH"
export CONTENT_OS_DATOS="$base/datos"
export CLAUDE_CONFIG_DIR="$base/claude"
export CLAUDE_CODE_PLUGIN_CACHE_DIR="$base/plugins"
export HOME="$tmp/home"
mkdir -p "$HOME" "$CLAUDE_CONFIG_DIR"
ajustes_json="$CLAUDE_CONFIG_DIR/settings.json"
# shellcheck source=../plugins/drazo-studio/scripts/comun.sh
. "$raiz/plugins/drazo-studio/scripts/comun.sh"

vaciar_datos() {
    case "$COS_DATOS" in "$base"/*) rm -rf "$COS_DATOS" ;; *) echo "se negó a borrar $COS_DATOS"; exit 1 ;; esac
}
vaciar_ajustes() {
    rm -f "$ajustes_json"
    rm -rf "$CLAUDE_CODE_PLUGIN_CACHE_DIR"
    estado_ajustes --renovar
}

# --- Rutas ---
echo "== Rutas"
igual "datos con CONTENT_OS_DATOS" "$COS_DATOS" "$base/datos"
igual "venv dentro de datos" "$COS_VENV" "$base/datos/venv"
igual "python del venv" "$COS_PYTHON" "$base/datos/venv/bin/python"
igual "node_modules en datos/node" "$COS_NODE" "$base/datos/node"
igual "navegadores en datos/ms-playwright" "$COS_NAVEGADORES" "$base/datos/ms-playwright"
igual "ffmpeg en datos/ffmpeg" "$COS_FFMPEG" "$base/datos/ffmpeg"
igual "entorno.sh en datos" "$COS_ENTORNO" "$base/datos/entorno.sh"
igual "playwright fijado" "$VERSION_PLAYWRIGHT" "1.64.1"
igual "disco mínimo" "$DISCO_MINIMO_GB" "4"
igual "requisitos de Python" "$(grep -v -e '^#' -e '^$' "$REQUISITOS_PYTHON" | tr '\n' ',')" "faster-whisper,numpy,yt-dlp,"
(unset CONTENT_OS_DATOS; . "$raiz/plugins/drazo-studio/scripts/comun.sh"; echo "$COS_DATOS" > "$tmp/datos-por-defecto.txt")
igual "datos por defecto" "$(cat "$tmp/datos-por-defecto.txt")" "$HOME/.local/share/drazo-studio"

# --- Mac simulado ---
echo "== sistema"
PATH="$falsos:$PATH_ORIGINAL"
comprobar_sistema; igual "macOS simulado: ok" "$RES_ESTADO" "ok"
contiene "dice la versión y la arquitectura" "$RES_DETALLE" "macOS 14.5 (arm64)"
comprobar_memoria; igual "memoria: ok con 16 GB" "$RES_ESTADO" "ok"
contiene "memoria: dice cuánta" "$RES_DETALLE" "16 GB en total, 3 GB libres ahora"
PATH="$PATH_ORIGINAL"

# --- playwright-core y su navegador ---
echo "== playwright"
nuevo_playwright() { # versión, revisión que pide, revisión descargada ("" = ninguna), "sin-marca" para una descarga a medias
    local version="$1" pide="${2:-1248}" descargada="${3-1248}" pc d
    vaciar_datos
    pc="$COS_NODE/node_modules/playwright-core"
    mkdir -p "$pc"
    printf '{ "name": "playwright-core", "version": "%s" }\n' "$version" > "$pc/package.json"
    printf '{\n  "comment": "x",\n  "browsers": [\n    {\n      "name": "chromium",\n      "revision": "%s"\n    },\n    {\n      "name": "chromium-headless-shell",\n      "revision": "%s"\n    },\n    {\n      "name": "firefox",\n      "revision": "9"\n    }\n  ]\n}\n' "$pide" "$pide" > "$pc/browsers.json"
    if [ -n "$descargada" ]; then
        d="$COS_NAVEGADORES/chromium_headless_shell-$descargada"
        mkdir -p "$d/chrome-headless-shell-mac-arm64"
        printf '#!/bin/bash\n' > "$d/chrome-headless-shell-mac-arm64/chrome-headless-shell"
        chmod +x "$d/chrome-headless-shell-mac-arm64/chrome-headless-shell"
        [ "$4" = "sin-marca" ] || : > "$d/INSTALLATION_COMPLETE"
    fi
}
vaciar_datos
comprobar_playwright; igual "sin playwright-core: falta" "$RES_ESTADO" "falta"
nuevo_playwright 1.64.1
comprobar_playwright; igual "versión fijada y navegador: ok" "$RES_ESTADO" "ok"
contiene "dice la versión y la revisión" "$RES_DETALLE" "playwright-core 1.64.1 · chrome-headless-shell 1248"
nuevo_playwright 1.60.0
comprobar_playwright; igual "otra versión de playwright-core: aviso" "$RES_ESTADO" "aviso"
contiene "el aviso dice cuál usa Drazo Studio" "$RES_DETALLE" "1.60.0 (Drazo Studio usa la 1.64.1)"
nuevo_playwright 1.64.1 1248 ""
comprobar_playwright; igual "sin navegador: falta" "$RES_ESTADO" "falta"
contiene "dice que falta el navegador" "$RES_DETALLE" "falta su navegador sin ventana"
nuevo_playwright 1.64.1 1248 1100
comprobar_playwright; igual "navegador de otra revisión: falta" "$RES_ESTADO" "falta"
nuevo_playwright 1.64.1 1248 1248 sin-marca
comprobar_playwright; igual "descarga a medias (sin INSTALLATION_COMPLETE): falta" "$RES_ESTADO" "falta"
vaciar_datos
comprobar_venv; igual "sin entorno de Python: falta" "$RES_ESTADO" "falta"
comprobar_modelo; igual "sin entorno no se puede mirar el modelo: falta" "$RES_ESTADO" "falta"

# --- ffmpeg: hacen falta los dos y que arranquen ---
echo "== ffmpeg"
mkdir -p "$tmp/ff-ok" "$tmp/ff-solo-ffmpeg" "$tmp/ff-roto"
printf '#!/bin/bash\necho "ffmpeg version 9.0.2 Copyright (c) 2000-2026 the FFmpeg developers"\n' > "$tmp/ff-ok/ffmpeg"
printf '#!/bin/bash\necho "ffprobe version 9.0.2 Copyright (c) 2007-2026 the FFmpeg developers"\n' > "$tmp/ff-ok/ffprobe"
cp "$tmp/ff-ok/ffmpeg" "$tmp/ff-solo-ffmpeg/ffmpeg"
printf '#!/bin/bash\nexit 1\n' > "$tmp/ff-roto/ffmpeg"; cp "$tmp/ff-roto/ffmpeg" "$tmp/ff-roto/ffprobe"
chmod +x "$tmp"/ff-*/*
# El PATH con solo /usr/bin: ningún ffmpeg de verdad por en medio
PATH="$tmp/ff-ok:/usr/bin"; comprobar_ffmpeg; igual "ffmpeg y ffprobe: ok" "$RES_ESTADO" "ok"
contiene "dice la versión" "$RES_DETALLE" "9.0.2"
PATH="$tmp/ff-solo-ffmpeg:/usr/bin"; comprobar_ffmpeg; igual "solo ffmpeg: falta" "$RES_ESTADO" "falta"
contiene "dice que falta ffprobe" "$RES_DETALLE" "falta ffprobe"
PATH="$tmp/ff-roto:/usr/bin"; comprobar_ffmpeg; igual "si no arrancan: falta" "$RES_ESTADO" "falta"
contiene "lo dice" "$RES_DETALLE" "no arrancan"
PATH="/usr/bin"; comprobar_ffmpeg; igual "ninguno: falta" "$RES_ESTADO" "falta"
contiene "dice que no están" "$RES_DETALLE" "no están"
PATH="$PATH_ORIGINAL"

# --- Registro en los ajustes de Claude ---
echo "== registro"
vaciar_ajustes
comprobar_plugin; igual "sin ajustes: plugin no registrado" "$RES_ESTADO" "falta"
comprobar_conexion; igual "sin ajustes: sin dirección ni token" "$RES_ESTADO" "falta"
contiene "lo dice" "$RES_DETALLE" "no hay guardados ni la dirección ni el token"
comprobar_registro; igual "registro: falta" "$RES_ESTADO" "falta"

printf '{ esto no es json' > "$ajustes_json"
estado_ajustes --renovar
comprobar_plugin; igual "ajustes rotos: falta" "$RES_ESTADO" "falta"
contiene "ajustes rotos: lo dice" "$RES_DETALLE" "no se pueden leer"

vaciar_ajustes
url="https://mi-drazo-studio.vercel.app"
token="tok_1234567890abcdef"
salida="$(node "$AJUSTES_SCRIPT" registrar --instancia-url "$url" --token "$token" 2>&1)"
no_contiene "el registro no imprime el token" "$salida" "$token"
estado_ajustes --renovar
comprobar_plugin; igual "registrado sin descargar: aviso" "$RES_ESTADO" "aviso"
contiene "dice que aún no se ha descargado" "$RES_DETALLE" "aún sin descargar"
comprobar_conexion; igual "dirección y token guardados: ok" "$RES_ESTADO" "ok"
contiene "enseña la dirección" "$RES_DETALLE" "$url"
no_contiene "tapa el token" "$RES_DETALLE" "$token"
contiene "enseña el final del token" "$RES_DETALLE" "cdef"
comprobar_registro; igual "registro sin descargar: aviso" "$RES_ESTADO" "aviso"

instalado="$tmp/plugins/cache/drazo-studio"
mkdir -p "$instalado"
printf '{ "version": 2, "plugins": { "drazo-studio@drazo-studio": [ { "scope": "user", "installPath": "%s", "version": "2.1.0" } ] } }\n' "$(mixto "$instalado")" > "$tmp/plugins/installed_plugins.json"
estado_ajustes --renovar
comprobar_plugin; igual "registrado y descargado: ok" "$RES_ESTADO" "ok"
contiene "dice la versión" "$RES_DETALLE" "registrado y descargado (versión 2.1.0)"
comprobar_registro; igual "registro completo: ok" "$RES_ESTADO" "ok"

printf '{ "enabledPlugins": { "drazo-studio@drazo-studio": true }, "extraKnownMarketplaces": { "drazo-studio": { "source": { "source": "github", "repo": "x/y" } } }, "pluginConfigs": { "drazo-studio@drazo-studio": { "options": { "instancia_url": "https://a.b", "token_instancia": "abc" } } } }\n' > "$ajustes_json"
estado_ajustes --renovar
comprobar_conexion; igual "token demasiado corto: aviso" "$RES_ESTADO" "aviso"

# --- entorno.sh: se escribe una vez y pone las rutas de Drazo Studio delante ---
echo "== entorno.sh"
eval "$(sed -n '/^asegurar_entorno() {/,/^}/p' "$raiz/instalar.sh")"
vaciar_datos
(
    unset CONTENT_OS_DATOS
    . "$raiz/plugins/drazo-studio/scripts/comun.sh"
    mkdir -p "$COS_NODEJS/bin" "$COS_FFMPEG"
    asegurar_entorno >/dev/null
    asegurar_entorno >/dev/null
    echo "$(grep -c 'drazo-studio/entorno.sh' "$HOME/.zshenv") $(grep -c 'drazo-studio/entorno.sh' "$HOME/.zshrc")" > "$tmp/perfiles.txt"
    env -i HOME="$HOME" PATH=/usr/bin bash -c '. "$HOME/.local/share/drazo-studio/entorno.sh"; echo "$PATH"' > "$tmp/ruta-entorno.txt"
)
igual "los perfiles lo cargan una sola vez" "$(cat "$tmp/perfiles.txt")" "1 1"
contiene "entorno.sh pone el node de Drazo Studio" "$(cat "$tmp/ruta-entorno.txt")" "$HOME/.local/share/drazo-studio/nodejs/bin"
contiene "entorno.sh pone el ffmpeg de Drazo Studio" "$(cat "$tmp/ruta-entorno.txt")" "$HOME/.local/share/drazo-studio/ffmpeg"
igual "entorno.sh no se pisa a sí mismo en el PATH" "$(tr ':' '\n' < "$tmp/ruta-entorno.txt" | grep -c 'drazo-studio/nodejs/bin')" "1"

# --- instalar.sh: caminos seguros (los que no llegan a instalar nada) ---
echo "== instalar.sh (caminos seguros)"
vaciar_ajustes
# Un HOME nuevo: el de antes ya tiene los perfiles de zsh que escribió la prueba de entorno.sh
export HOME="$tmp/home-instalador"; mkdir -p "$HOME"
export CONTENT_OS_DATOS="$base/datos-instalador"
instalar() { PATH="$falsos:$PATH_ORIGINAL" bash "$raiz/instalar.sh" "$@" 2>&1; }

salida="$(instalar --solo-comprobar)"; codigo=$?
igual "solo comprobar: sale con 1 (faltan el entorno, el modelo...)" "$codigo" "1"
contiene "solo comprobar: saca la tabla" "$salida" "macOS 13 o superior"
contiene "solo comprobar: lista lo que haría" "$salida" "Esto haría el instalador, paso a paso:"
contiene "solo comprobar: paso venv" "$salida" "- [venv]"
contiene "solo comprobar: paso registrar" "$salida" "- [registrar]"
contiene "solo comprobar: dice que no cambia nada" "$salida" "no se instala ni se cambia nada"
igual "solo comprobar: no crea la carpeta de datos" "$([ -e "$CONTENT_OS_DATOS" ] && echo si || echo no)" "no"
igual "solo comprobar: no crea los ajustes de Claude" "$([ -e "$ajustes_json" ] && echo si || echo no)" "no"
igual "solo comprobar: no toca los perfiles de zsh" "$([ -e "$HOME/.zshenv" ] && echo si || echo no)" "no"

salida="$(instalar --si --pasos git,inventado)"; codigo=$?
igual "paso desconocido: sale con 2" "$codigo" "2"
contiene "paso desconocido: lista los válidos" "$salida" "git node claude ffmpeg python venv modelo playwright registrar"

salida="$(instalar --si --pasos)"; codigo=$?
igual "--pasos sin valor: sale con 2" "$codigo" "2"
salida="$(instalar --nada)"; codigo=$?
igual "opción desconocida: sale con 2" "$codigo" "2"

salida="$(instalar --si --pasos registrar)"; codigo=$?
igual "registrar sin dirección ni token: sale con 2" "$codigo" "2"
contiene "registrar: lo dice" "$salida" "-> [registrar] falta: no hay dirección ni token de tu app"
contiene "registrar: RESUMEN con el fallo" "$salida" "fallan=registrar"

salida="$(instalar --si --pasos registrar --instancia-url "$url")"; codigo=$?
igual "registrar sin token: sale con 2" "$codigo" "2"
contiene "registrar sin token: lo dice" "$salida" "no hay token de tu app"

salida="$(instalar --si --pasos registrar --instancia-url http://mi-app.com --token "$token")"; codigo=$?
igual "registrar con http: sale con 2" "$codigo" "2"
contiene "registrar con http: lo dice" "$salida" "tiene que empezar por https://"
no_contiene "no imprime el token" "$salida" "$token"

salida="$(instalar --si --pasos registrar --instancia-url "$url" --token corto)"; codigo=$?
igual "registrar con token corto: sale con 2" "$codigo" "2"
contiene "registrar con token corto: lo dice" "$salida" "demasiado corto"

igual "ningún camino seguro ha escrito los ajustes de Claude" "$([ -e "$ajustes_json" ] && echo si || echo no)" "no"
n_plugin=0
[ -f "$llamadas_claude" ] && n_plugin="$(grep -c '^plugin' "$llamadas_claude")"
igual "ni ha lanzado ninguna orden «claude plugin»" "$n_plugin" "0"

if command -v git >/dev/null 2>&1; then
    salida="$(instalar --si --pasos git)"; codigo=$?
    igual "un paso que ya estaba: sale con 0" "$codigo" "0"
    contiene "ya estaba" "$salida" "-> [git] ya estaba:"
    contiene "RESUMEN" "$salida" "RESUMEN: hechos=; ya estaban=git; fallan=; omitidos=; pendientes="
fi

salida="$(instalar --doctor)"; codigo=$?
igual "doctor: sale con 1 (faltan cosas en una carpeta vacía)" "$codigo" "1"
contiene "doctor: línea Tu Drazo Studio" "$salida" "Tu Drazo Studio"
contiene "doctor: línea Licencia" "$salida" "Licencia"
contiene "doctor: dice que falta la dirección" "$salida" "no hay guardados ni la dirección de tu app ni el token"
contiene "doctor: dice la carpeta de datos" "$salida" "Carpeta de Drazo Studio: $CONTENT_OS_DATOS"

echo ""
if [ "$fallos" -eq 0 ]; then echo "Todas las pruebas pasan."; exit 0; fi
echo "$fallos pruebas fallan."
exit 1
