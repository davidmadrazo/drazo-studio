# Drazo Studio

Drazo Studio es tu sistema de contenido dentro de Claude. Le pides «ganchos para esta idea», «escribe el
guion» o «diseca este reel» y lo hace con el método de ProfimaxIA, apoyándose en los virales de tu nicho. Todo
se guarda en tu propia app, con tu calendario, tus guardados y tus cifras.

## Qué necesitas

- Un ordenador con **Windows 10 u 11** (64 bits) o un **Mac con macOS 13** o superior.
- Una suscripción de pago a Claude (Pro o Max).
- Tu **clave de licencia de Drazo Studio**. Empieza por `cos_` y te la enviamos al darte de alta.
- Unos **6 GB libres** en el disco y, mejor, 16 GB de memoria (mínimo 8).
- Durante la instalación, crearás tres cuentas a tu nombre, gratis para empezar:
  - [Supabase](https://supabase.com), tu base de datos;
  - [Vercel](https://vercel.com), tu web;
  - [Apify](https://apify.com), las cifras de los virales (su plan gratis trae crédito cada mes).

## Instalar sin tocar la terminal

1. Descarga la **app de escritorio de Claude** desde [claude.com/download](https://claude.com/download) y entra con tu cuenta.
2. Crea una carpeta vacía, por ejemplo «Drazo Studio» dentro de Documentos. En la app, abre la pestaña **Code**
   y elige esa carpeta.
3. Pega este mensaje en el chat, con tu clave al final:

   > Instala Drazo Studio siguiendo https://raw.githubusercontent.com/davidmadrazo/drazo-studio/main/INSTALAR.md. Mi clave de licencia es cos_…

4. Claude lo instala todo. Tú aceptas los permisos que te pida, creas tus cuentas cuando te lo diga y le pegas
   sus claves. En Windows verás ventanas «¿Quieres permitir que esta aplicación haga cambios?»: pulsa **Sí**. En
   Mac puede abrirse una ventana de Apple para instalar las herramientas de desarrollo: pulsa **Instalar**.
5. Al acabar te da la dirección de tu web y tu contraseña: guárdala. Después, **cierra la app de Claude del todo
   y vuelve a abrirla**.

## Tu primer día

1. Abre una conversación nueva en la pestaña **Code**, en tu carpeta de Drazo Studio.
2. Escribe **«Hola Drazo Studio»**. Te hará unas preguntas sobre tu marca, una a una (a qué te dedicas, a quién
   le hablas, tus pilares y tres cuentas de referencia de tu nicho). Solo se hace una vez.
3. Después leerá los virales de tus cuentas de referencia y los verá en tu ordenador. Con eso ya puedes pedir.

## Qué le puedes pedir

| Escribe | Qué hace |
|---|---|
| «Puntúa estas ideas: …» | La nota de cada idea y si merece vídeo |
| «Ganchos para …» | Una tanda de ganchos apoyados en los virales de tu banco |
| «Escribe el guion con el gancho 3» | El guion completo, con llamada a la acción y notas de grabación |
| «Corrige este guion: …» | Qué falla, qué cambiar y varias versiones mejores |
| «Diseca este reel: enlace» | Lo ve en tu ordenador, lo transcribe y te explica por qué funcionó |
| «Hazme las propuestas de mis guardados» | Convierte tus reels guardados en vídeos para tu calendario |
| «Historias de …» / «Un carrusel de …» | La secuencia de historias o el carrusel completo |
| «¿Qué tengo esta semana?» | Tu calendario |
| «¿Cuántas me quedan este mes?» | Lo que llevas de tu plan |

Tu plan incluye un número de piezas al mes de cada tipo (se renueva el día 1). Pregunta «¿cuántas me quedan?»
para verlo.

## Tus datos y tus vídeos

- Tu app, tu base de datos y tu web están en tus cuentas. Desde tu web, en «Tus datos», puedes descargarlo todo
  en un zip o borrarlo.
- Los reels se bajan, se transcriben y se miran en tu ordenador. Al servicio de Drazo Studio solo viaja texto
  (por ejemplo, la transcripción de un viral) para preparar cada pieza.
- Si dejas Drazo Studio, tu app y tus datos se quedan contigo; deja de funcionar la generación con el método.

### Qué se instala en tu ordenador

Git, Node.js 24 (siempre con sus parches de seguridad), ffmpeg, Python con un entorno propio de Drazo Studio
que no toca tus otros programas, el modelo que transcribe en local (unos 1,6 GB), el navegador con el que se
ven los reels y el plugin de Drazo Studio para Claude. Todo va en su propia carpeta: `%LOCALAPPDATA%\DrazoStudio`
en Windows y `~/.local/share/drazo-studio` en Mac.

## Si algo falla

1. Pregúntale a Claude: **«revisa mi instalación»**. Te dice qué falta y lo arregla.
2. Vuelve a pegar el mensaje de instalación: comprueba todo otra vez e instala solo lo que falte.

| Qué ves | Qué hacer |
|---|---|
| «Licencia inactiva» o «clave no válida» | Tu suscripción no está activa o la clave no es correcta. Escríbenos. |
| «Tu licencia está conectada a otro Drazo Studio» | Si has reinstalado, escríbenos y la liberamos. |
| «Paquete agotado» | Has usado todo lo de ese tipo este mes; se renueva el día 1. |
| Claude no conoce Drazo Studio | Cierra la app del todo y vuelve a abrirla. Si sigue, vuelve a pegar el mensaje de instalación. |
| Drazo Studio avisa de que tu Node.js no tiene el último parche | Puedes seguir. Para ponerlo al día, dile «actualiza el Node.js de Drazo Studio». |

## Contacto

Soporte de **ProfimaxIA**: davidmadrazo@profimaxia.com. Si nos mandas lo que dice «revisa mi instalación», lo
resolvemos antes.

El uso de Drazo Studio se rige por sus condiciones de uso, que aceptas al activar tu licencia.
