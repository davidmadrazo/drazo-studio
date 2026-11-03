# Pruebas de las comprobaciones de Windows (comun.ps1) y de los caminos seguros del instalador (instalar.ps1),
# todo en carpetas temporales con datos de mentira: no instala nada, no toca la carpeta de datos ni los ajustes de
# Claude de verdad y, por si acaso, pone una orden «claude» falsa la primera en el PATH (no debe recibir «plugin ...»).
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File tests\comprobaciones.tests.ps1
# Este fichero va en UTF-8 con BOM: sin BOM, PowerShell 5.1 rompe las tildes.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$raiz = Split-Path $PSScriptRoot -Parent
$temp = Join-Path ([IO.Path]::GetTempPath()) ('drazo-studio-pruebas-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $temp | Out-Null
$nombresEntorno = 'CONTENT_OS_DATOS', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_PLUGIN_CACHE_DIR', 'Path'
$entornoPrevio = @{}
foreach ($n in $nombresEntorno) { $entornoPrevio[$n] = [Environment]::GetEnvironmentVariable($n) }

$script:Fallos = 0
function Igual([string]$Nombre, $Sale, $Espera) {
    if ("$Sale" -eq "$Espera") { Write-Host "ok    $Nombre" }
    else { Write-Host "FALLA $Nombre`: esperaba «$Espera» y sale «$Sale»"; $script:Fallos++ }
}
function Contiene([string]$Nombre, [string]$Texto, [string]$Trozo) {
    if ($Texto.Contains($Trozo)) { Write-Host "ok    $Nombre" }
    else { Write-Host "FALLA $Nombre`: no aparece «$Trozo» en «$Texto»"; $script:Fallos++ }
}
function No-Contiene([string]$Nombre, [string]$Texto, [string]$Trozo) {
    if (-not $Texto.Contains($Trozo)) { Write-Host "ok    $Nombre" }
    else { Write-Host "FALLA $Nombre`: no debería aparecer «$Trozo»"; $script:Fallos++ }
}

try {
    # Una orden claude falsa que apunta lo que se le pide: ninguna prueba debería llegar a usarla
    $carpetaFalsa = Join-Path $temp 'falsa'
    New-Item -ItemType Directory -Force $carpetaFalsa | Out-Null
    $registroFalso = Join-Path $temp 'claude-llamado.txt'
    Set-Content -LiteralPath (Join-Path $carpetaFalsa 'claude.cmd') -Value "@echo off`r`necho %* >> `"$registroFalso`"`r`nexit /b 0" -Encoding Ascii
    $env:Path = "$carpetaFalsa;$($entornoPrevio['Path'])"

    $env:CONTENT_OS_DATOS = Join-Path $temp 'datos'
    $env:CLAUDE_CONFIG_DIR = Join-Path $temp 'claude'
    $env:CLAUDE_CODE_PLUGIN_CACHE_DIR = Join-Path $temp 'plugins'
    New-Item -ItemType Directory -Force $env:CLAUDE_CONFIG_DIR | Out-Null
    . (Join-Path $raiz 'plugins\drazo-studio\scripts\comun.ps1')
    $ajustesJson = Join-Path $env:CLAUDE_CONFIG_DIR 'settings.json'

    function Vaciar-Datos {
        if (-not $CosDatos.StartsWith($temp)) { throw "se negó a borrar ${CosDatos}: no está en la carpeta temporal" }
        Remove-Item -LiteralPath $CosDatos -Recurse -Force -ErrorAction SilentlyContinue
    }
    function Vaciar-Ajustes {
        Remove-Item -LiteralPath $ajustesJson -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $env:CLAUDE_CODE_PLUGIN_CACHE_DIR -Recurse -Force -ErrorAction SilentlyContinue
        Estado-Ajustes -Renovar | Out-Null
    }

    # --- Rutas ---
    Write-Host '== Rutas'
    Igual 'datos con CONTENT_OS_DATOS' $CosDatos (Join-Path $temp 'datos')
    Igual 'venv dentro de datos' $CosVenv (Join-Path $CosDatos 'venv')
    Igual 'python del venv' $CosPython (Join-Path $CosDatos 'venv\Scripts\python.exe')
    Igual 'node_modules en datos\node' $CosNode (Join-Path $CosDatos 'node')
    Igual 'navegadores en datos\ms-playwright' $CosNavegadores (Join-Path $CosDatos 'ms-playwright')
    Igual 'ffmpeg en datos\ffmpeg' $CosFfmpeg (Join-Path $CosDatos 'ffmpeg')
    Igual 'playwright fijado' $VersionPlaywright '1.64.1'
    Igual 'disco mínimo' $DiscoMinimoGB 4
    $conOtra = $env:CONTENT_OS_DATOS
    $env:CONTENT_OS_DATOS = $null
    . (Join-Path $raiz 'plugins\drazo-studio\scripts\comun.ps1')
    Igual 'datos por defecto' $CosDatos (Join-Path $env:LOCALAPPDATA 'DrazoStudio')
    $env:CONTENT_OS_DATOS = $conOtra
    . (Join-Path $raiz 'plugins\drazo-studio\scripts\comun.ps1')
    Igual 'requisitos de Python' ((Get-Content -LiteralPath $RequisitosPython | Where-Object { $_ -and -not $_.StartsWith('#') }) -join ',') 'faster-whisper,numpy,yt-dlp'

    # --- playwright-core y su navegador ---
    Write-Host '== playwright'
    function Nuevo-PlaywrightFalso([string]$Version, [string]$Pide = '1248', [string]$Descargada = '1248', [switch]$SinMarca) {
        Vaciar-Datos
        $pc = Join-Path $CosNode 'node_modules\playwright-core'
        New-Item -ItemType Directory -Force $pc | Out-Null
        Set-Content -LiteralPath (Join-Path $pc 'package.json') -Value "{ `"name`": `"playwright-core`", `"version`": `"$Version`" }" -Encoding UTF8
        $json = '{ "comment": "x", "browsers": [ { "name": "chromium", "revision": "' + $Pide + '" }, { "name": "chromium-headless-shell", "revision": "' + $Pide + '" }, { "name": "firefox", "revision": "9" } ] }'
        Set-Content -LiteralPath (Join-Path $pc 'browsers.json') -Value $json -Encoding UTF8
        if ($Descargada) {
            $d = Join-Path $CosNavegadores "chromium_headless_shell-$Descargada"
            $s = Join-Path $d 'chrome-headless-shell-win64'
            New-Item -ItemType Directory -Force $s | Out-Null
            Set-Content -LiteralPath (Join-Path $s 'chrome-headless-shell.exe') -Value 'x'
            if (-not $SinMarca) { Set-Content -LiteralPath (Join-Path $d 'INSTALLATION_COMPLETE') -Value '' }
        }
    }
    Vaciar-Datos
    $r = Comprobar-Playwright
    Igual 'sin playwright-core: falta' $r.Estado 'falta'
    Nuevo-PlaywrightFalso '1.64.1'
    $r = Comprobar-Playwright
    Igual 'versión fijada y navegador: ok' $r.Estado 'ok'
    Contiene 'dice la versión y la revisión' $r.Detalle 'playwright-core 1.64.1 · chrome-headless-shell 1248'
    Nuevo-PlaywrightFalso '1.60.0'
    $r = Comprobar-Playwright
    Igual 'otra versión de playwright-core: aviso' $r.Estado 'aviso'
    Contiene 'el aviso dice cuál usa Drazo Studio' $r.Detalle '1.60.0 (Drazo Studio usa la 1.64.1)'
    Nuevo-PlaywrightFalso '1.64.1' -Descargada ''
    $r = Comprobar-Playwright
    Igual 'sin navegador: falta' $r.Estado 'falta'
    Contiene 'dice que falta el navegador' $r.Detalle 'falta su navegador sin ventana'
    Nuevo-PlaywrightFalso '1.64.1' -Pide '1248' -Descargada '1100'
    Igual 'navegador de otra revisión: falta' (Comprobar-Playwright).Estado 'falta'
    Nuevo-PlaywrightFalso '1.64.1' -SinMarca
    Igual 'descarga a medias (sin INSTALLATION_COMPLETE): falta' (Comprobar-Playwright).Estado 'falta'
    Vaciar-Datos
    Igual 'sin entorno de Python: falta' (Comprobar-Entorno).Estado 'falta'
    Igual 'sin entorno no se puede mirar el modelo: falta' (Comprobar-Modelo).Estado 'falta'

    # --- ffmpeg: manda el de la carpeta de Drazo Studio ---
    Write-Host '== ffmpeg'
    New-Item -ItemType Directory -Force $CosFfmpeg | Out-Null
    Set-Content -LiteralPath (Join-Path $CosFfmpeg 'ffmpeg.exe') -Value 'no es un programa'
    Set-Content -LiteralPath (Join-Path $CosFfmpeg 'ffprobe.exe') -Value 'no es un programa'
    Igual 'usa los de datos\ffmpeg antes que los del PATH' (Ruta-Binario 'ffmpeg') (Join-Path $CosFfmpeg 'ffmpeg.exe')
    $r = Comprobar-Ffmpeg
    Igual 'si no arrancan: falta' $r.Estado 'falta'
    Contiene 'lo dice' $r.Detalle 'no arrancan'
    Vaciar-Datos

    # --- Registro en los ajustes de Claude ---
    Write-Host '== registro'
    Vaciar-Ajustes
    Igual 'sin ajustes: plugin no registrado' (Comprobar-Plugin).Estado 'falta'
    $r = Comprobar-Conexion
    Igual 'sin ajustes: sin dirección ni token' $r.Estado 'falta'
    Contiene 'lo dice' $r.Detalle 'no hay guardados ni la dirección ni el token'
    Igual 'registro: falta' (Comprobar-Registro).Estado 'falta'

    Set-Content -LiteralPath $ajustesJson -Value '{ esto no es json' -Encoding UTF8
    Estado-Ajustes -Renovar | Out-Null
    $r = Comprobar-Plugin
    Igual 'ajustes rotos: falta' $r.Estado 'falta'
    Contiene 'ajustes rotos: lo dice' $r.Detalle 'no se pueden leer'

    Vaciar-Ajustes
    $url = 'https://mi-drazo-studio.vercel.app'
    $token = 'tok_1234567890abcdef'
    $salida = (Ejecutar (Buscar-Comando 'node') @($AjustesScript, 'registrar', '--instancia-url', $url, '--token', $token)).Texto
    No-Contiene 'el registro no imprime el token' $salida $token
    Estado-Ajustes -Renovar | Out-Null
    $r = Comprobar-Plugin
    Igual 'registrado sin descargar: aviso' $r.Estado 'aviso'
    Contiene 'dice que aún no se ha descargado' $r.Detalle 'aún sin descargar'
    $r = Comprobar-Conexion
    Igual 'dirección y token guardados: ok' $r.Estado 'ok'
    Contiene 'enseña la dirección' $r.Detalle $url
    No-Contiene 'tapa el token' $r.Detalle $token
    Contiene 'enseña el final del token' $r.Detalle 'cdef'
    Igual 'registro sin descargar: aviso' (Comprobar-Registro).Estado 'aviso'

    $instalado = Join-Path $temp 'plugins\cache\drazo-studio'
    New-Item -ItemType Directory -Force $instalado | Out-Null
    $registroPlugins = @{ version = 2; plugins = @{ 'drazo-studio@drazo-studio' = @(@{ scope = 'user'; installPath = $instalado; version = '2.1.0' }) } } | ConvertTo-Json -Depth 6
    # Claude Code lo escribe sin BOM (Set-Content -Encoding UTF8 de PowerShell 5.1 lo pondría)
    [IO.File]::WriteAllText((Join-Path $env:CLAUDE_CODE_PLUGIN_CACHE_DIR 'installed_plugins.json'), $registroPlugins, (New-Object Text.UTF8Encoding $false))
    Estado-Ajustes -Renovar | Out-Null
    $r = Comprobar-Plugin
    Igual 'registrado y descargado: ok' $r.Estado 'ok'
    Contiene 'dice la versión' $r.Detalle 'registrado y descargado (versión 2.1.0)'
    Igual 'registro completo: ok' (Comprobar-Registro).Estado 'ok'

    Set-Content -LiteralPath $ajustesJson -Value '{ "enabledPlugins": { "drazo-studio@drazo-studio": true }, "extraKnownMarketplaces": { "drazo-studio": { "source": { "source": "github", "repo": "x/y" } } }, "pluginConfigs": { "drazo-studio@drazo-studio": { "options": { "instancia_url": "https://a.b", "token_instancia": "abc" } } } }' -Encoding UTF8
    Estado-Ajustes -Renovar | Out-Null
    Igual 'token demasiado corto: aviso' (Comprobar-Conexion).Estado 'aviso'

    # --- Caminos seguros del instalador (los que no llegan a instalar nada) ---
    Write-Host '== instalar.ps1 (caminos seguros)'
    Vaciar-Ajustes
    $env:CONTENT_OS_DATOS = Join-Path $temp 'datos-instalador'
    $instalar = Join-Path $raiz 'instalar.ps1'
    $ps = (Buscar-Comando 'powershell')
    function Instalar([string[]]$Argumentos) { Ejecutar $ps (@('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $instalar) + $Argumentos) }

    $r = Instalar @('-SoloComprobar')
    Igual 'solo comprobar: sale con 1 (faltan el entorno, el modelo...)' $r.Codigo 1
    Contiene 'solo comprobar: saca la tabla' $r.Texto '[  OK  ] Windows 10 (1809) o 11'
    Contiene 'solo comprobar: lista lo que haría' $r.Texto 'Esto haría el instalador, paso a paso:'
    Contiene 'solo comprobar: paso venv' $r.Texto '- [venv]'
    Contiene 'solo comprobar: paso registrar' $r.Texto '- [registrar]'
    Contiene 'solo comprobar: dice que no cambia nada' $r.Texto 'no se instala ni se cambia nada'
    Igual 'solo comprobar: no crea la carpeta de datos' (Test-Path -LiteralPath $env:CONTENT_OS_DATOS) $false
    Igual 'solo comprobar: no crea los ajustes de Claude' (Test-Path -LiteralPath $ajustesJson) $false

    $r = Instalar @('-Si', '-Pasos', 'git,inventado')
    Igual 'paso desconocido: sale con 2' $r.Codigo 2
    Contiene 'paso desconocido: lista los válidos' $r.Texto 'git node claude ffmpeg python venv modelo playwright registrar'

    $r = Instalar @('-Si', '-Pasos', 'registrar')
    Igual 'registrar sin dirección ni token: sale con 2' $r.Codigo 2
    Contiene 'registrar: lo dice' $r.Texto '-> [registrar] falta: no hay dirección ni token de tu app'
    Contiene 'registrar: RESUMEN con el fallo' $r.Texto 'fallan=registrar'

    $r = Instalar @('-Si', '-Pasos', 'registrar', '-InstanciaUrl', $url)
    Igual 'registrar sin token: sale con 2' $r.Codigo 2
    Contiene 'registrar sin token: lo dice' $r.Texto 'no hay token de tu app'

    $r = Instalar @('-Si', '-Pasos', 'registrar', '-InstanciaUrl', 'http://mi-app.com', '-Token', $token)
    Igual 'registrar con http: sale con 2' $r.Codigo 2
    Contiene 'registrar con http: lo dice' $r.Texto 'tiene que empezar por https://'
    No-Contiene 'no imprime el token' $r.Texto $token

    $r = Instalar @('-Si', '-Pasos', 'registrar', '-InstanciaUrl', $url, '-Token', 'corto')
    Igual 'registrar con token corto: sale con 2' $r.Codigo 2
    Contiene 'registrar con token corto: lo dice' $r.Texto 'demasiado corto'

    Igual 'ningún camino seguro ha escrito los ajustes de Claude' (Test-Path -LiteralPath $ajustesJson) $false
    $llamadas = if (Test-Path -LiteralPath $registroFalso) { @(Get-Content -LiteralPath $registroFalso) } else { @() }
    Igual 'ni ha lanzado ninguna orden «claude plugin»' @($llamadas | Where-Object { $_ -match '^\s*plugin' }).Count 0

    if (Buscar-Comando 'git') {
        $r = Instalar @('-Si', '-Pasos', 'git')
        Igual 'un paso que ya estaba: sale con 0' $r.Codigo 0
        Contiene 'ya estaba' $r.Texto '-> [git] ya estaba:'
        Contiene 'RESUMEN' $r.Texto 'RESUMEN: hechos=; ya estaban=git; fallan=; omitidos='
    }

    $r = Instalar @('-Doctor')
    Igual 'doctor: sale con 1 (faltan cosas en una carpeta vacía)' $r.Codigo 1
    Contiene 'doctor: línea Tu Drazo Studio' $r.Texto 'Tu Drazo Studio'
    Contiene 'doctor: línea Licencia' $r.Texto 'Licencia'
    Contiene 'doctor: dice que falta la dirección' $r.Texto 'no hay guardados ni la dirección de tu app ni el token'
    Contiene 'doctor: dice la carpeta de datos' $r.Texto "Carpeta de Drazo Studio: $($env:CONTENT_OS_DATOS)"
} finally {
    foreach ($n in $nombresEntorno) { [Environment]::SetEnvironmentVariable($n, $entornoPrevio[$n]) }
    if ($temp.StartsWith([IO.Path]::GetTempPath())) { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ''
if ($script:Fallos -eq 0) { Write-Host 'Todas las pruebas pasan.'; exit 0 }
Write-Host "$($script:Fallos) pruebas fallan."
exit 1
