# TicketU — Backend compartido del Platform Team

Este repositorio contiene **dos componentes comunes** para todo TicketU. Se despliegan **una sola vez** y los usan los 9 grupos de backend:

1. **API Gateway**: una única puerta de entrada HTTP para el front. Recibe rutas como `/api/pagos/...` y reenvía la petición al microservicio correcto.
2. **Event Broker (RabbitMQ)**: un punto común para enviar eventos entre microservicios sin obligar a que ambos estén atendiendo la misma petición al mismo tiempo.

> Este repositorio **no contiene los 9 microservicios**. Cada grupo mantiene su microservicio en su propio repositorio/entorno, pero todos se conectan a la misma red Docker, al mismo Gateway y, cuando corresponda, al mismo RabbitMQ.

---

## 1. Por qué existen ambos componentes

### API Gateway: comunicación síncrona

Un **reverse proxy** es un servidor que recibe una petición en nombre de otros servidores y la reenvía al destino correcto. El API Gateway de TicketU hace eso: el front solo conoce `http://...:8080`, mientras el Gateway sabe dónde vive cada uno de los 9 microservicios.

Es **síncrono** porque quien hace la petición espera una respuesta en ese mismo flujo.

Ejemplo real de TicketU:

```text
Front pide GET /api/catalogo/eventos/123
          ↓
API Gateway decide que /api/catalogo/* pertenece a Catálogo
          ↓
Microservicio Catálogo responde el evento
          ↓
Gateway devuelve esa respuesta al Front
```

### RabbitMQ: comunicación asíncrona

Un **message broker** recibe mensajes/eventos de un servicio y los entrega a uno o más servicios consumidores. El servicio que publica no necesita llamar directamente a cada consumidor ni esperar a que terminen su trabajo.

Ejemplo concreto:

```text
Pagos confirma una compra
        ↓ publica "pago.realizado"
RabbitMQ
        ├──→ Entradas puede emitir/confirmar la entrada
        └──→ Notificaciones puede enviar la confirmación al usuario
```

La petición HTTP de pago puede terminar sin que Pagos tenga que llamar directamente a Notificaciones. Esto reduce acoplamiento entre grupos.

**Regla práctica:**

- Si el usuario necesita la respuesta ahora mismo: **Gateway + HTTP**.
- Si un servicio quiere informar que algo ya ocurrió para que otros reaccionen: **RabbitMQ + evento**.

---

## 2. Estructura del repositorio

```text
TicketU-backend/
├── README.md
├── .gitignore
├── api-gateway/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── .env.example
│   ├── package.json
│   └── src/
│       ├── config.js
│       ├── routes.js
│       └── server.js
└── event-broker/
    ├── Dockerfile
    ├── docker-compose.yml
    ├── .env.example
    ├── package.json
    └── src/
        ├── publisher.js
        └── consumer.js
```

---

## 3. Prerrequisitos

Para trabajar con Docker:

- Docker Desktop / Docker Engine con Docker Compose.

Para ejecutar el Gateway y los ejemplos de RabbitMQ sin contenedores:

- Node.js 20 o superior.
- npm.
- RabbitMQ instalado localmente si se quiere ejecutar **RabbitMQ sin Docker**.

---

## 4. Red Docker compartida de TicketU

El front, el Gateway, RabbitMQ y los 9 microservicios viven en `docker-compose.yml` separados. Para que se vean entre sí deben conectarse a una red Docker externa común.

Créala **una sola vez por máquina**:

```bash
docker network create plataforma-eventos-net
```

Puedes verificarla con:

```bash
docker network inspect plataforma-eventos-net
```

Todos los `docker-compose.yml` de este repo ya declaran:

```yaml
networks:
  plataforma-eventos-net:
    external: true
```

Cada grupo debe hacer lo mismo en su microservicio.

---

# 5. API Gateway

## 5.1 Rutas oficiales

El Gateway usa exactamente los prefijos que ya espera el front:

| Grupo | Path público | Variable del Gateway |
|---|---|---|
| Auth | `/api/auth/*` | `AUTH_SERVICE_URL` |
| Catálogo | `/api/catalogo/*` | `CATALOGO_SERVICE_URL` |
| Entradas / Inventario | `/api/entradas/*` | `ENTRADAS_SERVICE_URL` |
| Pagos | `/api/pagos/*` | `PAGOS_SERVICE_URL` |
| Check-in | `/api/checkin/*` | `CHECKIN_SERVICE_URL` |
| Reseñas | `/api/resenas/*` | `RESENAS_SERVICE_URL` |
| Panel organizador | `/api/organizador/*` | `ORGANIZADOR_SERVICE_URL` |
| Notificaciones | `/api/notificaciones/*` | `NOTIFICACIONES_SERVICE_URL` |
| Promociones | `/api/promociones/*` | `PROMOCIONES_SERVICE_URL` |

El Gateway **preserva el path completo**. Por ejemplo:

```text
GET http://localhost:8080/api/catalogo/eventos/123
                              │
                              └── Gateway lo envía a CATALOGO_SERVICE_URL

El microservicio de Catálogo recibe:
GET /api/catalogo/eventos/123
```

Esto evita reglas ocultas de reescritura y hace que una ruta se pueda probar igual de forma directa o a través del Gateway.

## 5.2 Levantar el Gateway con Docker

Desde la raíz del repo:

```bash
cd api-gateway
cp .env.example .env
```

Revisa `.env`. Las URLs por defecto asumen que los servicios Docker se llaman:

```text
auth-service
catalogo-service
entradas-service
pagos-service
checkin-service
resenas-service
organizador-service
notificaciones-service
promociones-service
```

Luego:

```bash
docker compose up --build -d
```

Comprueba:

```bash
curl http://localhost:8080/health
```

Para ver logs:

```bash
docker compose logs -f gateway
```

Para detenerlo:

```bash
docker compose down
```

## 5.3 Levantar el Gateway sin Docker

```bash
cd api-gateway
npm install
cp .env.example .env
```

En `.env`, cambia cada URL Docker por la URL local real de cada microservicio. Ejemplo:

```env
AUTH_SERVICE_URL=http://localhost:3001
CATALOGO_SERVICE_URL=http://localhost:3002
ENTRADAS_SERVICE_URL=http://localhost:3003
PAGOS_SERVICE_URL=http://localhost:3004
CHECKIN_SERVICE_URL=http://localhost:3005
RESENAS_SERVICE_URL=http://localhost:3006
ORGANIZADOR_SERVICE_URL=http://localhost:3007
NOTIFICACIONES_SERVICE_URL=http://localhost:3008
PROMOCIONES_SERVICE_URL=http://localhost:3009
```

Luego:

```bash
npm start
```

El Gateway queda en:

```text
http://localhost:8080
```

## 5.4 Qué pasa si un microservicio está caído

El Gateway no se cae. Devuelve un error controlado:

```json
{
  "error": "BAD_GATEWAY",
  "message": "El microservicio de destino no está disponible o no respondió a tiempo.",
  "requestId": "..."
}
```

con estado HTTP `502`.

Si la variable del servicio ni siquiera está configurada, devuelve `503` con `SERVICE_NOT_CONFIGURED`.

## 5.5 CORS centralizado

El front llama al Gateway desde el navegador, así que CORS se configura **solo en el Gateway**.

Por defecto:

```env
CORS_ORIGINS=http://localhost:3000
```

Para más de un origen:

```env
CORS_ORIGINS=http://localhost:3000,https://ticketu.ejemplo.cl
```

Si los microservicios solo reciben tráfico del Gateway y de otros servicios internos, no necesitan habilitar CORS para el front.

---

# 6. Cómo registra su microservicio cada grupo en el Gateway

Hay dos acuerdos obligatorios: **nombre/URL del servicio** y **prefijo de ruta**.

## Paso 1 — usar el prefijo que corresponde al grupo

Ejemplo de Catálogo con Express:

```js
const express = require("express");
const app = express();

app.use(express.json());

app.get("/api/catalogo/eventos", async (req, res) => {
  // buscar/listar eventos
  res.json([]);
});

app.get("/api/catalogo/eventos/:eventoId", async (req, res) => {
  // consultar un evento
  res.json({ id: req.params.eventoId });
});

app.listen(3000, "0.0.0.0");
```

**No usar** `/eventos` solo, `/catalog`, `/api/events` ni otro prefijo si el contrato público acordado es `/api/catalogo/...`.

## Paso 2 — conectar el microservicio a la red externa

Ejemplo del `docker-compose.yml` del grupo Catálogo:

```yaml
services:
  catalogo-service:
    build: .
    environment:
      PORT: 3000
      # Si este servicio usa RabbitMQ desde Docker:
      BROKER_URL: amqp://ticketu:ticketu_dev@ticketu-rabbitmq:5672/ticketu
    networks:
      - plataforma-eventos-net

networks:
  plataforma-eventos-net:
    external: true
```

No es obligatorio publicar el puerto `3000` al host para que el Gateway lo vea: ambos se comunican por la red Docker. Durante desarrollo, el grupo puede publicarlo si quiere probarlo directamente con Postman.

## Paso 3 — registrar la URL interna en el Gateway

Para Catálogo:

```env
CATALOGO_SERVICE_URL=http://catalogo-service:3000
```

Para Pagos:

```env
PAGOS_SERVICE_URL=http://pagos-service:3000
```

Y así con la variable correspondiente de la tabla de la sección 5.1.

Después de cambiar el `.env` del Gateway:

```bash
docker compose up -d --build
```

## Paso 4 — probar primero el health del Gateway y luego una ruta del módulo

```bash
curl http://localhost:8080/health
curl http://localhost:8080/api/catalogo/eventos
```

---

# 7. Cómo se conecta esto con el front existente

El front de TicketU ya centraliza la URL en:

```ts
export const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8080";
```

Y cada módulo agrega su prefijo. En Catálogo, por ejemplo, el patrón es:

```ts
const BASE_PATH = "/api/catalogo";

fetch(`${GATEWAY_URL}${BASE_PATH}/eventos`);
```

Por lo tanto, con:

```env
NEXT_PUBLIC_GATEWAY_URL=http://localhost:8080
```

el flujo de una consulta queda:

```text
1. Front
   GET http://localhost:8080/api/catalogo/eventos/123

2. API Gateway
   ve /api/catalogo/*
   busca CATALOGO_SERVICE_URL

3. Microservicio Catálogo
   GET /api/catalogo/eventos/123
   responde JSON

4. API Gateway
   devuelve status, headers y body al front

5. Front
   recibe la respuesta de Catálogo sin conocer su URL interna
```

Lo mismo aplica para Auth, Entradas, Pagos, Check-in, Reseñas, Organizador, Notificaciones y Promociones.

---

# 8. RabbitMQ — broker de eventos compartido

Todos los grupos que necesiten eventos usan **el mismo RabbitMQ**. No se crea un RabbitMQ por microservicio.

Se usa un exchange compartido de tipo `topic`:

```text
ticketu.events
```

Los nombres de evento funcionan como routing keys, por ejemplo:

```text
pago.realizado
pago.rechazado
entrada.emitida
checkin.realizado
```

## 8.1 Levantar RabbitMQ con Docker

Primero asegúrate de que existe la red:

```bash
docker network create plataforma-eventos-net
```

Si Docker dice que ya existe, no hay problema.

Luego:

```bash
cd event-broker
cp .env.example .env
docker compose up --build -d
```

Puertos:

- `5672`: AMQP, usado por los microservicios.
- `15672`: panel web de administración de RabbitMQ.

Con los valores de ejemplo, abre en el navegador:

```text
http://localhost:15672
```

Usuario:

```text
ticketu
```

Contraseña de desarrollo:

```text
ticketu_dev
```

## 8.2 Ejecutar los scripts de ejemplo contra RabbitMQ en Docker

RabbitMQ puede estar en Docker y los scripts Node en tu computador:

```bash
cd event-broker
npm install
cp .env.example .env
```

Terminal 1 — consumidor:

```bash
npm run consumer -- pago.realizado
```

Terminal 2 — publicador:

```bash
npm run publisher -- pago.realizado '{"pagoId":"p-123","eventoId":"e-9","usuarioId":"u-42"}'
```

El consumidor debería imprimir el evento y luego enviar `ACK` a RabbitMQ.

## 8.3 Usar RabbitMQ sin Docker

1. Instala RabbitMQ localmente y asegúrate de que el servicio esté iniciado. RabbitMQ necesita Erlang; en Windows normalmente ambos se instalan antes de usar `rabbitmq-server`.
2. Habilita el panel de administración y crea el usuario/vhost de TicketU:

```bash
rabbitmq-plugins enable rabbitmq_management
rabbitmqctl add_user ticketu ticketu_dev
rabbitmqctl add_vhost ticketu
rabbitmqctl set_permissions -p ticketu ticketu ".*" ".*" ".*"
```

En Windows, según cómo se haya instalado RabbitMQ, los comandos pueden aparecer como `rabbitmq-plugins.bat` y `rabbitmqctl.bat`.

3. Copia la configuración de los ejemplos:

```bash
cd event-broker
npm install
cp .env.example .env
```

4. Inicia un consumidor:

```bash
npm run consumer -- 'pago.*'
```

5. En otra terminal publica un evento:

```bash
npm run publisher -- pago.realizado '{"pagoId":"p-123"}'
```

El panel local queda normalmente en `http://localhost:15672` y AMQP en `localhost:5672`.

## 8.4 Conexión desde un microservicio que también corre en Docker

Dentro de la red Docker **no se usa `localhost` para RabbitMQ**. Se usa el nombre del contenedor/servicio:

```env
BROKER_URL=amqp://ticketu:ticketu_dev@ticketu-rabbitmq:5672/ticketu
EVENT_EXCHANGE=ticketu.events
```

`localhost` dentro de un contenedor significa "este mismo contenedor", no RabbitMQ.

---

# 9. Propuesta inicial de eventos

Esta tabla es **una propuesta del Platform Team para iniciar la conversación y debe validarse con los 9 grupos y el equipo docente**. No es un contrato cerrado. Los eventos finales deben salir del mapa de dependencias y de los contratos acordados entre grupos.

| Evento propuesto | Publica | Posibles consumidores | Para qué serviría |
|---|---|---|---|
| `usuario.registrado` | Auth | Notificaciones | Enviar bienvenida o confirmación |
| `evento.creado` | Organizador | Catálogo, Entradas, Notificaciones | Hacer visible el evento e inicializar dependencias necesarias |
| `evento.actualizado` | Organizador | Catálogo, Entradas, Promociones | Sincronizar cambios relevantes |
| `evento.cancelado` | Organizador | Catálogo, Entradas, Pagos, Notificaciones, Promociones | Reaccionar a una cancelación sin llamadas punto a punto |
| `entrada.reservada` | Entradas | Pagos | Iniciar/relacionar el flujo de cobro si el diseño acordado lo necesita |
| `entrada.emitida` | Entradas | Check-in, Notificaciones | Habilitar validación y avisar al usuario |
| `pago.realizado` | Pagos | Entradas, Notificaciones, Organizador | Confirmar compra, emitir/confirmar entrada y reflejar venta |
| `pago.rechazado` | Pagos | Entradas, Notificaciones | Liberar reserva si corresponde y avisar al usuario |
| `checkin.realizado` | Check-in | Organizador | Actualizar métricas/estado de asistencia |
| `resena.creada` | Reseñas | Organizador | Informar nueva actividad del evento si se requiere moderación |
| `promocion.activada` | Promociones | Catálogo, Notificaciones | Reflejar o difundir una promoción si el contrato lo requiere |

### Convención propuesta para el nombre

```text
<recurso>.<hecho-en-pasado>
```

Ejemplos:

```text
pago.realizado
entrada.emitida
checkin.realizado
```

Un evento describe **algo que ya ocurrió**, no una orden. Por eso se prefiere `pago.realizado` sobre `realizar.pago`.

### Sobre las colas

El exchange puede ser compartido, pero cada consumidor debe tener su **propia cola durable**. Ejemplo:

```text
notificaciones.pagos  --bind--> pago.*
entradas.pagos        --bind--> pago.realizado
organizador.checkins  --bind--> checkin.realizado
```

No conviene que Notificaciones y Entradas consuman de la **misma cola** si ambos deben recibir el mismo evento: en una cola compartida RabbitMQ repartiría mensajes entre consumidores en vez de entregar una copia a cada servicio.

---

# 10. Orden recomendado para levantar el ecosistema con Docker

```text
1. docker network create plataforma-eventos-net       (una sola vez)
2. event-broker/  -> docker compose up -d --build
3. api-gateway/   -> docker compose up -d --build
4. 9 microservicios -> cada grupo levanta el suyo
5. front -> docker compose up --build
```

RabbitMQ puede levantarse antes o después del Gateway porque cumplen funciones diferentes. Los microservicios que dependan del broker sí deberían iniciar/reintentar su conexión de forma controlada.

---

# 11. Checklist mínimo por grupo de backend

Antes de decir que un módulo está integrado, revisa:

- El contenedor está conectado a `plataforma-eventos-net`.
- Su nombre de servicio Docker coincide con la URL registrada en el `.env` del Gateway.
- Sus endpoints empiezan por `/api/<su-modulo>/...`.
- El Gateway tiene definida la variable `*_SERVICE_URL` correspondiente.
- La llamada funciona pasando por `http://localhost:8080`, no solo llamando directo al microservicio.
- Si publica/consume eventos, usa `ticketu.events` y una cola propia para el consumidor.
- No se hardcodean URLs de otros microservicios en el front.

---

# 12. Inconsistencias detectadas con el repo actual del front

Al revisar el README y los archivos actuales de `FWizav/FrontendTitec`, la propuesta de este repo **sí coincide** con los 9 prefijos que usa el front (`/api/auth`, `/api/catalogo`, `/api/entradas`, `/api/pagos`, `/api/checkin`, `/api/resenas`, `/api/organizador`, `/api/notificaciones`, `/api/promociones`) y mantiene la red externa `plataforma-eventos-net`.

Sin embargo, hay dos detalles del front que conviene corregir/definir explícitamente:

### 12.1 El README del front menciona `.env.example`, pero actualmente no está en la raíz

El README indica:

```bash
cp .env.example .env.local
```

pero el archivo `.env.example` no aparece actualmente en el repositorio. Conviene agregarlo, por ejemplo:

```env
NEXT_PUBLIC_GATEWAY_URL=http://localhost:8080
```

### 12.2 `NEXT_PUBLIC_GATEWAY_URL=http://gateway:8080` no sirve para fetch ejecutado en el navegador

El README del front sugiere usar el nombre Docker del Gateway (`http://gateway:8080`) cuando el front también corre en Docker. Eso solo es resoluble **desde otros contenedores**. Una llamada `fetch` de un componente cliente se ejecuta en el navegador del usuario, y el navegador normalmente no conoce el DNS interno de Docker `gateway`.

Con el patrón actual `NEXT_PUBLIC_*`, la opción simple para desarrollo en una sola máquina es mantener:

```env
NEXT_PUBLIC_GATEWAY_URL=http://localhost:8080
```

porque el puerto `8080` del Gateway se publica al host. Para un despliegue real, debería usarse una URL pública/reachable del Gateway, por ejemplo `https://api.ticketu...`, o agregarse un proxy server-side en Next.js. No conviene depender del nombre interno `gateway` para código que puede ejecutarse en el navegador.

### 12.3 El `docker-compose.yml` del front define `NEXT_PUBLIC_GATEWAY_URL` en runtime, pero el Dockerfile hace `next build` antes

El Dockerfile actual del front ejecuta `npm run build` durante la construcción de la imagen, mientras que el `docker-compose.yml` entrega `NEXT_PUBLIC_GATEWAY_URL` recién al arrancar el contenedor. En Next.js, las variables `NEXT_PUBLIC_*` usadas por el navegador se incorporan al bundle durante `next build`, por lo que cambiar solo el `environment:` de runtime no cambia el valor ya compilado.

Para el esquema actual, el front debería recibir la URL **durante el build**. Un ajuste simple sería:

```dockerfile
# Dockerfile del front, etapa builder
ARG NEXT_PUBLIC_GATEWAY_URL=http://localhost:8080
ENV NEXT_PUBLIC_GATEWAY_URL=$NEXT_PUBLIC_GATEWAY_URL
RUN npm run build
```

Y en el `docker-compose.yml` del front:

```yaml
services:
  front:
    build:
      context: .
      args:
        NEXT_PUBLIC_GATEWAY_URL: ${NEXT_PUBLIC_GATEWAY_URL:-http://localhost:8080}
```

El valor pasado al build debe seguir siendo una URL que el **navegador** pueda alcanzar; para desarrollo local, `http://localhost:8080` es coherente con el Gateway de este repo.

### 12.4 Una línea del README del front todavía habla de “URLs de los 9 microservicios”

En la descripción corta de `src/lib/env.ts`, el README dice que ahí están las “URLs de los 9 microservicios, centralizadas”. Eso contradice la sección 7 y el archivo real `src/lib/env.ts`, que correctamente contienen **una sola** `GATEWAY_URL`. Conviene cambiar esa línea para evitar que un grupo vuelva a introducir URLs directas a microservicios en el front.

---

## 13. Resumen de contratos de infraestructura

```text
Front:
  NEXT_PUBLIC_GATEWAY_URL=<URL alcanzable por el navegador>

Gateway:
  /api/auth/*            -> AUTH_SERVICE_URL
  /api/catalogo/*        -> CATALOGO_SERVICE_URL
  /api/entradas/*        -> ENTRADAS_SERVICE_URL
  /api/pagos/*           -> PAGOS_SERVICE_URL
  /api/checkin/*         -> CHECKIN_SERVICE_URL
  /api/resenas/*         -> RESENAS_SERVICE_URL
  /api/organizador/*     -> ORGANIZADOR_SERVICE_URL
  /api/notificaciones/*  -> NOTIFICACIONES_SERVICE_URL
  /api/promociones/*     -> PROMOCIONES_SERVICE_URL

Broker:
  host Docker: ticketu-rabbitmq:5672
  exchange: ticketu.events

Red común:
  plataforma-eventos-net
```
