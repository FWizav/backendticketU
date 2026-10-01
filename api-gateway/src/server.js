const express = require("express");
const cors = require("cors");
const httpProxy = require("http-proxy");
const crypto = require("crypto");

const { port, proxyTimeoutMs, corsOrigins } = require("./config");
const { getResolvedRoutes, findRoute } = require("./routes");

const app = express();
const resolvedRoutes = getResolvedRoutes();

// El proxy reenvía la petición HTTP al microservicio correspondiente.
// "xfwd" agrega cabeceras X-Forwarded-* útiles para logs y trazabilidad.
const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  xfwd: true,
});

// CORS se resuelve aquí una sola vez para el front.
// Los microservicios no necesitan habilitar CORS para el navegador si solo
// reciben tráfico del Gateway.
const corsOptions = {
  credentials: true,
  origin(origin, callback) {
    // Permite herramientas sin Origin (curl, Postman y comunicación servidor-servidor).
    if (!origin) return callback(null, true);

    if (corsOrigins.includes("*") || corsOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`Origen CORS no permitido: ${origin}`));
  },
};

app.use(cors(corsOptions));

// Request ID simple para poder correlacionar logs Gateway <-> microservicio.
app.use((req, res, next) => {
  const requestId = req.get("x-request-id") || crypto.randomUUID();
  req.ticketuRequestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "ticketu-api-gateway",
    timestamp: new Date().toISOString(),
    routes: resolvedRoutes.map(({ module, prefix, env, target }) => ({
      module,
      prefix,
      env,
      configured: Boolean(target),
    })),
  });
});

// Manejo central de errores del proxy. Un microservicio caído no hace que el
// Gateway se cierre: el cliente recibe un 502 controlado.
proxy.on("error", (error, req, res) => {
  console.error(
    `[gateway] proxy_error requestId=${req.ticketuRequestId ?? "-"} path=${req.url} error=${error.code ?? error.message}`
  );

  if (res.headersSent) {
    res.end();
    return;
  }

  res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
  res.end(
    JSON.stringify({
      error: "BAD_GATEWAY",
      message: "El microservicio de destino no está disponible o no respondió a tiempo.",
      requestId: req.ticketuRequestId ?? null,
    })
  );
});

proxy.on("proxyReq", (proxyReq, req) => {
  if (req.ticketuRequestId) {
    proxyReq.setHeader("x-request-id", req.ticketuRequestId);
  }
});

// Middleware único para las 9 rutas. No se monta bajo un prefijo de Express
// para evitar que Express recorte el path: el microservicio recibe exactamente
// /api/<modulo>/... tal como lo envió el front.
app.use((req, res, next) => {
  const route = findRoute(req.path, resolvedRoutes);

  if (!route) return next();

  if (!route.target) {
    return res.status(503).json({
      error: "SERVICE_NOT_CONFIGURED",
      message: `El módulo '${route.module}' no tiene configurada la variable ${route.env}.`,
      requestId: req.ticketuRequestId,
    });
  }

  console.log(
    `[gateway] requestId=${req.ticketuRequestId} method=${req.method} path=${req.originalUrl} module=${route.module}`
  );

  proxy.web(req, res, {
    target: route.target,
    proxyTimeout: proxyTimeoutMs,
    timeout: proxyTimeoutMs,
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: "ROUTE_NOT_FOUND",
    message: "Ruta no registrada en el API Gateway.",
    path: req.originalUrl,
    requestId: req.ticketuRequestId,
  });
});

// Error de CORS u otro error de middleware previo al proxy.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (String(error.message).startsWith("Origen CORS no permitido:")) {
    return res.status(403).json({
      error: "CORS_NOT_ALLOWED",
      message: error.message,
      requestId: req.ticketuRequestId ?? null,
    });
  }

  console.error("[gateway] unexpected_error", error);
  return res.status(500).json({
    error: "INTERNAL_GATEWAY_ERROR",
    message: "Ocurrió un error interno en el API Gateway.",
    requestId: req.ticketuRequestId ?? null,
  });
});

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`[gateway] TicketU API Gateway escuchando en http://0.0.0.0:${port}`);
  console.log(`[gateway] CORS permitido para: ${corsOrigins.join(", ")}`);

  for (const route of resolvedRoutes) {
    console.log(
      `[gateway] ${route.prefix} -> ${route.target ?? `[FALTA ${route.env}]`}`
    );
  }
});

function shutdown(signal) {
  console.log(`[gateway] ${signal}: cerrando servidor...`);
  server.close(() => {
    proxy.close();
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
