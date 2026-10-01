// Ejemplo mínimo de CONSUMIDOR de eventos para TicketU.
//
// Uso:
//   npm run consumer -- pago.realizado
// o para escuchar todos los eventos de pagos:
//   npm run consumer -- 'pago.*'
//
// En un microservicio real, la cola debe tener un nombre estable y propio.
// RabbitMQ guarda los mensajes de una cola durable aunque el consumidor se
// reinicie, siempre que los mensajes se publiquen como persistentes.

require("dotenv").config();
const amqp = require("amqplib");

const brokerUrl = process.env.BROKER_URL ?? "amqp://ticketu:ticketu_dev@localhost:5672/ticketu";
const exchange = process.env.EVENT_EXCHANGE ?? "ticketu.events";
const queueName = process.env.QUEUE_NAME ?? "demo.notificaciones";
const bindingKey = process.argv[2] ?? "pago.realizado";

async function main() {
  const connection = await amqp.connect(brokerUrl);
  const channel = await connection.createChannel();

  await channel.assertExchange(exchange, "topic", { durable: true });
  await channel.assertQueue(queueName, { durable: true });
  await channel.bindQueue(queueName, exchange, bindingKey);

  // Evita entregar una cantidad ilimitada de mensajes al mismo consumidor
  // mientras aún está procesando los anteriores.
  channel.prefetch(10);

  console.log(`Esperando eventos '${bindingKey}' en la cola '${queueName}'...`);
  console.log("Ctrl+C para detener.");

  await channel.consume(
    queueName,
    async (message) => {
      if (!message) return;

      try {
        const event = JSON.parse(message.content.toString("utf8"));
        console.log("Evento recibido:");
        console.log(JSON.stringify(event, null, 2));

        // Aquí va la lógica del microservicio consumidor.
        // Ejemplo para Notificaciones:
        // await enviarCorreoConfirmacion(event.data.usuarioId);

        // ACK = confirmamos a RabbitMQ que el mensaje terminó bien.
        // Recién entonces puede retirarlo de la cola.
        channel.ack(message);
      } catch (error) {
        console.error("Error procesando mensaje:", error.message);

        // Para el ejemplo, no reencolamos mensajes inválidos para evitar
        // un ciclo infinito. En el proyecto real se puede definir una DLQ.
        channel.nack(message, false, false);
      }
    },
    { noAck: false }
  );

  async function close() {
    console.log("\nCerrando consumidor...");
    await channel.close();
    await connection.close();
    process.exit(0);
  }

  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}

main().catch((error) => {
  console.error("No se pudo iniciar el consumidor:", error.message);
  process.exit(1);
});
