# Doctor de Drazo Studio para Windows: comprueba el equipo, tu app y su licencia, y termina con la lista de lo
# que falta y cómo arreglarlo. No cambia nada.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File doctor.ps1
# Este fichero va en UTF-8 con BOM: sin BOM, PowerShell 5.1 rompe las tildes.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot 'comun.ps1')
# Lo recién instalado está en el registro aunque esta ventana (o la app de Claude) aún no lo vea.
Actualizar-Path

# Una sola petición a tu app sirve para las dos líneas («Tu Drazo Studio» y «Licencia»).
$script:Instancia = $null
function Leer-Instancia {
    if ($script:Instancia) { return $script:Instancia }
    $e = @{}
    $node = Buscar-Comando 'node'
    if (-not $node) {
        $e['instancia'] = 'sin-node'
    } else {
        foreach ($l in (Ejecutar $node @($InstanciaScript)).Lineas) {
            $i = $l.IndexOf('=')
            if ($i -gt 0) { $e[$l.Substring(0, $i)] = $l.Substring($i + 1) }
        }
        if (-not $e['instancia']) { $e['instancia'] = 'error'; $e['instancia_detalle'] = 'la comprobación no devolvió nada' }
    }
    $script:Instancia = $e
    $e
}

function Comprobar-Instancia {
    $nombre = 'Tu Drazo Studio'
    $e = Leer-Instancia
    $detalle = $e['instancia_detalle']
    switch ($e['instancia']) {
        'ok' { return Nuevo-Resultado 'instancia' $nombre 'ok' $detalle }
        'sin-node' { return Nuevo-Resultado 'instancia' $nombre 'falta' 'no se puede probar sin Node.js' 'Instala Node.js con el instalador de Drazo Studio y vuelve a pasar el doctor.' }
        'sin-config' { return Nuevo-Resultado 'instancia' $nombre 'falta' $detalle 'Guarda la dirección y el token de tu app con el paso «registrar» del instalador de Drazo Studio.' }
        'token' { return Nuevo-Resultado 'instancia' $nombre 'falta' $detalle 'El token guardado no es el de tu app. Vuelve a pasar el paso «registrar» del instalador con el token correcto.' }
        'red' { return Nuevo-Resultado 'instancia' $nombre 'falta' $detalle 'Comprueba tu conexión a internet y que la dirección de tu app es correcta. Si es la correcta, puede que tu app esté caída: prueba en un rato.' }
        default { return Nuevo-Resultado 'instancia' $nombre 'falta' $detalle "Si no se arregla en un rato, escribe al soporte de ProfimaxIA ($Soporte)." }
    }
}

function Comprobar-Licencia {
    $nombre = 'Licencia'
    $e = Leer-Instancia
    $detalle = $e['licencia_detalle']
    switch ($e['licencia']) {
        'ok' { return Nuevo-Resultado 'licencia' $nombre 'ok' $detalle }
        'error' { return Nuevo-Resultado 'licencia' $nombre 'falta' $detalle "Escribe al soporte de ProfimaxIA ($Soporte) con este mensaje." }
        default {
            $motivo = if ($detalle) { $detalle } else { 'no se puede saber' }
            return Nuevo-Resultado 'licencia' $nombre 'aviso' $motivo
        }
    }
}

Write-Host ''
Write-Host 'Drazo Studio · diagnóstico del equipo' -ForegroundColor Cyan
Write-Host "Carpeta de Drazo Studio: $CosDatos"
Write-Host "Ajustes de Claude: $(Join-Path (Carpeta-ConfigClaude) 'settings.json')"
Write-Host ''

$resultados = @()
foreach ($funcion in $ComprobacionesCos + 'Comprobar-Instancia' + 'Comprobar-Licencia') {
    $r = Ejecutar-Comprobacion $funcion
    Mostrar-Resultado $r
    $resultados += $r
}
Mostrar-Arreglos $resultados
Write-Host ''

$faltan = @($resultados | Where-Object { $_.Estado -eq 'falta' -and -not $_.Opcional })
if ($faltan.Count) { exit 1 }
exit 0
