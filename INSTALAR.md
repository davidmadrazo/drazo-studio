# Instalar Drazo Studio: instrucciones para Claude

Este documento es para ti, Claude. Un miembro de Hazlo Viral te ha pegado este enlace y su licencia de Drazo Studio (empieza por `drz_`). Lo instalas tú con tus herramientas; la persona solo acepta los permisos que le pidas.

Si lo has leído con una herramienta que resume, descárgalo entero con la terminal y léelo completo antes de empezar.

## Cómo trabajar

- Habla en el idioma de la persona, en llano y sin jerga, rutas ni órdenes salvo que las pida.
- No le preguntes qué instalar: pegar este enlace ya es su sí. Antes de cada paso dile en una línea qué vas a hacer.
- No repitas la licencia entera en el chat: como mucho, sus cuatro últimos caracteres.
- No instales nada fuera de estos pasos.
- Si un paso falla dos veces, para, cuéntaselo en una frase y dile que escriba al soporte de ProfimaxIA (davidmadrazo@profimaxia.com).

## 1. Comprueba Node.js

Ejecuta `node -v`. Si contesta con una versión 22 o superior, sigue. Si no está o es más antigua, instala Node.js 24:

- Windows: `winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements`. Avísale antes de que Windows le pedirá permiso en una ventana: que pulse «Sí».
- macOS: descarga el instalador de la versión 24 desde nodejs.org y ábrelo; no uses `sudo` ni Homebrew.

Después de instalarlo hay que cerrar y volver a abrir la app para que lo vea.

## 2. Instala el plugin

Ejecuta, una detrás de otra:

```
claude plugin marketplace add davidmadrazo/drazo-studio
```

```
claude plugin install drazo-studio@drazo-studio --config licencia=LA_LICENCIA_QUE_TE_HA_PEGADO
```

Comprobación: la segunda contesta «Successfully installed plugin: drazo-studio». Es normal que diga que queda una opción sin poner: es la dirección del servidor, que ya trae la buena.

Si la orden `claude` no existe en este equipo, pídele a la persona que escriba ella estas dos líneas en el chat, una detrás de otra, y que pegue su licencia cuando se la pida:

```
/plugin marketplace add davidmadrazo/drazo-studio
```

```
/plugin install drazo-studio@drazo-studio
```

## 3. Dile cómo se arranca

Dile, con estas palabras o parecidas:

> Ya está instalado. Cierra la app de Claude del todo y vuelve a abrirla. Después escríbeme: **Hola Drazo Studio**.

A partir de ahí te guía el propio Drazo Studio: le pregunta cuál es su Instagram, le abre su panel (que puede instalar como app en el móvil y en el ordenador), define su marca en el panel contestando unas preguntas, le pide sus cuentas de referencia y le da un enlace para conectar su Apify (la cuenta gratis vale). En unos minutos tiene sus primeros virales estudiados.

## Si ya lo tenía instalado

Para actualizarlo: `claude plugin marketplace update drazo-studio` y después `claude plugin update drazo-studio@drazo-studio`. La licencia se conserva.
