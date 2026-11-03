#!/bin/bash
# Pruebas de la versión de Node que elige el instalador de Mac (comun.sh), con un index.json real recortado
# de nodejs.org (fixtures/nodejs-dist). Sin red y sin instalar nada.
# Uso: bash tests/instalador-node.test.sh
raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixtures="$raiz/tests/fixtures/nodejs-dist"
# Carpeta de datos de pruebas: comun.sh solo define rutas, pero así nada apunta a la de verdad
export CONTENT_OS_DATOS="${TMPDIR:-/tmp}/drazo-studio-pruebas-node-no-se-crea"
# shellcheck source=../plugins/drazo-studio/scripts/comun.sh
. "$raiz/plugins/drazo-studio/scripts/comun.sh"

fallos=0
igual() {
    if [ "$2" = "$3" ]; then echo "ok    $1"; else echo "FALLA $1: esperaba «$3» y sale «$2»"; fallos=$((fallos + 1)); fi
}

# curl lee file:// con ruta de Windows en Git Bash (C:/...) y con la normal en Mac
ruta="$fixtures"
command -v cygpath >/dev/null 2>&1 && ruta="/$(cygpath -m "$fixtures")"
CON_RED="file://$ruta"
SIN_RED="http://127.0.0.1:9"
RESPALDO_REAL="$VERSION_NODE_RESPALDO"

igual "rama 24 de index.json" "$(elegir_version_node 24 < "$fixtures/index.json")" "24.22.1"
igual "rama 22 de index.json" "$(elegir_version_node 22 < "$fixtures/index.json")" "22.23.4"
igual "rama 20 de index.json" "$(elegir_version_node 20 < "$fixtures/index.json")" "20.20.2"
igual "rama que no está" "$(elegir_version_node 18 < "$fixtures/index.json")" ""

# Con un respaldo inventado, para distinguir lo que sale de index.json de lo que sale del respaldo
VERSION_NODE_RESPALDO="24.9.9"
URL_NODE_DIST="$CON_RED"
igual "instala la última 24 publicada" "$(version_node_a_instalar)" "24.22.1"
URL_NODE_DIST="$SIN_RED"
igual "sin red, la de respaldo" "$(version_node_a_instalar)" "24.9.9"
VERSION_NODE_RESPALDO="24.30.0"
URL_NODE_DIST="$CON_RED"
igual "index.json más viejo que el respaldo, el respaldo" "$(version_node_a_instalar)" "24.30.0"

VERSION_NODE_RESPALDO="$RESPALDO_REAL"
URL_NODE_DIST="$SIN_RED"
igual "sin red, el respaldo de verdad" "$(version_node_a_instalar)" "24.22.1"
igual "huella fijada (arm64) = SHASUMS256.txt oficial" "$(huella_node 24.22.1 node-v24.22.1-darwin-arm64.tar.gz)" \
    "$(awk '$2 == "node-v24.22.1-darwin-arm64.tar.gz" { print $1 }' "$fixtures/v24.22.1/SHASUMS256.txt")"
igual "huella fijada (x64) = SHASUMS256.txt oficial" "$(huella_node 24.22.1 node-v24.22.1-darwin-x64.tar.gz)" \
    "$(awk '$2 == "node-v24.22.1-darwin-x64.tar.gz" { print $1 }' "$fixtures/v24.22.1/SHASUMS256.txt")"

VERSION_NODE_RESPALDO="24.9.9"
URL_NODE_DIST="$CON_RED"
igual "huella de otra versión, de su SHASUMS256.txt" "$(huella_node 24.22.1 node-v24.22.1-darwin-x64.tar.gz)" \
    "d132557e7ee2b85af08b0c8c34338e65c6430f2238d01f727728ef42dc83b035"
igual "fichero que no está en SHASUMS256.txt" "$(huella_node 24.22.1 node-v24.22.1-darwin-arm64.tar.xz)" ""
URL_NODE_DIST="$SIN_RED"
igual "sin red y sin huella fijada, nada" "$(huella_node 24.22.1 node-v24.22.1-darwin-x64.tar.gz)" ""

echo ""
if [ "$fallos" -eq 0 ]; then echo "Todas las pruebas pasan."; exit 0; fi
echo "$fallos pruebas fallan."
exit 1
