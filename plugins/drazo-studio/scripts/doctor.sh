#!/bin/bash
# Doctor de Drazo Studio para macOS: comprueba el equipo, tu app y su licencia, y termina con la lista de lo
# que falta y cómo arreglarlo. No cambia nada.
# Uso: bash doctor.sh

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/comun.sh"
cargar_rutas_cos

# Una sola petición a tu app sirve para las dos líneas («Tu Drazo Studio» y «Licencia»).
INST_LEIDA=0
INST_instancia=""; INST_instancia_detalle=""; INST_licencia=""; INST_licencia_detalle=""
leer_instancia() {
    [ "$INST_LEIDA" = "1" ] && return 0
    local salida linea clave
    INST_LEIDA=1
    if ! command -v node >/dev/null 2>&1; then INST_instancia="sin-node"; return 0; fi
    salida="$(node "$INSTANCIA_SCRIPT" 2>/dev/null)"
    while IFS= read -r linea; do
        clave="${linea%%=*}"
        case "$clave" in
            instancia|instancia_detalle|licencia|licencia_detalle) printf -v "INST_$clave" '%s' "${linea#*=}" ;;
        esac
    done <<< "$salida"
    if [ -z "$INST_instancia" ]; then INST_instancia="error"; INST_instancia_detalle="la comprobación no devolvió nada"; fi
}

comprobar_instancia() {
    local nombre="Tu Drazo Studio"
    leer_instancia
    case "$INST_instancia" in
        ok) resultado instancia "$nombre" ok "$INST_instancia_detalle" ;;
        sin-node) resultado instancia "$nombre" falta "no se puede probar sin Node.js" "Instala Node.js con el instalador de Drazo Studio y vuelve a pasar el doctor." ;;
        sin-config) resultado instancia "$nombre" falta "$INST_instancia_detalle" "Guarda la dirección y el token de tu app con el paso «registrar» del instalador de Drazo Studio." ;;
        token) resultado instancia "$nombre" falta "$INST_instancia_detalle" "El token guardado no es el de tu app. Vuelve a pasar el paso «registrar» del instalador con el token correcto." ;;
        red) resultado instancia "$nombre" falta "$INST_instancia_detalle" "Comprueba tu conexión a internet y que la dirección de tu app es correcta. Si es la correcta, puede que tu app esté caída: prueba en un rato." ;;
        *) resultado instancia "$nombre" falta "$INST_instancia_detalle" "Si no se arregla en un rato, escribe al soporte de ProfimaxIA ($SOPORTE)." ;;
    esac
}

comprobar_licencia() {
    local nombre="Licencia"
    leer_instancia
    case "$INST_licencia" in
        ok) resultado licencia "$nombre" ok "$INST_licencia_detalle" ;;
        error) resultado licencia "$nombre" falta "$INST_licencia_detalle" "Escribe al soporte de ProfimaxIA ($SOPORTE) con este mensaje." ;;
        *) resultado licencia "$nombre" aviso "${INST_licencia_detalle:-no se puede saber}" ;;
    esac
}

echo ""
echo "${C_CIAN}Drazo Studio · diagnóstico del equipo${C_FIN}"
echo "Carpeta de Drazo Studio: $COS_DATOS"
echo "Ajustes de Claude: $(carpeta_config_claude)/settings.json"
echo ""
for id in $COMPROBACIONES_COS instancia licencia; do
    comprobar "$id"
done
mostrar_arreglos
echo ""
if hay_faltas_obligatorias; then exit 1; fi
exit 0
