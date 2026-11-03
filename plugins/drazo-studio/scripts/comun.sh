# Comprobaciones de Drazo Studio en macOS, compartidas por el instalador y el doctor.
# Se carga con: . "<carpeta>/comun.sh"
# Compatible con el bash 3.2 de macOS: sin arrays asociativos ni ${var,,}.
# Sin Homebrew ni sudo: todo lo que instala Drazo Studio va en su carpeta (~/.local/share/drazo-studio).

COS_SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# CONTENT_OS_DATOS solo existe para pruebas (rutas.mjs lo lee igual): sin ella, la carpeta de siempre.
COS_DATOS="${CONTENT_OS_DATOS:-$HOME/.local/share/drazo-studio}"
COS_VENV="$COS_DATOS/venv"
COS_PYTHON="$COS_VENV/bin/python"
COS_NODE="$COS_DATOS/node"
COS_NODEJS="$COS_DATOS/nodejs"
COS_FFMPEG="$COS_DATOS/ffmpeg"
COS_UV="$COS_DATOS/uv"
COS_NAVEGADORES="$COS_DATOS/ms-playwright"
COS_ENTORNO="$COS_DATOS/entorno.sh"
AJUSTES_SCRIPT="$COS_SCRIPTS/ajustes-claude.mjs"
INSTANCIA_SCRIPT="$COS_SCRIPTS/comprobar-instancia.mjs"
REQUISITOS_PYTHON="$COS_SCRIPTS/requisitos-python.txt"
SOPORTE="davidmadrazo@profimaxia.com"
# playwright-core con la versión fijada (publicada el 14-oct-2026) y solo su chromium-headless-shell.
VERSION_PLAYWRIGHT="1.64.1"
# Node oficial de nodejs.org: siempre la última 24.x, que se mira al instalar en index.json y se comprueba con
# el SHASUMS256.txt de su carpeta. Sin red, la de respaldo, con su SHA-256 fijado aquí.
RAMA_NODE=24
URL_NODE_DIST="https://nodejs.org/dist"
VERSION_NODE_RESPALDO="24.22.1"
SHA256_NODE_ARM64="89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7"
SHA256_NODE_X86_64="d132557e7ee2b85af08b0c8c34338e65c6430f2238d01f727728ef42dc83b035"
# uv (astral-sh/uv) y ffmpeg 9.0.2 estático de https://ffmpeg.martin-riedl.de (zips firmados): versiones fijas con su SHA-256.
VERSION_UV="0.13.0"
SHA256_UV_ARM64="a9c1b29002cf3c83f07fa9cd8a887a3be0107d90e23189721221e7257db8e3d6"
SHA256_UV_X86_64="5f44dcbde809b632f47c36fadb241cb4d6f9af71d0c8f172b5d2026d3dde742c"
URL_FFMPEG_ARM64="https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2"
URL_FFMPEG_X86_64="https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2"
SHA256_FFMPEG_ARM64="c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924"
SHA256_FFPROBE_ARM64="fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6"
SHA256_FFMPEG_X86_64="7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4"
SHA256_FFPROBE_X86_64="2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd"
# Mínimo duro: la 22 tiene parches hasta el 30-abr-2027. Que vaya al día con ellos lo dice node-parcheado.mjs.
NODE_MINIMO=22
DISCO_MINIMO_GB=4
COMPROBACIONES_COS="sistema git node claude ffmpeg python venv modelo playwright plugin conexion disco memoria"

if [ -t 1 ]; then
    C_VERDE=$'\033[32m'; C_ROJO=$'\033[31m'; C_AMARILLO=$'\033[33m'; C_CIAN=$'\033[36m'; C_FIN=$'\033[0m'
else
    C_VERDE=""; C_ROJO=""; C_AMARILLO=""; C_CIAN=""; C_FIN=""
fi

# Resultado de la última comprobación (bash 3.2 no tiene objetos: variables globales y arrays paralelos).
RES_ID=""; RES_NOMBRE=""; RES_ESTADO=""; RES_DETALLE=""; RES_ARREGLO=""; RES_OPCIONAL=0
L_NOMBRE=(); L_ESTADO=(); L_ARREGLO=(); L_OPCIONAL=()

resultado() {
    RES_ID="$1"; RES_NOMBRE="$2"; RES_ESTADO="$3"; RES_DETALLE="$4"; RES_ARREGLO="${5:-}"; RES_OPCIONAL="${6:-0}"
}

mostrar_resultado() {
    local color etiqueta relleno
    case "$RES_ESTADO" in
        ok) color="$C_VERDE"; etiqueta="  OK  " ;;
        falta) color="$C_ROJO"; etiqueta="FALTA " ;;
        *) color="$C_AMARILLO"; etiqueta="AVISO " ;;
    esac
    # printf rellena por bytes y las tildes ocupan dos: se rellena contando caracteres.
    relleno=$((40 - ${#RES_NOMBRE}))
    [ "$relleno" -lt 1 ] && relleno=1
    printf '  %s[%s]%s %s%*s%s\n' "$color" "$etiqueta" "$C_FIN" "$RES_NOMBRE" "$relleno" "" "$RES_DETALLE"
}

apuntar_resultado() {
    L_NOMBRE+=("$RES_NOMBRE"); L_ESTADO+=("$RES_ESTADO"); L_ARREGLO+=("$RES_ARREGLO"); L_OPCIONAL+=("$RES_OPCIONAL")
}

# Lista final: lo que falta (obligatorio) con su arreglo, y los avisos aparte.
mostrar_arreglos() {
    local i n=1 hay_avisos=0 faltan=0
    echo ""
    for i in "${!L_ESTADO[@]}"; do [ "${L_ESTADO[$i]}" = "falta" ] && faltan=$((faltan + 1)); done
    if [ "$faltan" -eq 0 ]; then
        echo "${C_VERDE}Todo lo necesario está listo.${C_FIN}"
    else
        echo "${C_ROJO}Qué falta y cómo arreglarlo:${C_FIN}"
        for i in "${!L_ESTADO[@]}"; do
            [ "${L_ESTADO[$i]}" = "falta" ] || continue
            echo "  $n. Falta ${L_NOMBRE[$i]}: ${L_ARREGLO[$i]}"
            n=$((n + 1))
        done
    fi
    for i in "${!L_ESTADO[@]}"; do
        [ "${L_ESTADO[$i]}" = "aviso" ] && [ -n "${L_ARREGLO[$i]}" ] || continue
        [ "$hay_avisos" -eq 0 ] && { echo ""; echo "${C_AMARILLO}Avisos:${C_FIN}"; hay_avisos=1; }
        echo "  - ${L_NOMBRE[$i]}: ${L_ARREGLO[$i]}"
    done
}

hay_faltas_obligatorias() {
    local i
    for i in "${!L_ESTADO[@]}"; do
        [ "${L_ESTADO[$i]}" = "falta" ] && [ "${L_OPCIONAL[$i]}" != "1" ] && return 0
    done
    return 1
}

# Primer número con forma x.y[.z] del texto.
leer_version() {
    printf '%s\n' "$1" | grep -Eo '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -n 1
}

# 0 si la versión $1 es >= $2 (comparación numérica por partes).
version_minima() {
    local a b i
    IFS=. read -r -a a <<< "$1"; IFS=. read -r -a b <<< "$2"
    for i in 0 1 2; do
        if [ "${a[$i]:-0}" -gt "${b[$i]:-0}" ] 2>/dev/null; then return 0; fi
        if [ "${a[$i]:-0}" -lt "${b[$i]:-0}" ] 2>/dev/null; then return 1; fi
    done
    return 0
}

# Primera versión de la rama $1 en el index.json de nodejs.org que entra por stdin (va de la más nueva a la
# más vieja). Se lee como texto: el instalador lo necesita antes de que haya Node para leer JSON.
elegir_version_node() {
    grep -Eo "\"version\": *\"v$1\.[0-9]+\.[0-9]+\"" | head -n 1 | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+'
}

# La última 24.x publicada; sin red, o si index.json trae una más vieja, la de respaldo.
version_node_a_instalar() {
    local indice v
    indice="$(curl -fsSL --max-time 20 "$URL_NODE_DIST/index.json" 2>/dev/null)"
    v="$(printf '%s\n' "$indice" | elegir_version_node "$RAMA_NODE")"
    if [ -z "$v" ] || ! version_minima "$v" "$VERSION_NODE_RESPALDO"; then v="$VERSION_NODE_RESPALDO"; fi
    echo "$v"
}

# SHA-256 del fichero $2 de Node $1: el fijado para la versión de respaldo; para otra, la de SHASUMS256.txt.
huella_node() {
    if [ "$1" = "$VERSION_NODE_RESPALDO" ]; then
        case "$2" in
            *-darwin-arm64.tar.gz) echo "$SHA256_NODE_ARM64" ;;
            *-darwin-x64.tar.gz) echo "$SHA256_NODE_X86_64" ;;
        esac
        return
    fi
    curl -fsSL --max-time 20 "$URL_NODE_DIST/v$1/SHASUMS256.txt" 2>/dev/null | awk -v f="$2" '$2 == f { print $1; exit }'
}

# Sin las herramientas de línea de órdenes de Xcode, /usr/bin/git y /usr/bin/python3 abren
# un diálogo de instalación al ejecutarlos: no se tocan si no están instaladas.
tiene_clt() { xcode-select -p >/dev/null 2>&1; }

# arm64 en Apple Silicon (también bajo Rosetta) y x86_64 en Intel.
arquitectura() {
    if [ "$(uname -m)" = "arm64" ] || [ "$(sysctl -in sysctl.proc_translated 2>/dev/null)" = "1" ]; then echo arm64; else echo x86_64; fi
}

# Node, ffmpeg y uv de Drazo Studio en el PATH de este proceso (una terminal nueva los toma de entorno.sh).
cargar_rutas_cos() {
    local d
    for d in "$COS_FFMPEG" "$COS_NODEJS/bin" "$COS_UV"; do
        case ":$PATH:" in *":$d:"*) ;; *) [ -d "$d" ] && PATH="$d:$PATH" ;; esac
    done
    export PATH
}

ruta_app_escritorio() {
    local a
    for a in "/Applications/Claude.app" "$HOME/Applications/Claude.app"; do
        if [ -d "$a" ]; then echo "$a"; return; fi
    done
}

# Registro de Drazo Studio, dirección y token de tu app en los ajustes de Claude (settings.json), leídos con
# ajustes-claude.mjs. Quedan en variables AJ_<clave> (bash 3.2 no tiene arrays asociativos).
AJ_CARGADO=0
estado_ajustes() {
    if [ "$AJ_CARGADO" = "1" ] && [ "${1:-}" != "--renovar" ]; then return 0; fi
    AJ_CARGADO=0
    command -v node >/dev/null 2>&1 || return 1
    local linea clave
    AJ_ajustes=""; AJ_ruta=""; AJ_detalle=""; AJ_marketplace=""; AJ_fuente=""; AJ_activado=""; AJ_instancia=""
    AJ_instancia_url=""; AJ_token=""; AJ_token_tapado=""; AJ_token_formato=""; AJ_https=""; AJ_descargado=""; AJ_version=""
    while IFS= read -r linea; do
        clave="${linea%%=*}"
        case "$clave" in
            ajustes|ruta|detalle|marketplace|fuente|activado|instancia|instancia_url|token|token_tapado|token_formato|https|descargado|version)
                printf -v "AJ_$clave" '%s' "${linea#*=}" ;;
        esac
    done <<< "$(node "$AJUSTES_SCRIPT" estado 2>/dev/null)"
    AJ_CARGADO=1
}

carpeta_config_claude() { echo "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"; }

ruta_claude() {
    if command -v claude >/dev/null 2>&1; then command -v claude; return; fi
    [ -x "$HOME/.local/bin/claude" ] && echo "$HOME/.local/bin/claude"
}

# Python de base, solo como reserva si no hay uv (se descartan los de conda).
PY_BASE_EXE=""; PY_BASE_VERSION=""
buscar_python_base() {
    local c exe salida version conda orden mejor_orden=99
    PY_BASE_EXE=""; PY_BASE_VERSION=""
    for c in python3.12 python3.13 python3.11 python3.14 python3.10 python3; do
        exe="$(command -v "$c" 2>/dev/null)"
        [ -n "$exe" ] || continue
        if [ "$exe" = "/usr/bin/python3" ] && ! tiene_clt; then continue; fi
        salida="$("$exe" -c 'import os,sys; print("%d.%d.%d" % sys.version_info[:3]); print(sys.executable); print(os.path.isdir(os.path.join(sys.prefix, "conda-meta")))' 2>/dev/null)" || continue
        version="$(printf '%s\n' "$salida" | sed -n 1p)"
        conda="$(printf '%s\n' "$salida" | sed -n 3p)"
        [ "$conda" = "True" ] && continue
        version_minima "$version" "3.10" || continue
        case "$version" in 3.12.*) orden=0 ;; 3.13.*) orden=1 ;; 3.11.*) orden=2 ;; 3.14.*) orden=3 ;; 3.10.*) orden=4 ;; *) orden=5 ;; esac
        if [ "$orden" -lt "$mejor_orden" ]; then
            mejor_orden="$orden"; PY_BASE_VERSION="$version"; PY_BASE_EXE="$(printf '%s\n' "$salida" | sed -n 2p)"
        fi
    done
}

# El chromium-headless-shell de playwright-core, en la carpeta de navegadores de Drazo Studio. Con el playwright-core
# instalado se mira la revisión exacta que pide (browsers.json); sin él, cualquiera terminado de descargar.
# Deja el ejecutable en PW_EXE y la revisión en PW_REV (vacíos si no hay).
PW_EXE=""; PW_REV=""
buscar_navegador_playwright() {
    local rev="" bj="$COS_NODE/node_modules/playwright-core/browsers.json" d exe
    PW_EXE=""; PW_REV=""
    [ -d "$COS_NAVEGADORES" ] || return 0
    if [ -f "$bj" ]; then
        rev="$(sed -n '/"name": *"chromium-headless-shell"/,/}/p' "$bj" | sed -n 's/.*"revision": *"\([0-9]*\)".*/\1/p' | head -n 1)"
    fi
    if [ -n "$rev" ]; then set -- "$COS_NAVEGADORES/chromium_headless_shell-$rev"; else set -- "$COS_NAVEGADORES"/chromium_headless_shell-*; fi
    for d in "$@"; do
        [ -f "$d/INSTALLATION_COMPLETE" ] || continue
        for exe in "$d"/chrome-headless-shell-*/chrome-headless-shell; do
            if [ -x "$exe" ]; then PW_EXE="$exe"; PW_REV="${d##*chromium_headless_shell-}"; return 0; fi
        done
    done
}

comprobar_sistema() {
    local nombre="macOS 13 o superior" v arq
    if [ "$(uname -s)" != "Darwin" ]; then resultado sistema "$nombre" falta "$(uname -s)" "Esto es para macOS; en Windows usa instalar.ps1."; return; fi
    v="$(sw_vers -productVersion 2>/dev/null)"
    arq="$(uname -m)"
    [ "$(sysctl -in sysctl.proc_translated 2>/dev/null)" = "1" ] && arq="arm64"
    if ! version_minima "$v" "13.0"; then resultado sistema "$nombre" falta "macOS $v" "Drazo Studio necesita macOS 13 (Ventura) o superior."; return; fi
    resultado sistema "$nombre" ok "macOS $v ($arq)"
}

comprobar_git() {
    local g; g="$(command -v git 2>/dev/null)"
    if [ -z "$g" ] || { [ "$g" = "/usr/bin/git" ] && ! tiene_clt; }; then
        resultado git "Git" falta "no está" "Lo instala el instalador de Drazo Studio (paso «git»): abre la ventana de Apple de las herramientas de desarrollo (pulsa «Instalar»)."; return
    fi
    resultado git "Git" ok "$(leer_version "$("$g" --version 2>/dev/null)")"
}

# Además del mínimo, mira si lleva el último parche de seguridad de su rama (node-parcheado.mjs, con caché de
# 24 h; sin red no dice nada). Si no lo lleva es un aviso: no impide usar Drazo Studio, y el paso «node» lo pone al día.
comprobar_node() {
    local nombre="Node.js 22 o superior" v parches estado parche
    if ! command -v node >/dev/null 2>&1; then resultado node "$nombre" falta "no está" "Lo instala el instalador de Drazo Studio (paso «node»): Node oficial en la carpeta de Drazo Studio, sin contraseña."; return; fi
    v="$(leer_version "$(node --version 2>/dev/null)")"
    if ! version_minima "$v" "$NODE_MINIMO"; then resultado node "$nombre" falta "versión $v" "El instalador de Drazo Studio (paso «node») pone Node.js $RAMA_NODE (la última, con sus parches) en su carpeta."; return; fi
    if ! command -v npm >/dev/null 2>&1; then resultado node "$nombre" falta "$v sin npm" "El instalador de Drazo Studio (paso «node») pone Node.js $RAMA_NODE (con npm) en su carpeta."; return; fi
    parches="$(node "$COS_SCRIPTS/node-parcheado.mjs" estado 2>/dev/null)"
    estado="$(printf '%s\n' "$parches" | sed -n 's/^estado=//p')"
    parche="$(printf '%s\n' "$parches" | sed -n 's/^parche=//p')"
    if [ "$estado" = "atrasada" ]; then resultado node "$nombre" aviso "$v, sin el último parche de seguridad ($parche)" "Vuelve a pasar el paso «node» del instalador de Drazo Studio: pone al día Node.js $RAMA_NODE en su carpeta."; return; fi
    [ "$estado" = "al-dia" ] && v="$v, con los parches de seguridad al día"
    resultado node "$nombre" ok "$v"
}

comprobar_claude() {
    local nombre="Claude (app de escritorio o Claude Code)" c partes=""
    [ -n "$(ruta_app_escritorio)" ] && partes="app de escritorio"
    c="$(ruta_claude)"
    [ -n "$c" ] && partes="${partes:+$partes y }Claude Code $(leer_version "$("$c" --version 2>/dev/null)")"
    if [ -n "$partes" ]; then resultado claude "$nombre" ok "$partes"; return; fi
    if [ "${CLAUDECODE:-}" = "1" ]; then resultado claude "$nombre" ok "esta sesión de Claude Code"; return; fi
    resultado claude "$nombre" falta "no está" "Instala la app de escritorio de Claude (claude.com/download) y entra con tu cuenta de Claude."
}

# El ffmpeg de Drazo Studio va en su carpeta y entra el primero en el PATH (cargar_rutas_cos y entorno.sh).
comprobar_ffmpeg() {
    local nombre="ffmpeg y ffprobe" f p primera arreglo="Lo instala el instalador de Drazo Studio (paso «ffmpeg»): ffmpeg estático en la carpeta de Drazo Studio, sin contraseña."
    f="$(command -v ffmpeg 2>/dev/null)"; p="$(command -v ffprobe 2>/dev/null)"
    if [ -z "$f" ] && [ -z "$p" ]; then resultado ffmpeg "$nombre" falta "no están" "$arreglo"; return; fi
    if [ -z "$f" ]; then resultado ffmpeg "$nombre" falta "hay ffprobe pero falta ffmpeg ($p)" "$arreglo"; return; fi
    if [ -z "$p" ]; then resultado ffmpeg "$nombre" falta "hay ffmpeg pero falta ffprobe ($f)" "$arreglo"; return; fi
    if ! "$f" -hide_banner -version >/dev/null 2>&1 || ! "$p" -hide_banner -version >/dev/null 2>&1; then
        resultado ffmpeg "$nombre" falta "no arrancan ($f)" "$arreglo"; return
    fi
    primera="$("$f" -hide_banner -version 2>/dev/null | head -n 1 | sed 's/^ffmpeg version //; s/ Copyright.*//')"
    resultado ffmpeg "$nombre" ok "$primera ($f)"
}

# En Mac el Python del entorno lo trae uv, sin contraseña; un Python del sistema solo sirve de reserva.
comprobar_python() {
    local nombre="uv (trae el Python de Drazo Studio)" uv
    uv="$(command -v uv 2>/dev/null)"
    if [ -n "$uv" ]; then resultado python "$nombre" ok "uv $(leer_version "$("$uv" --version 2>/dev/null)") ($uv)"; return; fi
    if [ -x "$COS_PYTHON" ]; then resultado python "$nombre" ok "no hace falta: el entorno de Drazo Studio ya existe"; return; fi
    buscar_python_base
    if [ -n "$PY_BASE_EXE" ]; then resultado python "$nombre" aviso "sin uv; hay Python $PY_BASE_VERSION ($PY_BASE_EXE)" "El instalador de Drazo Studio (paso «python») pone uv en su carpeta (recomendado)."; return; fi
    resultado python "$nombre" falta "no está" "Lo instala el instalador de Drazo Studio (paso «python»): uv en la carpeta de Drazo Studio, sin contraseña."
}

comprobar_venv() {
    local nombre="Entorno de Python de Drazo Studio" salida version mal bien
    if [ ! -x "$COS_PYTHON" ]; then resultado venv "$nombre" falta "no existe $COS_VENV" "Lo crea el instalador de Drazo Studio (paso «venv»)."; return; fi
    salida="$("$COS_PYTHON" -X utf8 "$COS_SCRIPTS/comprobar-python.py" 2>/dev/null)"
    version="$(printf '%s\n' "$salida" | awk '$1 == "PYTHON" { print $2; exit }')"
    if [ -z "$version" ]; then resultado venv "$nombre" falta "su Python no arranca" "Vuelve a ejecutar el paso «venv» del instalador de Drazo Studio: rehace el entorno."; return; fi
    mal="$(printf '%s\n' "$salida" | awk '$1 == "MAL" { printf "%s%s", s, $2; s = ", " }')"
    bien="$(printf '%s\n' "$salida" | awk '$1 == "OK" { printf "%s%s %s", s, $2, $3; s = ", " }')"
    if [ -n "$mal" ]; then resultado venv "$nombre" falta "Python $version; fallan: $mal" "Vuelve a ejecutar el paso «venv» del instalador de Drazo Studio: reinstala los paquetes."; return; fi
    resultado venv "$nombre" ok "Python $version · $bien"
}

# El motor de transcribir usa este modelo de la caché de Hugging Face; si no está, lo baja la primera
# vez dentro de una orden con límite de 10 minutos. Una descarga a medias deja la carpeta sin model.bin.
comprobar_modelo() {
    local nombre="Modelo de transcripción large-v3-turbo" salida bytes
    if [ ! -x "$COS_PYTHON" ]; then resultado modelo "$nombre" falta "no se puede mirar sin el entorno de Python de Drazo Studio" "Lo descarga el instalador de Drazo Studio (paso «modelo») después de crear el entorno (unos 1,6 GB)."; return; fi
    salida="$("$COS_PYTHON" -X utf8 -c "import os; from faster_whisper import download_model; p = download_model('large-v3-turbo', local_files_only=True); print(os.path.getsize(os.path.join(p, 'model.bin')))" 2>&1)"
    bytes="$(printf '%s\n' "$salida" | grep -E '^[0-9]+$' | tail -n 1)"
    if [ -n "$bytes" ] && [ "$bytes" -gt 1073741824 ]; then
        resultado modelo "$nombre" ok "descargado ($(awk -v b="$bytes" 'BEGIN { printf "%.1f", b / 1000000000 }') GB, caché de Hugging Face)"; return
    fi
    case "$salida" in
        *"No module named"*|*ImportError*) resultado modelo "$nombre" falta "faster-whisper no está en el entorno de Drazo Studio" "Vuelve a ejecutar los pasos «venv» y «modelo» del instalador de Drazo Studio."; return ;;
    esac
    resultado modelo "$nombre" falta "no está descargado" "Vuelve a ejecutar el paso «modelo» del instalador de Drazo Studio (unos 1,6 GB): si no, la primera transcripción lo baja y puede cortarse."
}

# playwright-core y su navegador sin ventana. Con otra versión de playwright-core que la fijada es un aviso: funciona,
# y el paso «playwright» del instalador lo pone al día.
comprobar_playwright() {
    local nombre="playwright-core y su navegador" pj="$COS_NODE/node_modules/playwright-core/package.json" version
    if [ ! -f "$pj" ]; then resultado playwright "$nombre" falta "no está en $COS_NODE" "Lo instala el instalador de Drazo Studio (paso «playwright»), solo para Drazo Studio y no global."; return; fi
    version="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$pj" | head -n 1)"
    buscar_navegador_playwright
    if [ -z "$PW_EXE" ]; then resultado playwright "$nombre" falta "playwright-core $version, pero falta su navegador sin ventana en $COS_NAVEGADORES" "Vuelve a ejecutar el paso «playwright» del instalador de Drazo Studio: descarga el navegador (unos 150 MB)."; return; fi
    if [ "$version" != "$VERSION_PLAYWRIGHT" ]; then resultado playwright "$nombre" aviso "playwright-core $version (Drazo Studio usa la $VERSION_PLAYWRIGHT)" "Vuelve a ejecutar el paso «playwright» del instalador de Drazo Studio: lo pone al día."; return; fi
    resultado playwright "$nombre" ok "playwright-core $version · chrome-headless-shell $PW_REV"
}

# Registrado = marketplace y plugin en los ajustes de Claude. La app lo descarga al abrirse de nuevo.
comprobar_plugin() {
    local nombre="Drazo Studio registrado en Claude"
    if ! estado_ajustes; then resultado plugin "$nombre" falta "sin Node.js no se pueden leer los ajustes de Claude" "Instala Node.js con el instalador de Drazo Studio."; return; fi
    if [ "${AJ_ajustes:-}" = "json-invalido" ]; then resultado plugin "$nombre" falta "los ajustes de Claude no se pueden leer" "Revisa el fichero: ${AJ_detalle:-}"; return; fi
    if [ "${AJ_marketplace:-}" != "si" ] || [ "${AJ_activado:-}" != "si" ]; then resultado plugin "$nombre" falta "no está registrado" "Regístralo con el paso «registrar» del instalador de Drazo Studio."; return; fi
    if [ "${AJ_descargado:-}" != "si" ]; then resultado plugin "$nombre" aviso "registrado (${AJ_fuente:-}), aún sin descargar" "Vuelve a pasar el paso «registrar» del instalador: lo descarga e instala. Después, cierra la app de Claude del todo y ábrela."; return; fi
    if [ -n "${AJ_version:-}" ]; then resultado plugin "$nombre" ok "registrado y descargado (versión $AJ_version)"; return; fi
    resultado plugin "$nombre" ok "registrado, cargado desde ${AJ_fuente:-}"
}

# La dirección de tu app y el token viven en los ajustes de Claude (pluginConfigs), que es de donde los toma el plugin.
comprobar_conexion() {
    local nombre="Dirección y token de tu app" que
    if ! estado_ajustes; then resultado conexion "$nombre" falta "sin Node.js no se pueden leer los ajustes de Claude" "Instala Node.js con el instalador de Drazo Studio."; return; fi
    if [ "${AJ_ajustes:-}" = "json-invalido" ]; then resultado conexion "$nombre" falta "los ajustes de Claude no se pueden leer" "Revisa el fichero: ${AJ_detalle:-}"; return; fi
    if [ "${AJ_instancia:-}" != "si" ] || [ "${AJ_token:-}" != "si" ]; then
        if [ "${AJ_instancia:-}" != "si" ] && [ "${AJ_token:-}" != "si" ]; then que="guardados ni la dirección ni el token"
        elif [ "${AJ_instancia:-}" != "si" ]; then que="guardada la dirección"
        else que="guardado el token"; fi
        resultado conexion "$nombre" falta "no hay $que" "Guárdalos con el paso «registrar» del instalador de Drazo Studio, con la dirección y el token de tu app."; return
    fi
    if [ "${AJ_token_formato:-}" != "si" ]; then resultado conexion "$nombre" aviso "${AJ_instancia_url:-} con un token demasiado corto" "Revisa que guardaste el token completo de tu app."; return; fi
    resultado conexion "$nombre" ok "${AJ_instancia_url:-} · token ${AJ_token_tapado:-}"
}

comprobar_registro() {
    local pe pd pa
    comprobar_plugin; pe="$RES_ESTADO"; pd="$RES_DETALLE"; pa="$RES_ARREGLO"
    [ "$pe" = "falta" ] && return 0
    comprobar_conexion
    [ "$RES_ESTADO" != "ok" ] && return 0
    resultado registrar "Drazo Studio registrado con tu app" "$pe" "$pd; $RES_DETALLE" "$pa"
}

comprobar_disco() {
    local nombre="Espacio libre (más de $DISCO_MINIMO_GB GB)" kb gb donde="$HOME"
    [ -d "$COS_DATOS" ] && donde="$COS_DATOS"
    kb="$(df -Pk "$donde" 2>/dev/null | awk 'NR == 2 { print $4 }')"
    gb=$(( ${kb:-0} / 1048576 ))
    if [ "$gb" -lt "$DISCO_MINIMO_GB" ]; then resultado disco "$nombre" falta "$gb GB libres" "Libera espacio: el entorno de Python, el modelo de transcripción y el navegador ocupan varios GB."; return; fi
    resultado disco "$nombre" ok "$gb GB libres"
}

comprobar_memoria() {
    local nombre="Memoria (RAM)" total pagina paginas gb libre
    total="$(sysctl -n hw.memsize 2>/dev/null)"
    if [ -z "$total" ]; then resultado memoria "$nombre" aviso "no se pudo leer"; return; fi
    pagina="$(sysctl -n hw.pagesize 2>/dev/null)"
    paginas="$(vm_stat 2>/dev/null | awk '/Pages (free|inactive|speculative)/ { gsub(/\./, "", $NF); s += $NF } END { print s + 0 }')"
    gb=$(( total / 1073741824 )); libre=$(( paginas * ${pagina:-4096} / 1073741824 ))
    if [ "$gb" -lt 8 ]; then resultado memoria "$nombre" aviso "$gb GB en total, $libre GB libres ahora" "Con menos de 8 GB la transcripción va lenta o falla: cierra otras aplicaciones al usarla."; return; fi
    resultado memoria "$nombre" ok "$gb GB en total, $libre GB libres ahora"
}

# Ejecuta la comprobación $1, la muestra y la apunta para el resumen final.
comprobar() {
    "comprobar_$1"
    mostrar_resultado
    apuntar_resultado
}
