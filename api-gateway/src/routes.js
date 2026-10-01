// Tabla central de enrutamiento del Gateway.
// El prefijo público coincide exactamente con lo que ya usa el front de TicketU.
// El Gateway NO elimina ni reescribe /api/<modulo>: el microservicio recibe el
// mismo path que llegó desde el front.

const routes = [
  { module: "auth", prefix: "/api/auth", env: "AUTH_SERVICE_URL" },
  { module: "catalogo", prefix: "/api/catalogo", env: "CATALOGO_SERVICE_URL" },
  { module: "entradas", prefix: "/api/entradas", env: "ENTRADAS_SERVICE_URL" },
  { module: "pagos", prefix: "/api/pagos", env: "PAGOS_SERVICE_URL" },
  { module: "checkin", prefix: "/api/checkin", env: "CHECKIN_SERVICE_URL" },
  { module: "resenas", prefix: "/api/resenas", env: "RESENAS_SERVICE_URL" },
  { module: "organizador", prefix: "/api/organizador", env: "ORGANIZADOR_SERVICE_URL" },
  { module: "notificaciones", prefix: "/api/notificaciones", env: "NOTIFICACIONES_SERVICE_URL" },
  { module: "promociones", prefix: "/api/promociones", env: "PROMOCIONES_SERVICE_URL" },
];

function getResolvedRoutes() {
  return routes.map((route) => ({
    ...route,
    target: process.env[route.env]?.trim() || null,
  }));
}

function findRoute(pathname, resolvedRoutes) {
  return resolvedRoutes.find(
    (route) => pathname === route.prefix || pathname.startsWith(`${route.prefix}/`)
  );
}

module.exports = {
  routes,
  getResolvedRoutes,
  findRoute,
};
