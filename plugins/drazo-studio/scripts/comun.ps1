# Comprobaciones de Drazo Studio en Windows, compartidas por el instalador y el doctor.
# Se carga con: . "<carpeta>\comun.ps1"   (Windows PowerShell 5.1 o superior)
# Este fichero va en UTF-8 con BOM: sin BOM, PowerShell 5.1 rompe las tildes.

$CosScripts       = $PSScriptRoot
# CONTENT_OS_DATOS solo existe para pruebas (rutas.mjs lo lee igual): sin ella, la carpeta de siempre.
$CosDatos         = if ($env:CONTENT_OS_DATOS -and $env:CONTENT_OS_DATOS.Trim()) { $env:CONTENT_OS_DATOS.Trim() } else { Join-Path $env:LOCALAPPDATA 'DrazoStudio' }
$CosVenv          = Join-Path $CosDatos 'venv'
$CosPython        = Join-Path $CosVenv 'Scripts\python.exe'
$CosNode          = Join-Path $CosDatos 'node'
$CosNavegadores   = Join-Path $CosDatos 'ms-playwright'
$CosFfmpeg        = Join-Path $CosDatos 'ffmpeg'
$RequisitosPython = Join-Path $CosScripts 'requisitos-python.txt'
$AjustesScript    = Join-Path $CosScripts 'ajustes-claude.mjs'
$InstanciaScript  = Join-Path $CosScripts 'comprobar-instancia.mjs'
$Soporte         = 'davidmadrazo@profimaxia.com'
# playwright-core con la versión fijada (publicada el 14-oct-2026) y solo su chromium-headless-shell.
$VersionPlaywright = '1.64.1'
# Node: siempre la última 24.x (se mira al instalar en index.json de nodejs.org; sin red, la de respaldo).
# Mínimo duro 22, que tiene parches hasta el 30-abr-2027; que vaya al día con ellos lo dice node-parcheado.mjs.
$RamaNode            = 24
$UrlNodeDist         = 'https://nodejs.org/dist'
$VersionNodeRespaldo = '24.22.1'
$NodeMinimo       = [version]'22.0.0'
$PythonMinimo     = [version]'3.10.0'
$DiscoMinimoGB    = 4

function Nuevo-Resultado {
    param(
        [string]$Id, [string]$Nombre,
        [ValidateSet('ok', 'falta', 'aviso')][string]$Estado,
        [string]$Detalle = '', [string]$Arreglo = '', [switch]$Opcional
    )
    [pscustomobject]@{
        Id = $Id; Nombre = $Nombre; Estado = $Estado
        Detalle = $Detalle; Arreglo = $Arreglo; Opcional = [bool]$Opcional
    }
}

# Ejecuta un programa sin que un error suyo pare el script. Devuelve código y líneas de salida.
function Ejecutar {
    param([string]$Programa, [string[]]$Argumentos = @())
    $previo = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $lineas = @(& $Programa @Argumentos 2>&1 | ForEach-Object { $_.ToString() })
        [pscustomobject]@{ Codigo = $LASTEXITCODE; Lineas = $lineas; Texto = ($lineas -join "`n") }
    } catch {
        [pscustomobject]@{ Codigo = -1; Lineas = @($_.Exception.Message); Texto = $_.Exception.Message }
    } finally {
        $ErrorActionPreference = $previo
    }
}

function Leer-Version([string]$Texto) {
    if ($Texto -match '(\d+)\.(\d+)(?:\.(\d+))?') {
        $parche = if ($Matches[3]) { $Matches[3] } else { '0' }
        return [version]("{0}.{1}.{2}" -f $Matches[1], $Matches[2], $parche)
    }
    $null
}

# Primera versión de la rama $Rama en el texto de index.json de nodejs.org (va de la más nueva a la más vieja).
# Se lee como texto, igual que en Mac: ConvertFrom-Json de PowerShell 5.1 no pasa de 2 MB.
function Elegir-VersionNode([string]$Texto, [int]$Rama = $RamaNode) {
    if ($Texto -match ('"version":\s*"v(' + $Rama + '\.\d+\.\d+)"')) { return $Matches[1] }
    $null
}

# La última 24.x publicada; sin red, o si index.json trae una más vieja, la de respaldo.
# Se lee de RawContentStream: .Content solo es texto si el servidor dice que lo es.
function Resolver-VersionNode {
    $v = $null
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "$UrlNodeDist/index.json" -TimeoutSec 20
        $v = Elegir-VersionNode ([Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()))
    } catch { }
    if (-not $v -or [version]$v -lt [version]$VersionNodeRespaldo) { return $VersionNodeRespaldo }
    $v
}

# winget publica cada versión de Node horas o días después que nodejs.org. De las líneas de «winget show
# --versions»: la deseada si ya la tiene; si no, la última 24.x que tenga; si no se pueden leer, la deseada.
function Elegir-VersionWinget([string[]]$Lineas, [string]$Deseada, [int]$Rama = $RamaNode) {
    $hay = @($Lineas | ForEach-Object { "$_".Trim() } | Where-Object { $_ -match "^$Rama\.\d+\.\d+$" } |
        ForEach-Object { [version]$_ } | Sort-Object -Descending)
    if (-not $hay.Count -or $hay -contains [version]$Deseada) { return $Deseada }
    "$($hay[0])"
}

function Buscar-Comando([string]$Nombre) {
    $c = Get-Command $Nombre -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { $c.Source } else { $null }
}

# Tras instalar algo, el PATH de esta ventana no se entera solo: se recarga del registro.
function Actualizar-Path {
    $partes = @(
        [Environment]::GetEnvironmentVariable('Path', 'Machine') -split ';'
        [Environment]::GetEnvironmentVariable('Path', 'User') -split ';'
        (Join-Path $env:USERPROFILE '.local\bin')
        $env:Path -split ';'
    )
    $env:Path = (($partes | Where-Object { $_ } | Select-Object -Unique) -join ';')
}

# Claude Code recién instalado puede no estar aún en el PATH de esta ventana.
function Ruta-Claude {
    $c = Buscar-Comando 'claude'
    if ($c) { return $c }
    $nativo = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
    if (Test-Path -LiteralPath $nativo) { return $nativo }
    $null
}

# App de escritorio de Claude: paquete MSIX (Microsoft Store o instalador nuevo) o la instalación antigua.
function Ruta-AppEscritorio {
    $p = Get-AppxPackage -Name 'Claude' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($p) { return $p.InstallLocation }
    foreach ($r in (Join-Path $env:LOCALAPPDATA 'AnthropicClaude\claude.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\Claude\Claude.exe')) {
        if (Test-Path -LiteralPath $r) { return $r }
    }
    $null
}

# Registro de Drazo Studio y dirección/token de tu app en los ajustes de Claude (settings.json), leídos con ajustes-claude.mjs.
$script:EstadoAjustes = $null
function Estado-Ajustes([switch]$Renovar) {
    if ($script:EstadoAjustes -and -not $Renovar) { return $script:EstadoAjustes }
    $node = Buscar-Comando 'node'
    if (-not $node) { return $null }
    $e = @{}
    foreach ($l in (Ejecutar $node @($AjustesScript, 'estado')).Lineas) {
        $i = $l.IndexOf('=')
        if ($i -gt 0) { $e[$l.Substring(0, $i)] = $l.Substring($i + 1) }
    }
    $script:EstadoAjustes = $e
    $e
}

function Carpeta-ConfigClaude {
    if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }
}

# Python de base para crear el entorno de Drazo Studio. Se buscan las instalaciones registradas
# (PEP 514) y las del PATH; se descartan las de conda (sus entornos pierden SSL en Windows).
function Buscar-PythonBase {
    $candidatos = New-Object System.Collections.Generic.List[string]
    foreach ($raiz in 'HKCU:\SOFTWARE\Python\PythonCore', 'HKLM:\SOFTWARE\Python\PythonCore', 'HKLM:\SOFTWARE\WOW6432Node\Python\PythonCore') {
        foreach ($v in (Get-ChildItem -LiteralPath $raiz -ErrorAction SilentlyContinue)) {
            $ip = Get-ItemProperty -LiteralPath (Join-Path $v.PSPath 'InstallPath') -ErrorAction SilentlyContinue
            if (-not $ip) { continue }
            $exe = $ip.ExecutablePath
            if (-not $exe -and $ip.'(default)') { $exe = Join-Path $ip.'(default)' 'python.exe' }
            if ($exe -and (Test-Path -LiteralPath $exe)) { $candidatos.Add($exe) }
        }
    }
    foreach ($c in @(Get-Command python, python3 -All -ErrorAction SilentlyContinue)) { $candidatos.Add($c.Source) }
    $preferencia = @{ '3.12' = 0; '3.13' = 1; '3.11' = 2; '3.14' = 3; '3.10' = 4 }
    $mejor = $null
    foreach ($exe in ($candidatos | Select-Object -Unique)) {
        $r = Ejecutar $exe @('-c', "import os,sys; print('%d.%d.%d' % sys.version_info[:3]); print(sys.executable); print(os.path.isdir(os.path.join(sys.prefix,'conda-meta')))")
        if ($r.Codigo -ne 0 -or $r.Lineas.Count -lt 3) { continue }
        $version = Leer-Version $r.Lineas[0]
        if (-not $version -or $version -lt $PythonMinimo -or $r.Lineas[2] -eq 'True') { continue }
        $corta = '{0}.{1}' -f $version.Major, $version.Minor
        $orden = if ($preferencia.ContainsKey($corta)) { $preferencia[$corta] } else { 5 }
        if (-not $mejor -or $orden -lt $mejor.Orden) {
            $mejor = [pscustomobject]@{ Exe = $r.Lineas[1].Trim(); Version = $version; Orden = $orden }
        }
    }
    $mejor
}

# ffmpeg y ffprobe: los de la carpeta de Drazo Studio si existen; si no, los del PATH (los pone winget).
function Ruta-Binario([string]$Nombre) {
    $propio = Join-Path $CosFfmpeg "$Nombre.exe"
    if (Test-Path -LiteralPath $propio) { return $propio }
    Buscar-Comando $Nombre
}

# El chromium-headless-shell de playwright-core, en la carpeta de navegadores de Drazo Studio. Con el playwright-core
# instalado se mira la revisión exacta que pide (browsers.json); sin él, cualquiera terminado de descargar.
function Ruta-NavegadorPlaywright {
    if (-not (Test-Path -LiteralPath $CosNavegadores)) { return $null }
    $revision = $null
    $bj = Join-Path $CosNode 'node_modules\playwright-core\browsers.json'
    if (Test-Path -LiteralPath $bj) {
        try {
            $b = @((Get-Content -LiteralPath $bj -Raw -Encoding UTF8 | ConvertFrom-Json).browsers) | Where-Object { $_.name -eq 'chromium-headless-shell' } | Select-Object -First 1
            if ($b) { $revision = "$($b.revision)" }
        } catch { }
    }
    $carpetas = if ($revision) { @(Join-Path $CosNavegadores "chromium_headless_shell-$revision") }
        else { @(Get-ChildItem -LiteralPath $CosNavegadores -Directory -Filter 'chromium_headless_shell-*' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) }
    foreach ($c in $carpetas) {
        if (-not (Test-Path -LiteralPath (Join-Path $c 'INSTALLATION_COMPLETE'))) { continue }
        $exe = Join-Path $c 'chrome-headless-shell-win64\chrome-headless-shell.exe'
        if (Test-Path -LiteralPath $exe) { return [pscustomobject]@{ Exe = $exe; Revision = (Split-Path $c -Leaf) -replace '^chromium_headless_shell-', '' } }
    }
    $null
}

function Comprobar-Sistema {
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
    $arq = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $build = if ($os) { [int]$os.BuildNumber } else { [Environment]::OSVersion.Version.Build }
    $nombre = if ($os) { $os.Caption } else { 'Windows' }
    $det = "$nombre (compilación $build, $arq)"
    if ($build -lt 17763) { return Nuevo-Resultado 'sistema' 'Windows 10 (1809) o 11' 'falta' $det 'Drazo Studio necesita Windows 10 (versión 1809 o posterior) o Windows 11.' }
    if ($arq -ne 'AMD64') { return Nuevo-Resultado 'sistema' 'Windows 10 (1809) o 11' 'aviso' $det 'Drazo Studio está probado en equipos x64; en ARM puede fallar algo.' }
    Nuevo-Resultado 'sistema' 'Windows 10 (1809) o 11' 'ok' $det
}

# winget solo hace falta para instalar Git, Node, ffmpeg y Python: si ya están, su ausencia no impide usar Drazo Studio.
function Comprobar-Winget {
    $exe = Buscar-Comando 'winget'
    if (-not $exe) { return Nuevo-Resultado 'winget' 'winget (instalador de Windows)' 'aviso' 'no está' 'Sin winget no puedo instalar Git, Node.js, ffmpeg ni Python: instala «Instalador de aplicación» desde Microsoft Store: https://apps.microsoft.com/detail/9NBLGGH4NNS1' }
    Nuevo-Resultado 'winget' 'winget (instalador de Windows)' 'ok' ((Ejecutar $exe @('--version')).Lineas | Select-Object -First 1)
}

function Comprobar-Git {
    $exe = Buscar-Comando 'git'
    if (-not $exe) { return Nuevo-Resultado 'git' 'Git' 'falta' 'no está' 'Lo instala el instalador de Drazo Studio (paso «git»): winget install --id Git.Git -e' }
    Nuevo-Resultado 'git' 'Git' 'ok' ("" + (Leer-Version (Ejecutar $exe @('--version')).Texto))
}

# Además del mínimo, mira si lleva el último parche de seguridad de su rama (node-parcheado.mjs, con caché de
# 24 h; sin red no dice nada). Si no lo lleva es un aviso: no impide usar Drazo Studio, y el paso «node» lo pone al día.
# Los arreglos no dicen «winget install OpenJS.NodeJS.LTS» a secas: desde el 28-oct-2026 eso instala la 26.
function Comprobar-Node {
    $nombre = 'Node.js 22 o superior'
    $exe = Buscar-Comando 'node'
    if (-not $exe) { return Nuevo-Resultado 'node' $nombre 'falta' 'no está' "Lo instala el instalador de Drazo Studio (paso «node»): Node.js $RamaNode, la última con sus parches." }
    $v = Leer-Version (Ejecutar $exe @('--version')).Texto
    if (-not $v -or $v -lt $NodeMinimo) { return Nuevo-Resultado 'node' $nombre 'falta' "versión $v" "Vuelve a pasar el paso «node» del instalador de Drazo Studio: pone Node.js $RamaNode, la última con sus parches." }
    if (-not (Buscar-Comando 'npm.cmd')) { return Nuevo-Resultado 'node' $nombre 'falta' "$v sin npm" "Vuelve a pasar el paso «node» del instalador de Drazo Studio: reinstala Node.js $RamaNode con npm." }
    $parches = @{}
    foreach ($l in (Ejecutar $exe @((Join-Path $CosScripts 'node-parcheado.mjs'), 'estado')).Lineas) {
        $i = $l.IndexOf('=')
        if ($i -gt 0) { $parches[$l.Substring(0, $i)] = $l.Substring($i + 1) }
    }
    if ($parches['estado'] -eq 'atrasada') { return Nuevo-Resultado 'node' $nombre 'aviso' "$v, sin el último parche de seguridad ($($parches['parche']))" "Vuelve a pasar el paso «node» del instalador de Drazo Studio: pone al día Node.js $RamaNode." }
    $detalle = if ($parches['estado'] -eq 'al-dia') { "$v, con los parches de seguridad al día" } else { "$v" }
    Nuevo-Resultado 'node' $nombre 'ok' $detalle
}

function Comprobar-Claude {
    $nombre = 'Claude (app de escritorio o Claude Code)'
    $partes = @()
    if (Ruta-AppEscritorio) { $partes += 'app de escritorio' }
    $cli = Ruta-Claude
    if ($cli) { $partes += 'Claude Code ' + (((Ejecutar $cli @('--version')).Lineas | Select-Object -First 1) -replace '\s*\(Claude Code\)', '') }
    if ($partes.Count) { return Nuevo-Resultado 'claude' $nombre 'ok' ($partes -join ' y ') }
    if ($env:CLAUDECODE -eq '1') { return Nuevo-Resultado 'claude' $nombre 'ok' 'esta sesión de Claude Code' }
    Nuevo-Resultado 'claude' $nombre 'falta' 'no está' 'Instala la app de escritorio de Claude (claude.com/download) y entra con tu cuenta de Claude.'
}

function Comprobar-Ffmpeg {
    $nombre = 'ffmpeg y ffprobe'
    $ff = Ruta-Binario 'ffmpeg'
    $fp = Ruta-Binario 'ffprobe'
    $arreglo = 'Lo instala el instalador de Drazo Studio (paso «ffmpeg»): winget install --id Gyan.FFmpeg -e'
    if (-not $ff -and -not $fp) { return Nuevo-Resultado 'ffmpeg' $nombre 'falta' 'no están' $arreglo }
    if (-not $ff) { return Nuevo-Resultado 'ffmpeg' $nombre 'falta' "hay ffprobe pero falta ffmpeg ($fp)" $arreglo }
    if (-not $fp) { return Nuevo-Resultado 'ffmpeg' $nombre 'falta' "hay ffmpeg pero falta ffprobe ($ff)" $arreglo }
    $ver = Ejecutar $ff @('-hide_banner', '-version')
    $verp = Ejecutar $fp @('-hide_banner', '-version')
    if ($ver.Codigo -ne 0 -or $verp.Codigo -ne 0) { return Nuevo-Resultado 'ffmpeg' $nombre 'falta' "no arrancan ($ff)" $arreglo }
    $primera = (($ver.Lineas | Select-Object -First 1) -replace '^ffmpeg version\s+', '') -replace '\s+Copyright.*$', ''
    Nuevo-Resultado 'ffmpeg' $nombre 'ok' $primera
}

function Comprobar-Python {
    $nombre = 'Python 3.10 o superior'
    $base = Buscar-PythonBase
    if ($base) { return Nuevo-Resultado 'python' $nombre 'ok' "$($base.Version) ($($base.Exe))" }
    if (Test-Path -LiteralPath $CosPython) { return Nuevo-Resultado 'python' $nombre 'aviso' 'no hay Python en el sistema, pero el entorno de Drazo Studio existe' 'Solo hace falta para rehacer el entorno: winget install --id Python.Python.3.12 -e' }
    Nuevo-Resultado 'python' $nombre 'falta' 'no está (los de conda no sirven)' 'Lo instala el instalador de Drazo Studio (paso «python»): winget install --id Python.Python.3.12 -e'
}

function Comprobar-Entorno {
    $nombre = 'Entorno de Python de Drazo Studio'
    if (-not (Test-Path -LiteralPath $CosPython)) { return Nuevo-Resultado 'venv' $nombre 'falta' "no existe $CosVenv" 'Lo crea el instalador de Drazo Studio (paso «venv»).' }
    $r = Ejecutar $CosPython @('-X', 'utf8', (Join-Path $CosScripts 'comprobar-python.py'))
    $py = $r.Lineas | Where-Object { $_ -like 'PYTHON *' } | Select-Object -First 1
    if (-not $py) { return Nuevo-Resultado 'venv' $nombre 'falta' 'su Python no arranca' 'Vuelve a ejecutar el paso «venv» del instalador de Drazo Studio: rehace el entorno.' }
    $mal = @($r.Lineas | Where-Object { $_ -like 'MAL *' } | ForEach-Object { ($_ -split ' ', 3)[1] })
    $bien = @($r.Lineas | Where-Object { $_ -like 'OK *' } | ForEach-Object { $p = $_ -split ' '; "$($p[1]) $($p[2])" })
    $version = ($py -split ' ')[1]
    if ($mal.Count) { return Nuevo-Resultado 'venv' $nombre 'falta' "Python $version; fallan: $($mal -join ', ')" 'Vuelve a ejecutar el paso «venv» del instalador de Drazo Studio: reinstala los paquetes.' }
    Nuevo-Resultado 'venv' $nombre 'ok' "Python $version · $($bien -join ', ')"
}

# El motor de transcribir usa este modelo de la caché de Hugging Face; si no está, lo baja la primera
# vez dentro de una orden con límite de 10 minutos. Una descarga a medias deja la carpeta sin model.bin.
function Comprobar-Modelo {
    $nombre = 'Modelo de transcripción large-v3-turbo'
    if (-not (Test-Path -LiteralPath $CosPython)) { return Nuevo-Resultado 'modelo' $nombre 'falta' 'no se puede mirar sin el entorno de Python de Drazo Studio' 'Lo descarga el instalador de Drazo Studio (paso «modelo») después de crear el entorno (unos 1,6 GB).' }
    $r = Ejecutar $CosPython @('-X', 'utf8', '-c', "import os; from faster_whisper import download_model; p = download_model('large-v3-turbo', local_files_only=True); print(os.path.getsize(os.path.join(p, 'model.bin')))")
    $bytes = [long]0
    if ($r.Codigo -eq 0) {
        foreach ($linea in $r.Lineas) { $n = [long]0; if ([long]::TryParse($linea.Trim(), [ref]$n)) { $bytes = $n } }
    }
    if ($bytes -gt 1GB) { return Nuevo-Resultado 'modelo' $nombre 'ok' ("descargado ({0:N1} GB, caché de Hugging Face)" -f ($bytes / 1e9)) }
    if ($r.Texto -match 'No module named|ImportError') { return Nuevo-Resultado 'modelo' $nombre 'falta' 'faster-whisper no está en el entorno de Drazo Studio' 'Vuelve a ejecutar los pasos «venv» y «modelo» del instalador de Drazo Studio.' }
    Nuevo-Resultado 'modelo' $nombre 'falta' 'no está descargado' 'Vuelve a ejecutar el paso «modelo» del instalador de Drazo Studio (unos 1,6 GB): si no, la primera transcripción lo baja y puede cortarse.'
}

# playwright-core y su navegador sin ventana. Con otra versión de playwright-core que la fijada es un aviso: funciona,
# y el paso «playwright» del instalador lo pone al día.
function Comprobar-Playwright {
    $nombre = 'playwright-core y su navegador'
    $pj = Join-Path $CosNode 'node_modules\playwright-core\package.json'
    if (-not (Test-Path -LiteralPath $pj)) { return Nuevo-Resultado 'playwright' $nombre 'falta' "no está en $CosNode" 'Lo instala el instalador de Drazo Studio (paso «playwright»), solo para Drazo Studio y no global.' }
    $version = (Get-Content -LiteralPath $pj -Raw -Encoding UTF8 | ConvertFrom-Json).version
    $shell = Ruta-NavegadorPlaywright
    if (-not $shell) { return Nuevo-Resultado 'playwright' $nombre 'falta' "playwright-core $version, pero falta su navegador sin ventana en $CosNavegadores" 'Vuelve a ejecutar el paso «playwright» del instalador de Drazo Studio: descarga el navegador (unos 150 MB).' }
    if ($version -ne $VersionPlaywright) { return Nuevo-Resultado 'playwright' $nombre 'aviso' "playwright-core $version (Drazo Studio usa la $VersionPlaywright)" 'Vuelve a ejecutar el paso «playwright» del instalador de Drazo Studio: lo pone al día.' }
    Nuevo-Resultado 'playwright' $nombre 'ok' "playwright-core $version · chrome-headless-shell $($shell.Revision)"
}

# Registrado = marketplace y plugin en los ajustes de Claude. La app lo descarga al abrirse de nuevo.
function Comprobar-Plugin {
    $nombre = 'Drazo Studio registrado en Claude'
    $e = Estado-Ajustes
    if (-not $e) { return Nuevo-Resultado 'plugin' $nombre 'falta' 'sin Node.js no se pueden leer los ajustes de Claude' 'Instala Node.js con el instalador de Drazo Studio.' }
    if ($e['ajustes'] -eq 'json-invalido') { return Nuevo-Resultado 'plugin' $nombre 'falta' 'los ajustes de Claude no se pueden leer' "Revisa el fichero: $($e['detalle'])" }
    if ($e['marketplace'] -ne 'si' -or $e['activado'] -ne 'si') { return Nuevo-Resultado 'plugin' $nombre 'falta' 'no está registrado' 'Regístralo con el paso «registrar» del instalador de Drazo Studio.' }
    if ($e['descargado'] -ne 'si') { return Nuevo-Resultado 'plugin' $nombre 'aviso' "registrado ($($e['fuente'])), aún sin descargar" 'Vuelve a pasar el paso «registrar» del instalador: lo descarga e instala. Después, cierra la app de Claude del todo y ábrela.' }
    $detalle = if ($e['version']) { "registrado y descargado (versión $($e['version']))" } else { "registrado, cargado desde $($e['fuente'])" }
    Nuevo-Resultado 'plugin' $nombre 'ok' $detalle
}

# La dirección de tu app y el token viven en los ajustes de Claude (pluginConfigs), que es de donde los toma el plugin.
function Comprobar-Conexion {
    $nombre = 'Dirección y token de tu app'
    $e = Estado-Ajustes
    if (-not $e) { return Nuevo-Resultado 'conexion' $nombre 'falta' 'sin Node.js no se pueden leer los ajustes de Claude' 'Instala Node.js con el instalador de Drazo Studio.' }
    if ($e['ajustes'] -eq 'json-invalido') { return Nuevo-Resultado 'conexion' $nombre 'falta' 'los ajustes de Claude no se pueden leer' "Revisa el fichero: $($e['detalle'])" }
    if ($e['instancia'] -ne 'si' -or $e['token'] -ne 'si') {
        $que = if ($e['instancia'] -ne 'si' -and $e['token'] -ne 'si') { 'guardados ni la dirección ni el token' } elseif ($e['instancia'] -ne 'si') { 'guardada la dirección' } else { 'guardado el token' }
        return Nuevo-Resultado 'conexion' $nombre 'falta' "no hay $que" 'Guárdalos con el paso «registrar» del instalador de Drazo Studio, con la dirección y el token de tu app.'
    }
    if ($e['token_formato'] -ne 'si') { return Nuevo-Resultado 'conexion' $nombre 'aviso' "$($e['instancia_url']) con un token demasiado corto" 'Revisa que guardaste el token completo de tu app.' }
    Nuevo-Resultado 'conexion' $nombre 'ok' "$($e['instancia_url']) · token $($e['token_tapado'])"
}

function Comprobar-Registro {
    $p = Comprobar-Plugin
    $c = Comprobar-Conexion
    if ($p.Estado -eq 'falta') { return $p }
    if ($c.Estado -ne 'ok') { return $c }
    Nuevo-Resultado 'registrar' 'Drazo Studio registrado con tu app' $p.Estado "$($p.Detalle); $($c.Detalle)" $p.Arreglo
}

function Comprobar-Disco {
    $nombre = "Espacio libre (más de $DiscoMinimoGB GB)"
    $raiz = try { Split-Path -Qualifier $CosDatos } catch { $null }
    if (-not $raiz) { $raiz = Split-Path -Qualifier $env:LOCALAPPDATA }
    $unidad = New-Object System.IO.DriveInfo $raiz
    $libre = [math]::Round($unidad.AvailableFreeSpace / 1GB, 1)
    $det = "$libre GB libres en $($unidad.Name)"
    if ($libre -lt $DiscoMinimoGB) { return Nuevo-Resultado 'disco' $nombre 'falta' $det 'Libera espacio: el entorno de Python, el modelo de transcripción y el navegador ocupan varios GB.' }
    Nuevo-Resultado 'disco' $nombre 'ok' $det
}

function Comprobar-Memoria {
    $nombre = 'Memoria (RAM)'
    $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
    if (-not $cs) { return Nuevo-Resultado 'memoria' $nombre 'aviso' 'no se pudo leer' }
    $total = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
    $libre = if ($os) { [math]::Round($os.FreePhysicalMemory * 1KB / 1GB, 1) } else { '?' }
    $det = "$total GB en total, $libre GB libres ahora"
    if ($total -lt 8) { return Nuevo-Resultado 'memoria' $nombre 'aviso' $det 'Con menos de 8 GB la transcripción va lenta o falla: cierra otras aplicaciones al usarla.' }
    Nuevo-Resultado 'memoria' $nombre 'ok' $det
}

# Una comprobación que revienta no debe tumbar el doctor: queda como aviso con el error.
function Ejecutar-Comprobacion([string]$Funcion) {
    try {
        & $Funcion
    } catch {
        $nombre = $Funcion -replace '^Comprobar-', ''
        Nuevo-Resultado $nombre.ToLower() $nombre 'aviso' "no se pudo comprobar: $($_.Exception.Message)" "Pasa este mensaje al soporte de ProfimaxIA ($Soporte)."
    }
}

# Orden de comprobación = orden de instalación.
$ComprobacionesCos = @(
    'Comprobar-Sistema', 'Comprobar-Winget', 'Comprobar-Git', 'Comprobar-Node', 'Comprobar-Claude',
    'Comprobar-Ffmpeg', 'Comprobar-Python', 'Comprobar-Entorno', 'Comprobar-Modelo', 'Comprobar-Playwright',
    'Comprobar-Plugin', 'Comprobar-Conexion', 'Comprobar-Disco', 'Comprobar-Memoria'
)

function Mostrar-Resultado($R) {
    $color = @{ ok = 'Green'; falta = 'Red'; aviso = 'Yellow' }[$R.Estado]
    $etiqueta = @{ ok = '  OK  '; falta = 'FALTA '; aviso = 'AVISO ' }[$R.Estado]
    Write-Host "  [$etiqueta] " -ForegroundColor $color -NoNewline
    Write-Host ("{0,-40} {1}" -f $R.Nombre, $R.Detalle)
}

# Resumen final: lo que falta (obligatorio) con su arreglo, y los avisos aparte.
function Mostrar-Arreglos($Resultados) {
    $faltan = @($Resultados | Where-Object { $_.Estado -eq 'falta' })
    $avisos = @($Resultados | Where-Object { $_.Estado -eq 'aviso' -and $_.Arreglo })
    Write-Host ''
    if ($faltan.Count -eq 0) {
        Write-Host 'Todo lo necesario está listo.' -ForegroundColor Green
    } else {
        Write-Host 'Qué falta y cómo arreglarlo:' -ForegroundColor Red
        $i = 1
        foreach ($r in $faltan) { Write-Host ("  {0}. Falta {1}: {2}" -f $i, $r.Nombre, $r.Arreglo); $i++ }
    }
    if ($avisos.Count) {
        Write-Host ''
        Write-Host 'Avisos:' -ForegroundColor Yellow
        foreach ($r in $avisos) { Write-Host ("  - {0}: {1}" -f $r.Nombre, $r.Arreglo) }
    }
}
