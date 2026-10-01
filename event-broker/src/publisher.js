// Ejemplo mínimo de PUBLICADOR de eventos para TicketU.
//
// Uso:
//   npm run publisher -- pago.realizado '{"pagoId":"p-123","eventoId":"e-9"}'
//
// La idea importante es esta:
// 1) el servicio realiza su operación local (por ejemplo, guardar un pago);
// 2) publica un hecho que YA ocurrió, como "pago.realizado";
// 3) no necesita saber qué otros servicios están escuchando ese evento.

require("dotenv").config();
const amqp = require("amqplib");

const brokerUrl = process.env.BROKER_URL ?? "amqp://ticketu:ticketu_dev@localhost:5672/ticketu";
const exchange = process.env.EVENT_EXCHANGE ?? "ticketu.events";

const eventName = process.argv[2] ?? "pago.realizado";
const rawPayload = process.argv[3] ?? JSON.stringify({
  pagoId: "p-123",
  eventoId: "e-9",
  usuarioId: "u-42",
  monto: 12000,
  moneda: "CLP",
});

async function main() {
  let payload;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    throw new Error("El payload debe ser un JSON válido.");
  }

  const connection = await amqp.connect(brokerUrl);
  const channel = await connection.createConfirmChannel();

  // Un exchange 'topic' permite suscribirse a un evento exacto
  // (pago.realizado) o a familias de eventos (pago.*).
  await channel.assertExchange(exchange, "topic", { durable: true });

  const envelope = {
    eventId: cryptoRandomId(),
    eventName,
    occurredAt: new Date().toISOString(),
    source: "ejemplo-publicador",
    data: payload,
  };

  channel.publish(
    exchange,
    eventName,
    Buffer.from(JSON.stringify(envelope)),
    {
      contentType: "application/json",
      persistent: true,
      timestamp: Date.now(),
    }
  );

  // Un ConfirmChannel permite esperar la confirmación del broker antes de
  // cerrar la conexión. Así evitamos terminar el proceso demasiado pronto.
  await channel.waitForConfirms();

  console.log(`Evento publicado: ${eventName}`);
  console.log(JSON.stringify(envelope, null, 2));

  await channel.close();
  await connection.close();
}

function cryptoRandomId() {
  return require("crypto").randomUUID();
}

main().catch((error) => {
  console.error("No se pudo publicar el evento:", error.message);
  process.exit(1);
});
