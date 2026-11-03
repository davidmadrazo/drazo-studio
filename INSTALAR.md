# Instalar Drazo Studio — instrucciones para Claude

Este documento es para ti, Claude. Un miembro de Drazo Studio te ha pegado este enlace y su clave de licencia
(empieza por `cos_`). Lo instalas tú con tus herramientas; la persona solo aprueba los permisos y crea sus
cuentas cuando se lo pidas.

Si lo has leído con una herramienta que resume, descárgalo entero con la terminal (`Invoke-WebRequest` en
Windows, `curl` en Mac) y léelo completo antes de empezar: las órdenes tienen que ir exactas.

## Cómo trabajar

- Habla siempre en el idioma del usuario (en español si te escribe en español), también en los mensajes cortos
  entre una herramienta y otra. Sin jerga, rutas ni comandos salvo que los pida.
- No le preguntes qué instalar ni le pidas permiso en el chat: pegar este enlace ya es su sí. Antes de cada
  bloque cuéntale en una línea qué vas a hacer, sin esperar respuesta. Solo le pides lo que solo puede hacer él:
  aceptar permisos, crear sus cuentas y pegarte sus claves.
- Sus claves (licencia, tokens) no se repiten enteras en el chat: como mucho los cuatro últimos caracteres. Van
  a ficheros de su ordenador y a sus propias cuentas; a nadie más.
- Trabaja siempre en la carpeta de esta conversación: será su carpeta de Drazo Studio. Tiene que estar vacía (o
  con solo lo que crea la app de Claude). Si no lo está, pídele que abra Claude en una carpeta nueva, por
  ejemplo «Drazo Studio» dentro de Documentos, y para.
- No instales nada fuera de estos pasos ni toques otros ficheros. En Mac, nada de `sudo` ni Homebrew.
- Las órdenes en primer plano se cortan a los 10 minutos: lanza en segundo plano (`run_in_background`) las que
  lo digan y mira su salida cada minuto o dos hasta que aparezca la línea `RESUMEN:`.
- Los scripts escriben una línea por paso: `-> [paso] ok|ya estaba|falta|error|pendiente: ...`, y al final
  `RESUMEN: ...`. Código de salida: 0 bien · 1 algún paso no quedó bien · 2 uso incorrecto · 3 equipo no
  compatible · 4 esperando al usuario.
- Si un paso falla dos veces, para, cuéntale qué pasa en una frase y ofrécele escribir al soporte de
  ProfimaxIA (davidmadrazo@profimaxia.com) con la salida del paso.

## 1. Mira qué sistema es

- **Windows 10 u 11**: usa la herramienta PowerShell para todo este documento.
- **macOS 13 o superior**: usa la terminal Bash.
- **Otro (Linux, WSL)**: dile que Drazo Studio funciona en Windows y en Mac, y para.

## 2. Descarga el instalador

Windows:

```powershell
$d = "$env:LOCALAPPDATA\DrazoStudio\instalador"; New-Item -ItemType Directory -Force $d | Out-Null; foreach ($f in 'instalar.ps1', 'plugins/drazo-studio/scripts/descargar-paquete.mjs') { Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/davidmadrazo/drazo-studio/main/$f" -OutFile (Join-Path $d (Split-Path $f -Leaf)) }
```

macOS:

```bash
d=~/.local/share/drazo-studio/instalador; mkdir -p "$d" && for f in instalar.sh plugins/drazo-studio/scripts/descargar-paquete.mjs; do curl -fsSL "https://raw.githubusercontent.com/davidmadrazo/drazo-studio/main/$f" -o "$d/$(basename "$f")" || break; done
```

Comprobación: los dos ficheros existen y no están vacíos. En el resto del documento:

- **INSTALAR** es, en Windows, `powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\DrazoStudio\instalador\instalar.ps1"` y, en macOS, `bash ~/.local/share/drazo-studio/instalador/instalar.sh`.
- **DESCARGAR** es, en Windows, `node "$env:LOCALAPPDATA\DrazoStudio\instalador\descargar-paquete.mjs"` y, en macOS, `node ~/.local/share/drazo-studio/instalador/descargar-paquete.mjs`.
- **APP** es `node scripts/instancia/instalar.mjs`, siempre desde esta carpeta.

## 3. Mira qué falta (no cambia nada)

Windows: `INSTALAR -SoloComprobar` · macOS: `INSTALAR --solo-comprobar`

Lee la tabla y la lista «Esto haría el instalador». Cuéntale en una frase que vas a instalar lo que falta y sigue.
Si el equipo no es compatible (código 3), díselo y para.

## 4. Instala lo que falte, por bloques

Haz solo los bloques con algún paso en la lista del paso 3, en este orden, y pasa solo esos pasos:
Windows `INSTALAR -Si -Pasos <pasos separados por comas>` · macOS `INSTALAR --si --pasos <pasos>`.

**Bloque A · programas base** (`git`, `node`, `ffmpeg`, `python`; y `claude` solo si la lista lo pide).
Di algo como: «Instalo los programas que usa Drazo Studio: Git, Node.js, ffmpeg (para ver los vídeos) y Python».
- Windows, avísale antes: «Windows te mostrará una o varias ventanas "¿Quieres permitir que esta aplicación haga
  cambios en el dispositivo?": pulsa "Sí" en cada una».
- Mac, si falta `git`: «Se abrirá una ventana de Apple para instalar las herramientas de desarrollo: pulsa
  "Instalar" y espera a que termine». Si acaba en `pendiente` (código 4), espera a que diga que ha terminado y
  repite solo `git`.

**Bloque B · Python de Drazo Studio y modelo** (`venv`, `modelo`), en segundo plano.
Di algo como: «Preparo el Python de Drazo Studio y descargo el modelo que transcribe los vídeos en tu ordenador:
son unos 2 GB y tarda un rato. Mientras, seguimos con lo demás».

**Bloque C · el navegador que ve los reels** (`playwright`), en segundo plano.

No esperes a B ni a C para seguir con el paso 5: solo hacen falta antes de la comprobación final.

## 5. Baja Drazo Studio a esta carpeta

Di algo como: «Ahora bajo tu Drazo Studio a esta carpeta con tu licencia».

`DESCARGAR --licencia <clave> --carpeta "$PWD"`

Comprobación: `-> [paquete] ok` y, en la carpeta, `PAQUETE.json`, `package.json` y `CLAUDE.md`. Si la licencia
no está activa, díselo con el mensaje tal cual y ofrécele el soporte.

Después, en segundo plano: `npm install` (unos minutos).

## 6. Sus cuentas, una a una

Estas cuentas son suyas y lo que guardan es suyo. Pídeselas de una en una: qué es, para qué la usa Drazo Studio,
qué cuesta y exactamente qué tiene que hacer. Espera a que te pegue cada clave antes de pasar a la siguiente.

**6.1 · Sus datos de acceso.** Pregúntale con qué correo quiere entrar en su app (mejor el suyo de siempre).
Luego: `APP preparar --licencia <clave> --nucleo https://drazostudio.profimaxia.com --email <correo>`.

**6.2 · Supabase (su base de datos; gratis para empezar).** «Entra en supabase.com, crea tu cuenta (puedes
entrar con Google) y después ve a tu cuenta → Access Tokens → Generate new token, ponle de nombre "Drazo Studio"
y pégame el token (empieza por `sbp_`)». Con él:

1. `APP supabase --token <sbp_...>`, en segundo plano: crea su proyecto en Europa y tarda unos minutos. Si
   tiene varias organizaciones (código 4), pregúntale cuál y repite con `--org <slug>`. Si su plan gratis ya
   tiene dos proyectos, díselo: tiene que borrar uno o usar otra cuenta.
2. `APP bd`: crea las tablas.
3. `APP usuario`: crea su cuenta en su app y saca una contraseña. **Dásela en el chat, una sola vez, y pídele
   que la guarde** (gestor de contraseñas o donde guarde las suyas): es con la que entra en la web.

**6.3 · Apify (las cifras de los virales; plan gratis con crédito al mes).** «Entra en apify.com, crea tu cuenta
gratis y ve a Settings → API & Integrations; copia tu Personal API token (empieza por `apify_api_`) y pégamelo».
Explícale que con ella su app sabe cuántas visitas tiene cada viral frente a la media de su creador: sin eso no
hay banco ni ganchos con referencias. El radar y los guardados gastan de su crédito de Apify.
Con ella: `APP claves --apify <apify_api_...>`.

**6.4 · Vercel (su web; gratis para empezar).** «Entra en vercel.com, crea tu cuenta (plan Hobby, puedes entrar
con Google o GitHub) y ve a Account Settings → Tokens → Create; ponle "Drazo Studio", sin caducidad o de un
año, y pégame el token». Avísale de que Vercel pide el plan Pro si el uso es comercial.
Con él, en segundo plano: `APP vercel --token <token>` (publica su app; unos minutos). Después: `APP crons`.

Su cuenta de Instagram para sus propias cifras es opcional: no la pidas ahora. Si algún día la quiere, es
`APP claves --instagram <token>` y volver a pasar `APP vercel` y `APP crons`.

## 7. Conecta Drazo Studio con su Claude

Di algo como: «Conecto Drazo Studio con tu Claude».

Lee de `.env.local` de esta carpeta `NEXT_PUBLIC_SITE_URL` (la dirección de su app) y `MAQUINA_TOKEN_INSTANCIA`
(el token que une el plugin con su app) sin mostrarlos en el chat, y pásalos:

- Windows: `INSTALAR -Si -Pasos registrar -InstanciaUrl <url> -Token <token> -Carpeta "$PWD"`
- macOS: `INSTALAR --si --pasos registrar --instancia-url <url> --token <token> --carpeta "$PWD"`

Comprobación: `-> [registrar] ok`. Si los ajustes de Claude no son JSON válido, el instalador no los toca:
díselo y ofrécele el soporte.

## 8. Comprobación final

Espera a que terminen los bloques B y C, y después:

1. Windows `INSTALAR -Doctor` · macOS `INSTALAR --doctor`. Todo en verde; «Tu Drazo Studio» y «Licencia» tienen
   que decir ok. Un aviso por el plan de Claude no impide seguir.
2. `APP estado`. Todo en verde.

Si algo falta, repite solo ese paso. Si la licencia dice «conectada a otro Drazo Studio», díselo y ofrécele el
soporte (hay que liberarla).

## 9. Reinicia y empieza

Díselo así: «¡Listo! Cierra la app de Claude del todo (en Mac, Cmd+Q; en Windows, ciérrala también desde el icono
junto al reloj) y vuelve a abrirla. Abre una conversación nueva en la pestaña Code, en esta misma carpeta, y
escribe "Hola Drazo Studio": te haré unas preguntas sobre tu marca, una a una, y después leeremos los virales de
tus cuentas de referencia. Tu web es <su URL>; entras con tu correo y la contraseña que te he dado».

## Para actualizar Drazo Studio

- **Su app**: «actualiza Drazo Studio» → sigue `ACTUALIZAR.md` de su carpeta.
- **El plugin**: vuelve a descargar el instalador (paso 2) y repite solo el paso 7. Después, cerrar la app de
  Claude del todo y abrirla.

## Si Drazo Studio avisa de que Node.js no tiene los parches

El aviso no impide trabajar. Si pide actualizarlo, sin preguntar: vuelve a descargar el instalador (paso 2) y
pasa solo el paso `node` (Windows `INSTALAR -Si -Pasos node`; macOS `INSTALAR --si --pasos node`). En Windows,
avísale antes de la ventana «¿Quieres permitir que esta aplicación haga cambios?» («Sí»). Después, cerrar la
app de Claude del todo y abrirla.

## Si después de reiniciar Drazo Studio no responde

- Pasa el doctor (paso 8; antes, el paso 2 si el instalador ya no está) y `APP estado`.
- Si el plugin no está registrado o no está descargado, repite el paso 7 y vuelve a cerrar y abrir la app.
- Si su app no responde, `APP vercel --token <token>` la vuelve a publicar (el token está en `.env.local`).
- En Windows, si Claude no encuentra `node`, `ffmpeg` o `git` justo después de instalarlos, es normal hasta
  cerrar y abrir la app.

## Desinstalar

Si lo pide: quita de los ajustes de Claude (con copia de seguridad) `extraKnownMarketplaces.drazo-studio`,
`enabledPlugins["drazo-studio@drazo-studio"]` y `pluginConfigs["drazo-studio@drazo-studio"]`, y borra la
carpeta de datos (`%LOCALAPPDATA%\DrazoStudio` en Windows, `~/.local/share/drazo-studio` en Mac); en Mac, quita
también las líneas «Drazo Studio» de `~/.zshenv` y `~/.zshrc`. Su app, su carpeta y sus cuentas (Supabase,
Vercel, Apify) son suyas: no las borres salvo que lo pida expresamente, y antes ofrécele descargar sus datos
desde «Tus datos» en su web.
