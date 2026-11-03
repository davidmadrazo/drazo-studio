# Pruebas de la versión de Node que elige el instalador de Windows (comun.ps1), con un index.json real
# recortado de nodejs.org (fixtures\nodejs-dist). Sin red y sin instalar nada.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File tests\instalador-node.tests.ps1
# Este fichero va en UTF-8 con BOM: sin BOM, PowerShell 5.1 rompe las tildes.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
# Carpeta de datos de pruebas: comun.ps1 solo define rutas, pero así nada apunta a la de verdad
$env:CONTENT_OS_DATOS = Join-Path ([IO.Path]::GetTempPath()) 'drazo-studio-pruebas-node-no-se-crea'
. (Join-Path $PSScriptRoot '..\plugins\drazo-studio\scripts\comun.ps1')

$script:Fallos = 0
function Igual([string]$Nombre, $Sale, $Espera) {
    if ("$Sale" -eq "$Espera") { Write-Host "ok    $Nombre" }
    else { Write-Host "FALLA $Nombre`: esperaba «$Espera» y sale «$Sale»"; $script:Fallos++ }
}

$fixtures = Join-Path $PSScriptRoot 'fixtures\nodejs-dist'
$indice = Get-Content -LiteralPath (Join-Path $fixtures 'index.json') -Raw -Encoding UTF8
$conRed = ([Uri](Join-Path $fixtures '.')).AbsoluteUri.TrimEnd('/')
$sinRed = 'http://127.0.0.1:9'
$respaldoReal = $VersionNodeRespaldo

Igual 'rama 24 de index.json' (Elegir-VersionNode $indice 24) '24.22.1'
Igual 'rama 22 de index.json' (Elegir-VersionNode $indice 22) '22.23.4'
Igual 'rama 20 de index.json' (Elegir-VersionNode $indice 20) '20.20.2'
Igual 'rama que no está' (Elegir-VersionNode $indice 18) ''

# Con un respaldo inventado, para distinguir lo que sale de index.json de lo que sale del respaldo
$VersionNodeRespaldo = '24.9.9'
$UrlNodeDist = $conRed
Igual 'instala la última 24 publicada' (Resolver-VersionNode) '24.22.1'
$UrlNodeDist = $sinRed
Igual 'sin red, la de respaldo' (Resolver-VersionNode) '24.9.9'
$VersionNodeRespaldo = '24.30.0'
$UrlNodeDist = $conRed
Igual 'index.json más viejo que el respaldo, el respaldo' (Resolver-VersionNode) '24.30.0'
$VersionNodeRespaldo = $respaldoReal
$UrlNodeDist = $sinRed
Igual 'sin red, el respaldo de verdad' (Resolver-VersionNode) '24.22.1'

# Salida real de «winget show --id OpenJS.NodeJS.LTS --versions» (en español), recortada
$winget = @('Encontrado Node.js (LTS) [OpenJS.NodeJS.LTS]', 'Versión', '-------', '24.22.1', '24.22.0', '24.21.0')
Igual 'winget ya tiene la resuelta' (Elegir-VersionWinget $winget '24.22.1') '24.22.1'
Igual 'winget aún no la tiene: la última 24 que tiene' (Elegir-VersionWinget $winget '24.23.0') '24.22.1'
Igual 'cuando LTS sea la 26, sigue en la 24' (Elegir-VersionWinget (@('26.12.1', '26.11.0') + $winget) '24.23.0') '24.22.1'
Igual 'sin poder leer winget, la resuelta' (Elegir-VersionWinget @('error') '24.22.1') '24.22.1'

Write-Host ''
if ($script:Fallos -eq 0) { Write-Host 'Todas las pruebas pasan.'; exit 0 }
Write-Host "$($script:Fallos) pruebas fallan."
exit 1
