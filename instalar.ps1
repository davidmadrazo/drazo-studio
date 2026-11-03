# Instalador de Drazo Studio para Windows 10 y 11.
# Comprueba cada requisito e instala lo que falte. Normalmente lo ejecuta Claude siguiendo INSTALAR.md,
# después de pedir permiso en el chat; también sirve a mano desde PowerShell.
# Uso:
#   powershell -NoProfile -ExecutionPolicy Bypass -File instalar.ps1 -SoloComprobar     solo mira, no cambia nada
#   ... -Doctor                                         pasa el doctor completo (también prueba tu app y su licencia)
#   ... -Si [-Pasos git,node,...] [-InstanciaUrl https://...] [-Token ...] [-Carpeta <ruta>]   sin preguntas
#       (pegar INSTALAR.md ya es su sí). -Carpeta: comprueba que existe tu carpeta de trabajo; no escribe nada dentro
#   ... (sin opciones)                                  pregunta en la terminal antes de cada paso
#   ... -Marketplace <carpeta del repo>                 registra Drazo Studio desde una carpeta local (pruebas)
# Pasos: git node claude ffmpeg python venv modelo playwright registrar
# Salida por paso: «== [paso] ...» al empezar y «-> [paso] ok|ya estaba|falta|error: ...» al acabar.
# Código de salida: 0 todo bien · 1 algún paso no quedó bien · 2 uso incorrecto · 3 equipo no compatible.
# Variable CONTENT_OS_DATOS: otra carpeta de datos (solo para pruebas).
# Este fichero va en UTF-8 con BOM: sin BOM, PowerShell 5.1 rompe las tildes.
param(
    [switch]$SoloComprobar,
    [switch]$Doctor,
    [switch]$Si,
    [string]$Pasos,
    [string]$InstanciaUrl,
    [string]$Token,
    [string]$Marketplace,
    [string]$Carpeta
)

# Repo de GitHub con el marketplace y el plugin de Drazo Studio.
$RepoPlugin = 'davidmadrazo/drazo-studio'
$RamaPlugin = 'main'
$NombreMarketplace = 'drazo-studio'
$IdPlugin = 'drazo-studio@drazo-studio'
$UrlBasePlugin = "https://raw.githubusercontent.com/$RepoPlugin/$RamaPlugin"

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$FicherosPlugin = @(
    'scripts/comun.ps1', 'scripts/doctor.ps1', 'scripts/comprobar-instancia.mjs', 'scripts/ajustes-claude.mjs',
    'scripts/node-parcheado.mjs', 'scripts/comprobar-python.py', 'scripts/requisitos-python.txt'
)
$CarpetaTemporal = $null
$CodigoSalida = 1

# Desde una copia del repo usa sus ficheros; si el instalador llega suelto, baja los que necesita.
function Preparar-Plugin {
    if ($PSScriptRoot) {
        $local = Join-Path $PSScriptRoot 'plugins\drazo-studio'
        if (Test-Path -LiteralPath (Join-Path $local 'scripts\comun.ps1')) { return $local }
    }
    $script:CarpetaTemporal = Join-Path $env:TEMP ('drazo-studio-instalador-' + [guid]::NewGuid().ToString('N'))
    $destino = Join-Path $CarpetaTemporal 'plugin'
    foreach ($f in $FicherosPlugin) {
        $ruta = Join-Path $destino ($f -replace '/', '\')
        New-Item -ItemType Directory -Force (Split-Path $ruta) | Out-Null
        Invoke-WebRequest -UseBasicParsing -Uri "$UrlBasePlugin/plugins/drazo-studio/$f" -OutFile $ruta
    }
    $destino
}

function Preguntar([string]$Texto, [switch]$PorDefectoNo) {
    if ($Si) { return $true }
    $sufijo = if ($PorDefectoNo) { '[s/N]' } else { '[S/n]' }
    while ($true) {
        $r = "$(Read-Host "$Texto $sufijo")".Trim().ToLower()
        if (-not $r) { return -not $PorDefectoNo }
        if ($r -in 's', 'si', 'sí', 'y', 'yes') { return $true }
        if ($r -in 'n', 'no') { return $false }
    }
}

function Avisar([string]$Texto, [string]$Color = 'Yellow') { Write-Host $Texto -ForegroundColor $Color }

function Instalar-ConWinget([string]$Id, [string]$Nombre, [string]$Version) {
    if (-not (Buscar-Comando 'winget')) { throw "sin winget no se puede instalar $Nombre; instala «Instalador de aplicación» desde Microsoft Store" }
    Write-Host "Instalando $Nombre con winget. Windows puede mostrar una ventana «¿Quieres permitir que esta aplicación haga cambios?»: hay que pulsar «Sí»."
    $fijar = if ($Version) { @('--version', $Version) } else { @() }
    & winget install --id $Id -e @fijar --source winget --accept-package-agreements --accept-source-agreements --silent --disable-interactivity
    if ($LASTEXITCODE -ne 0) { Write-Host "winget terminó con el código $LASTEXITCODE." }
    Actualizar-Path
}

# Siempre la última 24.x, con la versión fijada: OpenJS.NodeJS.LTS a secas salta a la 26 el 28-oct-2026.
# winget comprueba el SHA-256 del instalador con el de su manifiesto. Si Node ya estaba, lo actualiza.
function Instalar-Node {
    $v = Resolver-VersionNode
    $r = Ejecutar 'winget' @('show', '--id', 'OpenJS.NodeJS.LTS', '-e', '--versions', '--source', 'winget', '--accept-source-agreements', '--disable-interactivity')
    $enWinget = Elegir-VersionWinget $r.Lineas $v
    if ($enWinget -ne $v) { Write-Host "winget aún no tiene Node.js ${v}: instalo la $enWinget, la última $RamaNode que tiene." }
    Instalar-ConWinget 'OpenJS.NodeJS.LTS' "Node.js $enWinget" $enWinget
}

function Instalar-Claude {
    Write-Host 'Instalando Claude Code (la orden claude) con el instalador oficial de Anthropic...'
    & powershell -NoProfile -ExecutionPolicy Bypass -Command 'irm https://claude.ai/install.ps1 | iex'
    Actualizar-Path
}

function Instalar-Entorno {
    $base = Buscar-PythonBase
    if (-not $base) { throw 'no hay un Python 3.10 o superior para crear el entorno (paso python)' }
    New-Item -ItemType Directory -Force $CosDatos | Out-Null
    $roto = (Test-Path -LiteralPath $CosPython) -and ((Ejecutar $CosPython @('-c', 'import sys')).Codigo -ne 0)
    if (-not (Test-Path -LiteralPath $CosPython) -or $roto) {
        Write-Host "Creando el entorno con Python $($base.Version)..."
        & $base.Exe -m venv --clear $CosVenv
        if ($LASTEXITCODE -ne 0) { throw "no pude crear el entorno de Python (código $LASTEXITCODE)" }
    }
    Write-Host 'Instalando los paquetes de Python de Drazo Studio (tarda unos minutos)...'
    & $CosPython -m pip install --disable-pip-version-check --upgrade pip
    & $CosPython -m pip install --disable-pip-version-check -r $RequisitosPython
    if ($LASTEXITCODE -ne 0) { throw "pip no pudo instalar los paquetes (código $LASTEXITCODE)" }
}

function Descargar-Modelo {
    if (-not (Test-Path -LiteralPath $CosPython)) { throw 'falta el entorno de Python de Drazo Studio (paso venv)' }
    Write-Host 'Descargando el modelo de transcripción large-v3-turbo (unos 1,6 GB; tarda según la conexión)...'
    $env:HF_HUB_DISABLE_SYMLINKS_WARNING = '1'
    & $CosPython -c "from faster_whisper import download_model; download_model('large-v3-turbo')"
    if ($LASTEXITCODE -ne 0) { throw "no se pudo descargar el modelo (código $LASTEXITCODE)" }
}

# playwright-core con la versión fijada y solo su chromium-headless-shell («install chromium --only-shell» es lo mismo):
# un «install --only-shell» a secas bajaría también Firefox y WebKit. Se llama a su cli.js para no depender de npx.
function Instalar-Playwright {
    if (-not (Buscar-Comando 'npm.cmd')) { throw 'falta Node.js (paso node)' }
    New-Item -ItemType Directory -Force $CosNode | Out-Null
    & npm.cmd install --prefix $CosNode --no-audit --no-fund --save-exact "playwright-core@$VersionPlaywright"
    if ($LASTEXITCODE -ne 0) { throw "npm no pudo instalar playwright-core (código $LASTEXITCODE)" }
    $cli = Join-Path $CosNode 'node_modules\playwright-core\cli.js'
    Write-Host 'Descargando el navegador sin ventana de Playwright (unos 150 MB)...'
    $env:PLAYWRIGHT_BROWSERS_PATH = $CosNavegadores
    & (Buscar-Comando 'node') $cli install chromium-headless-shell
    if ($LASTEXITCODE -ne 0) { throw "no se pudo descargar el navegador de Playwright (código $LASTEXITCODE)" }
}

function Ajustes-Claude([string[]]$Argumentos) {
    $node = Buscar-Comando 'node'
    if (-not $node) { throw 'falta Node.js (paso node)' }
    & $node $AjustesScript @Argumentos
    $codigo = $LASTEXITCODE
    Estado-Ajustes -Renovar | Out-Null
    if ($codigo -ne 0) { throw "no se pudieron guardar los ajustes de Claude (código $codigo)" }
}

function Pedir-Instancia {
    for ($intento = 1; $intento -le 3; $intento++) {
        $url = "$(Read-Host 'Pega la dirección de tu Drazo Studio (por ejemplo, https://mi-drazo-studio.vercel.app) y pulsa Intro')".Trim()
        if (-not $url) { return '' }
        if ($url -match '^https://\S+$') { return $url }
        Avisar 'Eso no parece la dirección de tu app: tiene que empezar por https://. Prueba otra vez.'
    }
    ''
}

function Pedir-Token {
    for ($intento = 1; $intento -le 3; $intento++) {
        $segura = Read-Host 'Pega el token de conexión de tu Drazo Studio y pulsa Intro' -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
        try { $clave = "$([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr))".Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
        if (-not $clave) { return '' }
        if ($clave -match '^\S{8,}$') { return $clave }
        Avisar 'Ese token es demasiado corto o lleva espacios. Prueba otra vez.'
    }
    ''
}

# Lo que no se puede arreglar ni preguntando: devuelve el problema en una frase, o '' si todo va bien. Con -Si no hay
# a quién preguntar, así que además falta lo que no esté ni en las opciones ni ya guardado.
function Validar-Registro {
    $e = Estado-Ajustes
    if ($InstanciaUrl -and $InstanciaUrl -notmatch '^https://\S+$' -and $InstanciaUrl -notmatch '^http://(localhost|127\.0\.0\.1)(:\d+)?(/\S*)?$') { return 'la dirección tiene que empezar por https:// (opción -InstanciaUrl)' }
    if ($Token -and $Token -notmatch '^\S{8,}$') { return 'el token es demasiado corto o lleva espacios (opción -Token)' }
    if (-not $Si) { return '' }
    $hayUrl = $InstanciaUrl -or ($e -and $e['instancia'] -eq 'si')
    $hayToken = $Token -or ($e -and $e['token'] -eq 'si')
    if (-not $hayUrl -and -not $hayToken) { return 'no hay dirección ni token de tu app; pásalos con -InstanciaUrl https://... y -Token ...' }
    if (-not $hayUrl) { return 'no hay dirección de tu app; pásala con -InstanciaUrl https://...' }
    if (-not $hayToken) { return 'no hay token de tu app; pásalo con -Token ...' }
    ''
}

# Marketplace, plugin, dirección y token en los ajustes de Claude (settings.json, con copia de seguridad) y el plugin
# descargado con la orden claude. Con -Carpeta, comprueba que existe tu carpeta de trabajo (no escribe nada en ella).
function Registrar-DrazoStudio {
    $e = Estado-Ajustes
    $url = $InstanciaUrl
    $clave = $Token
    if (-not $Si) {
        if (-not $url -and (-not $e -or $e['instancia'] -ne 'si')) { $url = Pedir-Instancia }
        if (-not $clave -and (-not $e -or $e['token'] -ne 'si')) { $clave = Pedir-Token }
    }
    $argumentos = @('registrar')
    if ($url) { $argumentos += @('--instancia-url', $url) }
    if ($clave) { $argumentos += @('--token', $clave) }
    if ($Marketplace) { $argumentos += @('--fuente-local', $Marketplace) }
    Ajustes-Claude $argumentos
    # La app no siempre baja el plugin al reabrirse: se descarga e instala ya con la orden claude
    $c = Ruta-Claude
    if (-not $c) { Instalar-Claude; $c = Ruta-Claude }
    if (-not $c) { throw 'no encuentro la orden claude para descargar Drazo Studio' }
    $plugin = @('instalar-plugin', '--claude', $c)
    if ($Marketplace) { $plugin += @('--fuente-local', $Marketplace) }
    Ajustes-Claude $plugin
    if ($Carpeta) { Ajustes-Claude @('carpeta', '--ruta', $Carpeta) }
}

function Nuevo-Catalogo {
    [ordered]@{
        git        = @{ Comprobar = 'Comprobar-Git'; Hacer = { Instalar-ConWinget 'Git.Git' 'Git' }; Texto = 'Instalo Git (Claude lo usa para descargar Drazo Studio y para su terminal Bash)' }
        node       = @{ Comprobar = 'Comprobar-Node'; Hacer = { Instalar-Node }; Texto = "Instalo Node.js $RamaNode (la última, con sus parches de seguridad)" }
        claude     = @{ Comprobar = 'Comprobar-Claude'; Hacer = { Instalar-Claude }; Texto = 'Instalo Claude Code (la orden claude)' }
        ffmpeg     = @{ Comprobar = 'Comprobar-Ffmpeg'; Hacer = { Instalar-ConWinget 'Gyan.FFmpeg' 'ffmpeg' }; Texto = 'Instalo ffmpeg (el programa que saca el audio y las imágenes de los reels)' }
        python     = @{ Comprobar = 'Comprobar-Python'; Hacer = { Instalar-ConWinget 'Python.Python.3.12' 'Python 3.12' }; Texto = 'Instalo Python 3.12' }
        venv       = @{ Comprobar = 'Comprobar-Entorno'; Hacer = { Instalar-Entorno }; Texto = 'Creo el entorno de Python de Drazo Studio (transcribir y bajar reels; tarda varios minutos)' }
        modelo     = @{ Comprobar = 'Comprobar-Modelo'; Hacer = { Descargar-Modelo }; Texto = 'Descargo el modelo de transcripción large-v3-turbo (unos 1,6 GB)' }
        playwright = @{ Comprobar = 'Comprobar-Playwright'; Hacer = { Instalar-Playwright }; Texto = 'Instalo playwright-core y su navegador sin ventana, solo para Drazo Studio (unos 150 MB)' }
        registrar  = @{ Comprobar = 'Comprobar-Registro'; Hacer = { Registrar-DrazoStudio }; Texto = 'Registro Drazo Studio en Claude y guardo la dirección y el token de tu app' }
    }
}

# Un paso está hecho si no falta nada; Node (sin el último parche es un aviso), playwright (otra versión es un aviso)
# y el registro (aún sin descargar es un aviso) solo si están del todo bien.
function Esta-Hecho($Id, $R) { if ($Id -in 'node', 'playwright', 'registrar') { $R.Estado -eq 'ok' } else { $R.Estado -ne 'falta' } }

function Principal {
    # Lo que instaló un paso anterior está en el registro, no en el PATH heredado de la app de Claude.
    Actualizar-Path
    if ($Doctor) {
        & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Plugin 'scripts\doctor.ps1')
        $script:CodigoSalida = $LASTEXITCODE
        return
    }
    $catalogo = Nuevo-Catalogo
    Write-Host ''
    Write-Host 'Drazo Studio · instalador para Windows' -ForegroundColor Cyan
    Write-Host 'Drazo Studio funciona con Claude Code (o la app de escritorio de Claude) y una suscripción de pago a Claude.'
    if ($SoloComprobar) { Write-Host 'Modo solo comprobar: no se instala ni se cambia nada.' -ForegroundColor Yellow }
    Write-Host ''
    $resultados = @(foreach ($f in $ComprobacionesCos) { $r = Ejecutar-Comprobacion $f; Mostrar-Resultado $r; $r })
    $sistema = $resultados | Where-Object Id -eq 'sistema'
    if ($sistema.Estado -eq 'falta') { Avisar $sistema.Arreglo 'Red'; $script:CodigoSalida = 3; return }
    $inicial = @{}
    foreach ($r in $resultados) { $inicial[$r.Id] = $r }
    $inicial['registrar'] = Ejecutar-Comprobacion 'Comprobar-Registro'

    $explicitos = @()
    if ($Pasos) {
        $lista = @($Pasos -split '[,\s]+' | Where-Object { $_ })
        $malos = @($lista | Where-Object { -not $catalogo.Contains($_) })
        if ($malos.Count) { Avisar "Pasos desconocidos: $($malos -join ', '). Válidos: $(@($catalogo.Keys) -join ' ')" 'Red'; $script:CodigoSalida = 2; return }
        $explicitos = $lista
    } else {
        $lista = @($catalogo.Keys | Where-Object { $_ -ne 'registrar' -and -not (Esta-Hecho $_ $inicial[$_]) })
        if ($InstanciaUrl -or $Token -or -not (Esta-Hecho 'registrar' $inicial['registrar'])) { $lista += 'registrar' }
    }

    if ($SoloComprobar) {
        Write-Host ''
        if ($lista.Count) {
            Write-Host 'Esto haría el instalador, paso a paso:' -ForegroundColor Cyan
            foreach ($id in $lista) { Write-Host "  - [$id] $($catalogo[$id].Texto)" }
        }
        Mostrar-Arreglos $resultados
        $script:CodigoSalida = [int](@($resultados | Where-Object { $_.Estado -eq 'falta' -and -not $_.Opcional }).Count -gt 0)
        return
    }
    Ejecutar-Pasos $catalogo $lista $explicitos
}

function Ejecutar-Pasos($Catalogo, $Lista, $Explicitos) {
    $hechos = @(); $yaEstaban = @(); $fallan = @(); $omitidos = @(); $usoMalo = $false
    foreach ($id in $Lista) {
        $paso = $Catalogo[$id]
        Write-Host ''
        Write-Host "== [$id] $($paso.Texto)" -ForegroundColor Cyan
        $antes = Ejecutar-Comprobacion $paso.Comprobar
        # El registro se repite siempre que se pide a propósito (-Pasos registrar) o con datos nuevos: también es la
        # forma de actualizar el plugin.
        $forzar = $id -eq 'registrar' -and ($InstanciaUrl -or $Token -or ($id -in $Explicitos))
        if ((Esta-Hecho $id $antes) -and -not $forzar) { Write-Host "-> [$id] ya estaba: $($antes.Detalle)"; $yaEstaban += $id; continue }
        if (-not (Preguntar "¿$($paso.Texto)?")) { Write-Host "-> [$id] omitido"; $omitidos += $id; continue }
        if ($id -eq 'registrar') {
            $problema = Validar-Registro
            if ($problema) { Write-Host "-> [$id] falta: $problema"; $fallan += $id; $usoMalo = $true; continue }
        }
        try {
            & $paso.Hacer
        } catch {
            Write-Host "-> [$id] error: $($_.Exception.Message)"
            $fallan += $id; continue
        }
        $despues = Ejecutar-Comprobacion $paso.Comprobar
        if (Esta-Hecho $id $despues) { Write-Host "-> [$id] ok: $($despues.Detalle)"; $hechos += $id }
        else { Write-Host "-> [$id] falta: $($despues.Detalle). $($despues.Arreglo)"; $fallan += $id }
    }
    Write-Host ''
    Write-Host ("RESUMEN: hechos={0}; ya estaban={1}; fallan={2}; omitidos={3}" -f ($hechos -join ','), ($yaEstaban -join ','), ($fallan -join ','), ($omitidos -join ','))
    if ($hechos | Where-Object { $_ -in 'git', 'node', 'ffmpeg', 'python', 'claude', 'registrar' }) {
        Avisar 'Para que Claude vea lo instalado y a Drazo Studio: cierra la app de Claude (o Claude Code) y vuelve a abrirla.' 'Cyan'
    }
    if (-not $Si) {
        Write-Host ''
        Write-Host '== Comprobación final' -ForegroundColor Cyan
        & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Plugin 'scripts\doctor.ps1')
        Avisar 'Después abre Claude en tu carpeta de trabajo y escribe «Hola Drazo Studio».' 'Cyan'
    }
    $script:CodigoSalida = if ($usoMalo) { 2 } elseif ($fallan.Count) { 1 } else { 0 }
}

# Principal no devuelve nada a propósito: así la salida de winget, pip o npm se ve en pantalla.
$Plugin = Preparar-Plugin
try {
    . (Join-Path $Plugin 'scripts\comun.ps1')
    Principal
} finally {
    if ($CarpetaTemporal) { Remove-Item -LiteralPath $CarpetaTemporal -Recurse -Force -ErrorAction SilentlyContinue }
}
exit $CodigoSalida
