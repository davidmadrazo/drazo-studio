#!/bin/bash
# Instalador de Drazo Studio para macOS. Sin Homebrew ni sudo: todo va en la carpeta de Drazo Studio
# (~/.local/share/drazo-studio). Normalmente lo ejecuta Claude siguiendo INSTALAR.md, después de pedir
# permiso en el chat; también sirve a mano desde la Terminal.
# Uso:
#   bash instalar.sh --solo-comprobar                         solo mira, no cambia nada
#   bash instalar.sh --doctor                                 pasa el doctor completo (también prueba tu app y su licencia)
#   bash instalar.sh --si [--pasos git,node,...] [--instancia-url https://...] [--token ...] [--carpeta <ruta>]   sin preguntas
#                                                             (--carpeta: comprueba que existe tu carpeta de trabajo; no escribe nada dentro)
#   bash instalar.sh                                          pregunta antes de cada paso
#   bash instalar.sh --marketplace <carpeta del repo>         registra Drazo Studio desde una carpeta (pruebas)
# Pasos: git node claude ffmpeg python venv modelo playwright registrar
# Salida por paso: «== [paso] ...» al empezar y «-> [paso] ok|ya estaba|falta|error|pendiente: ...» al acabar.
# Código de salida: 0 todo bien · 1 algún paso no quedó bien · 2 uso incorrecto · 3 equipo no compatible
#                   · 4 esperando al usuario (ventana de Apple de las herramientas de desarrollo).
# Variable CONTENT_OS_DATOS: otra carpeta de datos (solo para pruebas).

REPO_PLUGIN="davidmadrazo/drazo-studio"
RAMA_PLUGIN="main"
NOMBRE_MARKETPLACE="drazo-studio"
ID_PLUGIN="drazo-studio@drazo-studio"
URL_BASE_PLUGIN="https://raw.githubusercontent.com/$REPO_PLUGIN/$RAMA_PLUGIN"

SOLO_COMPROBAR=0; DOCTOR=0; SI=0; PASOS=""; INSTANCIA_URL=""; TOKEN=""; MARKETPLACE=""; CARPETA=""
while [ $# -gt 0 ]; do
    case "$1" in
        --solo-comprobar) SOLO_COMPROBAR=1 ;;
        --doctor) DOCTOR=1 ;;
        --si) SI=1 ;;
        --pasos|--instancia-url|--token|--marketplace|--carpeta)
            if [ $# -lt 2 ]; then echo "Falta el valor de $1."; exit 2; fi
            case "$1" in
                --pasos) PASOS="$2" ;;
                --instancia-url) INSTANCIA_URL="$2" ;;
                --token) TOKEN="$2" ;;
                --marketplace) MARKETPLACE="$2" ;;
                --carpeta) CARPETA="$2" ;;
            esac
            shift ;;
        *) echo "Opción desconocida: $1 (usa --solo-comprobar, --doctor, --si, --pasos, --instancia-url, --token, --carpeta o --marketplace)"; exit 2 ;;
    esac
    shift
done

FICHEROS_PLUGIN="scripts/comun.sh scripts/doctor.sh scripts/comprobar-instancia.mjs scripts/ajustes-claude.mjs scripts/node-parcheado.mjs scripts/comprobar-python.py scripts/requisitos-python.txt"
CARPETA_TEMPORAL=""
PLUGIN=""
CODIGO=1
trap '[ -n "$CARPETA_TEMPORAL" ] && rm -rf "$CARPETA_TEMPORAL"' EXIT

# Desde una copia del repo usa sus ficheros; si el instalador llega suelto, baja los que necesita.
preparar_plugin() {
    local yo="${BASH_SOURCE[0]}" f
    if [ -n "$yo" ] && [ -f "$yo" ] && [ -f "$(dirname "$yo")/plugins/drazo-studio/scripts/comun.sh" ]; then
        PLUGIN="$(cd "$(dirname "$yo")/plugins/drazo-studio" && pwd)"
        return 0
    fi
    CARPETA_TEMPORAL="$(mktemp -d "${TMPDIR:-/tmp}/drazo-studio-instalador.XXXXXX")" || return 1
    # En Mac $TMPDIR (/var/folders) es un enlace a /private/var/folders: se trabaja con la ruta real
    CARPETA_TEMPORAL="$(cd "$CARPETA_TEMPORAL" && pwd -P)" || return 1
    PLUGIN="$CARPETA_TEMPORAL/plugin"
    for f in $FICHEROS_PLUGIN; do
        mkdir -p "$PLUGIN/$(dirname "$f")"
        if ! curl -fsSL "$URL_BASE_PLUGIN/plugins/drazo-studio/$f" -o "$PLUGIN/$f"; then
            echo "No pude descargar $f desde $URL_BASE_PLUGIN"
            return 1
        fi
    done
}

# Con --si no pregunta (el permiso se pidió en el chat). Sin --si lee de la terminal aunque llegue por tubería.
preguntar() {
    local defecto="${2:-s}" sufijo="[S/n]" r
    [ "$SI" = "1" ] && return 0
    [ "$defecto" = "n" ] && sufijo="[s/N]"
    while true; do
        printf '%s %s ' "$1" "$sufijo" > /dev/tty
        IFS= read -r r < /dev/tty || r=""
        r="$(printf '%s' "$r" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
        case "$r" in
            "") [ "$defecto" = "s" ]; return ;;
            s|si|sí|y|yes) return 0 ;;
            n|no) return 1 ;;
        esac
    done
}

# entorno.sh solo lleva rutas (node, ffmpeg y uv de Drazo Studio). Lo carga ~/.zshenv, que lee todo zsh (también
# la terminal de Claude), y ~/.zshrc, que lo vuelve a cargar después del path_helper de macOS.
asegurar_entorno() {
    local perfil linea='[ -f "$HOME/.local/share/drazo-studio/entorno.sh" ] && . "$HOME/.local/share/drazo-studio/entorno.sh"'
    mkdir -p "$COS_DATOS"
    {
        printf '# Entorno de Drazo Studio: lo escribe el instalador de Drazo Studio.\n'
        printf '_cos="${CONTENT_OS_DATOS:-$HOME/.local/share/drazo-studio}"\n'
        printf 'for _d in "$_cos/uv" "$_cos/nodejs/bin" "$_cos/ffmpeg"; do\n'
        printf '    case ":$PATH:" in *":$_d:"*) ;; *) [ -d "$_d" ] && PATH="$_d:$PATH" ;; esac\n'
        printf 'done\nunset _d _cos\nexport PATH\n'
    } > "$COS_ENTORNO"
    for perfil in "$HOME/.zshenv" "$HOME/.zshrc" "$HOME/.bash_profile"; do
        if [ "$perfil" = "$HOME/.bash_profile" ] && [ ! -f "$perfil" ]; then continue; fi
        grep -qF '.local/share/drazo-studio/entorno.sh' "$perfil" 2>/dev/null && continue
        printf '\n# Drazo Studio\n%s\n' "$linea" >> "$perfil"
    done
    cargar_rutas_cos
}

# Descarga a un fichero y comprueba su SHA-256; si no coincide, lo borra y falla.
descargar_verificado() {
    local url="$1" destino="$2" esperado="$3" real
    curl -fL --retry 2 -o "$destino" "$url" || return 1
    real="$(shasum -a 256 "$destino" | awk '{ print $1 }')"
    if [ "$real" != "$esperado" ]; then echo "La huella SHA-256 de $(basename "$destino") no coincide: no se instala."; rm -f "$destino"; return 1; fi
}

# git llega con las herramientas de desarrollo de Apple: macOS abre su ventana y la persona pulsa «Instalar».
# Se espera como mucho 9 minutos (las órdenes de Claude en primer plano se cortan a los 10).
instalar_git() {
    local espera=0
    tiene_clt && return 0
    xcode-select --install >/dev/null 2>&1
    echo "Se ha abierto una ventana de Apple para instalar las herramientas de desarrollo: hay que pulsar «Instalar»."
    while [ "$espera" -lt 540 ]; do
        sleep 15; espera=$((espera + 15))
        tiene_clt && return 0
    done
    echo "Aún se están instalando. Cuando termine la ventana de Apple, repite este paso."
    return 4
}

# Siempre la última 24.x de nodejs.org, con su SHA-256 de SHASUMS256.txt. Si esa huella no se puede leer, la
# versión de respaldo, con la suya fijada en comun.sh: nunca se instala un Node sin comprobar.
instalar_node() {
    local arq v tar sha tmp
    arq="$(arquitectura)"; [ "$arq" = "arm64" ] || arq="x64"
    v="$(version_node_a_instalar)"
    tar="node-v$v-darwin-$arq.tar.gz"
    sha="$(huella_node "$v" "$tar")"
    if [ -z "$sha" ]; then
        echo "No pude leer la huella SHA-256 de Node.js $v: instalo la $VERSION_NODE_RESPALDO."
        v="$VERSION_NODE_RESPALDO"; tar="node-v$v-darwin-$arq.tar.gz"; sha="$(huella_node "$v" "$tar")"
    fi
    tmp="$(mktemp -d)"
    echo "Descargando Node.js $v (oficial de nodejs.org)..."
    descargar_verificado "$URL_NODE_DIST/v$v/$tar" "$tmp/$tar" "$sha" || { rm -rf "$tmp"; return 1; }
    rm -rf "$COS_NODEJS" && mkdir -p "$COS_NODEJS"
    tar -xzf "$tmp/$tar" -C "$COS_NODEJS" --strip-components 1
    rm -rf "$tmp"
    asegurar_entorno
}

# ffmpeg y ffprobe 9.0.2 estáticos de ffmpeg.martin-riedl.de; descargados con curl, que no les pone la marca
# de cuarentena, así que macOS no los bloquea.
instalar_ffmpeg() {
    local arq url sha_ffmpeg sha_ffprobe tmp
    arq="$(arquitectura)"
    if [ "$arq" = "arm64" ]; then url="$URL_FFMPEG_ARM64"; sha_ffmpeg="$SHA256_FFMPEG_ARM64"; sha_ffprobe="$SHA256_FFPROBE_ARM64"
    else url="$URL_FFMPEG_X86_64"; sha_ffmpeg="$SHA256_FFMPEG_X86_64"; sha_ffprobe="$SHA256_FFPROBE_X86_64"; fi
    tmp="$(mktemp -d)"
    echo "Descargando ffmpeg 9.0.2 (unos 60 MB)..."
    descargar_verificado "$url/ffmpeg.zip" "$tmp/ffmpeg.zip" "$sha_ffmpeg" || { rm -rf "$tmp"; return 1; }
    descargar_verificado "$url/ffprobe.zip" "$tmp/ffprobe.zip" "$sha_ffprobe" || { rm -rf "$tmp"; return 1; }
    mkdir -p "$COS_FFMPEG"
    ditto -x -k "$tmp/ffmpeg.zip" "$COS_FFMPEG" && ditto -x -k "$tmp/ffprobe.zip" "$COS_FFMPEG"
    chmod +x "$COS_FFMPEG/ffmpeg" "$COS_FFMPEG/ffprobe"
    rm -rf "$tmp"
    asegurar_entorno
}

# uv trae el Python 3.12 del entorno de Drazo Studio, sin contraseña.
instalar_python() {
    local arq tar sha tmp
    arq="$(arquitectura)"
    if [ "$arq" = "arm64" ]; then tar="uv-aarch64-apple-darwin.tar.gz"; sha="$SHA256_UV_ARM64"; else tar="uv-x86_64-apple-darwin.tar.gz"; sha="$SHA256_UV_X86_64"; fi
    tmp="$(mktemp -d)"
    echo "Descargando uv $VERSION_UV..."
    descargar_verificado "https://github.com/astral-sh/uv/releases/download/$VERSION_UV/$tar" "$tmp/$tar" "$sha" || { rm -rf "$tmp"; return 1; }
    mkdir -p "$COS_UV"
    tar -xzf "$tmp/$tar" -C "$COS_UV" --strip-components 1
    rm -rf "$tmp"
    asegurar_entorno
}

instalar_venv() {
    local uv; uv="$(command -v uv 2>/dev/null)"
    mkdir -p "$COS_DATOS"
    if [ -n "$uv" ]; then
        export UV_PYTHON_INSTALL_DIR="$COS_DATOS/python" UV_CACHE_DIR="$COS_DATOS/uv-cache"
        if [ ! -x "$COS_PYTHON" ] || ! "$COS_PYTHON" -c 'import sys' >/dev/null 2>&1; then
            echo "Creando el entorno con Python 3.12 (uv)..."
            "$uv" venv --clear --seed --python 3.12 "$COS_VENV" || return 1
        fi
        echo "Instalando los paquetes de Python de Drazo Studio (tarda unos minutos)..."
        "$uv" pip install --python "$COS_PYTHON" -r "$REQUISITOS_PYTHON"
        return
    fi
    buscar_python_base
    if [ -z "$PY_BASE_EXE" ]; then echo "Falta uv (paso python)."; return 1; fi
    if [ ! -x "$COS_PYTHON" ] || ! "$COS_PYTHON" -c 'import sys' >/dev/null 2>&1; then "$PY_BASE_EXE" -m venv --clear "$COS_VENV" || return 1; fi
    "$COS_PYTHON" -m pip install --disable-pip-version-check --upgrade pip
    "$COS_PYTHON" -m pip install --disable-pip-version-check -r "$REQUISITOS_PYTHON"
}

instalar_modelo() {
    if [ ! -x "$COS_PYTHON" ]; then echo "Falta el entorno de Python de Drazo Studio (paso venv)."; return 1; fi
    echo "Descargando el modelo de transcripción large-v3-turbo (unos 1,6 GB; tarda según la conexión)..."
    "$COS_PYTHON" -c "from faster_whisper import download_model; download_model('large-v3-turbo')"
}

# playwright-core con la versión fijada y solo su chromium-headless-shell («install chromium --only-shell» es lo
# mismo): un «install --only-shell» a secas bajaría también Firefox y WebKit. Se llama a su cli.js para no depender de npx.
instalar_playwright() {
    command -v npm >/dev/null 2>&1 || { echo "Falta Node.js (paso node)."; return 1; }
    mkdir -p "$COS_NODE"
    npm install --prefix "$COS_NODE" --no-audit --no-fund --save-exact "playwright-core@$VERSION_PLAYWRIGHT" || return 1
    echo "Descargando el navegador sin ventana de Playwright (unos 150 MB)..."
    PLAYWRIGHT_BROWSERS_PATH="$COS_NAVEGADORES" node "$COS_NODE/node_modules/playwright-core/cli.js" install chromium-headless-shell
}

ajustes_claude() {
    command -v node >/dev/null 2>&1 || { echo "Falta Node.js (paso node)."; return 1; }
    local registro codigo
    registro="$(mktemp)"
    node "$AJUSTES_SCRIPT" "$@" 2>&1 | tee "$registro"
    codigo=${PIPESTATUS[0]}
    # Si termina bien sin escribir nada es que no llegó a ejecutarse: que no pase en silencio
    if [ "$codigo" -eq 0 ] && [ ! -s "$registro" ]; then
        echo "Los ajustes de Claude no se han aplicado: $AJUSTES_SCRIPT terminó sin hacer nada."
        codigo=1
    fi
    rm -f "$registro"
    estado_ajustes --renovar
    return "$codigo"
}

instalar_claude() {
    echo "Instalando Claude Code (la orden claude) con el instalador oficial de Anthropic..."
    curl -fsSL https://claude.ai/install.sh | bash
    export PATH="$HOME/.local/bin:$PATH"
}

pedir_instancia() {
    local intento url
    for intento in 1 2 3; do
        printf 'Pega la dirección de tu Drazo Studio (por ejemplo, https://mi-drazo-studio.vercel.app) y pulsa Intro: ' > /dev/tty
        IFS= read -r url < /dev/tty || url=""
        url="$(printf '%s' "$url" | tr -d '[:space:]')"
        [ -z "$url" ] && return 0
        case "$url" in https://?*) printf '%s' "$url"; return 0 ;; esac
        echo "Eso no parece la dirección de tu app: tiene que empezar por https://. Prueba otra vez." > /dev/tty
    done
}

pedir_token() {
    local intento clave
    for intento in 1 2 3; do
        printf 'Pega el token de conexión de tu Drazo Studio y pulsa Intro: ' > /dev/tty
        IFS= read -r -s clave < /dev/tty || clave=""
        echo "" > /dev/tty
        clave="$(printf '%s' "$clave" | tr -d '[:space:]')"
        [ -z "$clave" ] && return 0
        case "$clave" in ????????*) printf '%s' "$clave"; return 0 ;; esac
        echo "Ese token es demasiado corto. Prueba otra vez." > /dev/tty
    done
}

# Lo que no se puede arreglar ni preguntando: escribe el problema en una frase, o nada si todo va bien. Con --si no
# hay a quién preguntar, así que además falta lo que no esté ni en las opciones ni ya guardado.
validar_registro() {
    local hay_url=0 hay_token=0
    estado_ajustes
    if [ -n "$INSTANCIA_URL" ]; then
        case "$INSTANCIA_URL" in
            https://?*|http://localhost*|http://127.0.0.1*) ;;
            *) echo "la dirección tiene que empezar por https:// (opción --instancia-url)"; return ;;
        esac
    fi
    if [ -n "$TOKEN" ]; then
        case "$TOKEN" in
            *[[:space:]]*) echo "el token lleva espacios (opción --token)"; return ;;
            ????????*) ;;
            *) echo "el token es demasiado corto (opción --token)"; return ;;
        esac
    fi
    [ "$SI" = "1" ] || return 0
    { [ -n "$INSTANCIA_URL" ] || [ "${AJ_instancia:-}" = "si" ]; } && hay_url=1
    { [ -n "$TOKEN" ] || [ "${AJ_token:-}" = "si" ]; } && hay_token=1
    if [ "$hay_url" = "0" ] && [ "$hay_token" = "0" ]; then echo "no hay dirección ni token de tu app; pásalos con --instancia-url https://... y --token ..."; return; fi
    if [ "$hay_url" = "0" ]; then echo "no hay dirección de tu app; pásala con --instancia-url https://..."; return; fi
    if [ "$hay_token" = "0" ]; then echo "no hay token de tu app; pásalo con --token ..."; return; fi
}

# Marketplace, plugin, dirección y token en los ajustes de Claude (settings.json, con copia de seguridad) y el plugin
# descargado con la orden claude. Con --carpeta, comprueba que existe tu carpeta de trabajo (no escribe nada en ella).
instalar_registrar() {
    local url="$INSTANCIA_URL" clave="$TOKEN" c
    estado_ajustes
    if [ "$SI" != "1" ]; then
        [ -z "$url" ] && [ "${AJ_instancia:-}" != "si" ] && url="$(pedir_instancia)"
        [ -z "$clave" ] && [ "${AJ_token:-}" != "si" ] && clave="$(pedir_token)"
    fi
    set -- registrar
    [ -n "$url" ] && set -- "$@" --instancia-url "$url"
    [ -n "$clave" ] && set -- "$@" --token "$clave"
    [ -n "$MARKETPLACE" ] && set -- "$@" --fuente-local "$MARKETPLACE"
    ajustes_claude "$@" || return 1
    # La app no siempre baja el plugin al reabrirse: se descarga e instala ya con la orden claude
    c="$(ruta_claude)"
    if [ -z "$c" ]; then instalar_claude || return 1; c="$(ruta_claude)"; fi
    if [ -z "$c" ]; then echo "No encuentro la orden claude para descargar Drazo Studio."; return 1; fi
    set -- instalar-plugin --claude "$c"
    [ -n "$MARKETPLACE" ] && set -- "$@" --fuente-local "$MARKETPLACE"
    ajustes_claude "$@" || return 1
    if [ -n "$CARPETA" ]; then ajustes_claude carpeta --ruta "$CARPETA" || return 1; fi
}

texto_paso() {
    case "$1" in
        git) echo "Instalo git (herramientas de desarrollo de Apple; Claude lo usa para descargar Drazo Studio)" ;;
        node) echo "Instalo Node.js $RAMA_NODE (la última, con sus parches de seguridad) en la carpeta de Drazo Studio" ;;
        claude) echo "Instalo Claude Code (la orden claude)" ;;
        ffmpeg) echo "Instalo ffmpeg (el programa que saca el audio y las imágenes de los reels) en la carpeta de Drazo Studio" ;;
        python) echo "Instalo uv, que trae el Python de Drazo Studio" ;;
        venv) echo "Creo el entorno de Python de Drazo Studio (transcribir y bajar reels; tarda varios minutos)" ;;
        modelo) echo "Descargo el modelo de transcripción large-v3-turbo (unos 1,6 GB)" ;;
        playwright) echo "Instalo playwright-core y su navegador sin ventana, solo para Drazo Studio (unos 150 MB)" ;;
        registrar) echo "Registro Drazo Studio en Claude y guardo la dirección y el token de tu app" ;;
    esac
}

PASOS_VALIDOS="git node claude ffmpeg python venv modelo playwright registrar"

comprobar_paso() {
    case "$1" in
        venv) comprobar_venv ;;
        registrar) comprobar_registro ;;
        *) "comprobar_$1" ;;
    esac
}

# Un paso está hecho si no falta nada; Node (sin el último parche es un aviso), playwright (otra versión es un
# aviso) y el registro (aún sin descargar es un aviso) solo si están del todo bien.
# $2: el estado que mirar (por defecto, el de la última comprobación).
esta_hecho() {
    case "$1" in
        node|playwright|registrar) [ "${2:-$RES_ESTADO}" = "ok" ] ;;
        *) [ "${2:-$RES_ESTADO}" != "falta" ] ;;
    esac
}

principal() {
    local id v lista="" codigo hechos="" ya="" fallan="" omitidos="" pendientes="" uso_malo=0 explicitos="" forzar problema
    echo ""
    echo "${C_CIAN}Drazo Studio · instalador para macOS${C_FIN}"
    echo "Drazo Studio funciona con Claude Code (o la app de escritorio de Claude) y una suscripción de pago a Claude."
    [ "$SOLO_COMPROBAR" = "1" ] && echo "${C_AMARILLO}Modo solo comprobar: no se instala ni se cambia nada.${C_FIN}"
    echo ""
    cargar_rutas_cos
    for id in $COMPROBACIONES_COS; do
        comprobar "$id"
        printf -v "ESTADO_$id" '%s' "$RES_ESTADO"
    done
    if [ "$ESTADO_sistema" = "falta" ]; then echo "${C_ROJO}Este equipo no cumple el mínimo para Drazo Studio.${C_FIN}"; CODIGO=3; return; fi
    comprobar_registro
    ESTADO_registrar="$RES_ESTADO"

    if [ -n "$PASOS" ]; then
        lista="$(printf '%s' "$PASOS" | tr ',' ' ')"
        for id in $lista; do
            case " $PASOS_VALIDOS " in *" $id "*) ;; *) echo "Pasos desconocidos: $id. Válidos: $PASOS_VALIDOS"; CODIGO=2; return ;; esac
        done
        explicitos=" $lista "
    else
        for id in $PASOS_VALIDOS; do
            [ "$id" = "registrar" ] && continue
            v="ESTADO_$id"
            esta_hecho "$id" "${!v}" || lista="$lista $id"
        done
        if [ -n "$INSTANCIA_URL" ] || [ -n "$TOKEN" ] || ! esta_hecho registrar "$ESTADO_registrar"; then lista="$lista registrar"; fi
    fi

    if [ "$SOLO_COMPROBAR" = "1" ]; then
        if [ -n "$lista" ]; then
            echo ""
            echo "${C_CIAN}Esto haría el instalador, paso a paso:${C_FIN}"
            for id in $lista; do echo "  - [$id] $(texto_paso "$id")"; done
        fi
        mostrar_arreglos
        if hay_faltas_obligatorias; then CODIGO=1; else CODIGO=0; fi
        return
    fi

    for id in $lista; do
        echo ""
        echo "${C_CIAN}== [$id] $(texto_paso "$id")${C_FIN}"
        comprobar_paso "$id"
        # El registro se repite siempre que se pide a propósito (--pasos registrar) o con datos nuevos: también es
        # la forma de actualizar el plugin.
        forzar=0
        if [ "$id" = "registrar" ] && { [ -n "$INSTANCIA_URL" ] || [ -n "$TOKEN" ] || [[ "$explicitos" == *" registrar "* ]]; }; then forzar=1; fi
        if esta_hecho "$id" && [ "$forzar" = "0" ]; then
            echo "-> [$id] ya estaba: $RES_DETALLE"; ya="$ya,$id"; continue
        fi
        if ! preguntar "¿$(texto_paso "$id")?"; then
            echo "-> [$id] omitido"; omitidos="$omitidos,$id"; continue
        fi
        if [ "$id" = "registrar" ]; then
            problema="$(validar_registro)"
            if [ -n "$problema" ]; then echo "-> [$id] falta: $problema"; fallan="$fallan,$id"; uso_malo=1; continue; fi
        fi
        "instalar_$id"; codigo=$?
        if [ "$codigo" = "4" ]; then echo "-> [$id] pendiente: esperando a la ventana de Apple; repite este paso cuando termine"; pendientes="$pendientes,$id"; continue; fi
        comprobar_paso "$id"
        if esta_hecho "$id"; then echo "-> [$id] ok: $RES_DETALLE"; hechos="$hechos,$id"
        elif [ "$codigo" != "0" ]; then echo "-> [$id] error: el paso terminó con el código $codigo. $RES_ARREGLO"; fallan="$fallan,$id"
        else echo "-> [$id] falta: $RES_DETALLE. $RES_ARREGLO"; fallan="$fallan,$id"; fi
    done
    echo ""
    echo "RESUMEN: hechos=${hechos#,}; ya estaban=${ya#,}; fallan=${fallan#,}; omitidos=${omitidos#,}; pendientes=${pendientes#,}"
    case ",$hechos," in
        *,git,*|*,node,*|*,ffmpeg,*|*,python,*|*,claude,*|*,registrar,*)
            echo "${C_CIAN}Para que Claude vea lo instalado y a Drazo Studio: cierra la app de Claude (o Claude Code) y vuelve a abrirla.${C_FIN}" ;;
    esac
    if [ "$SI" != "1" ]; then
        echo ""
        echo "${C_CIAN}== Comprobación final${C_FIN}"
        bash "$PLUGIN/scripts/doctor.sh"
        echo "${C_CIAN}Después abre Claude en tu carpeta de trabajo y escribe «Hola Drazo Studio».${C_FIN}"
    fi
    if [ "$uso_malo" = "1" ]; then CODIGO=2
    elif [ -n "$fallan" ]; then CODIGO=1
    elif [ -n "$pendientes" ]; then CODIGO=4
    else CODIGO=0; fi
}

preparar_plugin || exit 1
. "$PLUGIN/scripts/comun.sh"
if [ "$DOCTOR" = "1" ]; then bash "$PLUGIN/scripts/doctor.sh"; exit $?; fi
principal
exit "$CODIGO"
