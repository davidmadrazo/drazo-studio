// Bucle JSON-RPC por stdio para los servidores MCP locales del plugin.
// Sin dependencias: lee líneas de stdin, responde en stdout.

import { createInterface } from "node:readline"

export function servirStdio({ nombre, version, herramientas, ejecutar }) {
  const interfaz = createInterface({ input: process.stdin })
  const responder = (mensaje) => process.stdout.write(JSON.stringify(mensaje) + "\n")

  interfaz.on("line", async (linea) => {
    const texto = linea.trim()
    if (!texto) return
    let peticion
    try { peticion = JSON.parse(texto) } catch { return }
    if (!peticion || typeof peticion !== "object" || peticion.jsonrpc !== "2.0") return
    const { id, method, params } = peticion
    const esNotificacion = id === undefined || id === null
    try {
      if (method === "initialize") {
        responder({ jsonrpc: "2.0", id, result: {
          protocolVersion: params?.protocolVersion ?? "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: nombre, version },
        } })
        return
      }
      if (method === "notifications/initialized" || method?.startsWith("notifications/")) return
      if (method === "ping") { responder({ jsonrpc: "2.0", id, result: {} }); return }
      if (method === "tools/list") {
        responder({ jsonrpc: "2.0", id, result: { tools: herramientas } })
        return
      }
      if (method === "tools/call") {
        const nombreHerramienta = params?.name
        const herramienta = herramientas.find((h) => h.name === nombreHerramienta)
        if (!herramienta) throw new Error(`Herramienta desconocida: ${nombreHerramienta}`)
        const texto = await ejecutar(nombreHerramienta, params?.arguments ?? {})
        responder({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: typeof texto === "string" ? texto : JSON.stringify(texto) }] } })
        return
      }
      if (!esNotificacion) responder({ jsonrpc: "2.0", id, error: { code: -32601, message: `Método no soportado: ${method}` } })
    } catch (error) {
      if (esNotificacion) return
      responder({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `ERROR: ${error.message}` }], isError: true } })
    }
  })

  interfaz.on("close", () => process.exit(0))
}

export function exigirEntorno(nombre) {
  const valor = process.env[nombre]?.trim()
  if (!valor) throw new Error(`Falta ${nombre} en el entorno del plugin.`)
  return valor
}
