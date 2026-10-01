const dotenv = require("dotenv");

dotenv.config();

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const port = parsePositiveInteger(process.env.PORT, 8080);
const proxyTimeoutMs = parsePositiveInteger(process.env.PROXY_TIMEOUT_MS, 5000);

const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

module.exports = {
  port,
  proxyTimeoutMs,
  corsOrigins,
};
