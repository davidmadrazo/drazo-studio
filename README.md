# Drazo Studio

Drazo Studio es el sistema de contenido de Hazlo Viral, dentro de Claude Code. Cada semana estudia los vídeos
virales de las cuentas que tú eliges y te los deja explicados. Con eso le pides a tu Claude ideas, ganchos y
guiones para tu marca, y te los guarda en tu calendario.

Este plugin es solo la conexión: todo el trabajo se hace en el servidor de Drazo Studio. En tu ordenador no se
instala ninguna aplicación ni se guarda nada del sistema.

## Qué necesitas

- **Tu licencia de Drazo Studio.** Empieza por `drz_` y te llega al entrar en Hazlo Viral. Sin licencia, el
  plugin no hace nada.
- **Claude Code** con una suscripción de pago a Claude.
- **Node.js 24** en tu ordenador. Si no lo tienes, pídeselo a tu Claude: «instálame Node.js 24».
- **Una cuenta de Apify.** Vale la gratuita. Drazo Studio lee tus cuentas de referencia con ella.

## Instalar

En Claude Code, escribe:

```
/plugin marketplace add davidmadrazo/drazo-studio
```

```
/plugin install drazo-studio@drazo-studio
```

Cuando te pida «Tu licencia de Drazo Studio», pégala. Cierra Claude Code y vuelve a abrirlo.

El paso a paso está en [INSTALAR.md](INSTALAR.md).

## Tu primer día

Escribe **«Hola Drazo Studio»**. Tu Claude te pregunta por tu marca y por tus cuentas de referencia, y te da un
enlace para conectar tu Apify. La clave de Apify se pega en esa página, nunca en el chat. En unos minutos tienes
tus primeros virales estudiados.

## Qué le puedes pedir

| Tú dices | Qué pasa |
|---|---|
| «Enséñame mi semana» | Los virales de tus cuentas de referencia, con por qué funcionó cada uno |
| «Enséñame el segundo» | Su transcripción, lo que se ve y sus fotogramas |
| «Quiero replicar este» y un enlace | El servidor estudia ese vídeo |
| «Dame ideas» | Ideas para tu marca, con su nota |
| «Hazme ganchos para…» | Opciones numeradas para elegir |
| «Hazme el guion» | El guion listo para grabar |
| «Revisa este guion» | Tu guion corregido |
| «Guárdalo para el jueves» | Queda en tu calendario |
| «Acuérdate de que…» | Una regla tuya que se tiene en cuenta siempre |
| «Cuánto me queda» | Lo que llevas usado de tu plan |

## Tu licencia

Una licencia vale para una persona, una marca y un ordenador. Si cambias de ordenador, escríbenos y la liberamos.
No la compartas: si se usa desde dos sitios a la vez, se pausa.

## Ayuda

Escribe a davidmadrazo@profimaxia.com.
