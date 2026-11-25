# Plan: tus equipos solos en la lista, y órdenes de un equipo a otro

Estado: **plan, en cola**. Empieza cuando se fusione el pulido (`polish/connectors-remote`). No se mezcla con él.
Pedido por Eduardo el 24-11 (vía Edu Git).

## En simple

1. **Tus equipos aparecen solos.** Si un equipo de tu Tailscale tiene Edu Bot abierto, sale en una lista
   **Mis equipos**. No hay que copiar enlaces ni códigos.
2. **Mandas trabajo a otro equipo.** Desde un equipo eliges otro y le das una orden ("revisa este repo",
   "corre los tests"). Ese equipo la hace con sus propios bots y te muestra el avance.
3. **Seguridad:** solo cuentan equipos de **tu** cuenta de Tailscale. La primera vez que un equipo quiere mandar
   en otro, ese otro te pregunta una vez, en su pantalla. Cada orden queda registrada y se puede parar.

Estimación: **4 PRs, unas 2 semanas** de trabajo de agentes con auditorías, más una prueba real en el Mac mini,
FFM y el MacBook. Detalle al final.

## Lo que ya existe (y se reutiliza)

| Pieza | Dónde | Sirve para |
| --- | --- | --- |
| Leer `tailscale status --json` | `electron/tailnet.mjs` (`readTailscaleStatusJson`) | Saber si Tailscale está listo y el nombre de este equipo. Hoy lee solo `Self`, no los `Peer`. |
| Compartir por Tailscale | `electron/tailnet-share.mjs` | Escuchar en la dirección de Tailscale (`:8799`) o detrás de `tailscale serve` (`:443`). Probado en FFM el 25-11: pasa el firewall de Windows sin admin. |
| Identidad pública | `GET /.well-known/openmausbot/environment` | Dice `environmentId`, nombre, sistema y versión sin sesión. Sirve para descubrir. |
| Sesiones vinculadas | `POST /api/auth/pairing`, `/api/auth/pair`, `/api/auth/sessions` | Hoy se entra con un código de 12 caracteres. Cada sesión tiene alcance (`admin`, `client`, `phone`) y se puede revocar. |
| Equipos prestados | `server/shared-computers.ts`, `electron/computer-sharing.mjs` | Prestar carpetas, pantalla y terminal a un home, con registro de cada uso (**Acceso al equipo**). |
| Riel de servidores | **＋ → Conectar a un servidor** | Abrir los bots de otro equipo en esta ventana. |

Lo que falta: leer los `Peer` de Tailscale, comprobar quién es cada uno con Tailscale, y una orden remota con
aprobación.

## 1. Descubrimiento

- Cada Edu Bot con **Tus otros equipos** encendido ya escucha en su dirección de Tailscale. Ese switch sigue siendo
  la puerta: un equipo con el switch apagado no aparece ni recibe nada. Así nada se abre solo.
- El equipo lee `tailscale status --json` cada 60 s y cuando se abre **Mis equipos**. De cada `Peer` toma
  `HostName`, `DNSName`, `TailscaleIPs`, `Online`, `OS`, `UserID`, `Tags` y si es compartido.
- **Filtro de dueño:** solo quedan los `Peer` con el mismo `UserID` que `Self`, sin `Tags`, en el mismo tailnet
  (mismo sufijo `.ts.net`) y que no sean nodos compartidos de otra cuenta. Ejemplo real: `cheil-sofland` es de otra
  persona (`rocabaar@`, otro tailnet) y **no debe aparecer nunca**.
- A cada uno que queda y está en línea le pide `/.well-known/openmausbot/environment` en `https://<nombre>` y
  `http://<nombre>:8799`, con 3 s de espera. Si contesta un Edu Bot, entra a la lista con su nombre, sistema,
  versión y "en línea / apagado / sin Edu Bot".
- Sin servidor central ni nube: todo pasa dentro de Tailscale.

## 2. Identidad y confianza (sin enlace ni código)

El código de 12 caracteres hoy prueba "esta persona tiene acceso a los dos equipos". Se reemplaza por Tailscale:

- Cuando el equipo B recibe una petición por su dirección de Tailscale, le pregunta a su propio Tailscale quién es
  esa dirección: `tailscale whois --json <ip>` (API local, sin admin). Obtiene el `LoginName` del dueño y el nodo.
- Detrás de `tailscale serve`, Tailscale ya agrega `Tailscale-User-Login` y `Tailscale-User-Name`. Se usan solo si
  la conexión viene de `tailscaled` en loopback, nunca si las manda un cliente.
- **Regla de confianza:** el `LoginName` del que llega es igual al del propio B, el nodo no tiene `Tags` y no es
  compartido. Si no, 403 como hoy.
- **Ver** la lista y el estado de otro equipo: basta con esa regla.
- **Mandar** (abrir sus bots, dar órdenes, usar carpetas o pantalla): **la primera vez, B pregunta en su
  pantalla**: "¿Dejar que MacBook Pro de Eduardo trabaje en este equipo?" (**Permitir** / **Ahora no**). Es un
  clic, no un código, y cumple la regla del proyecto: dar más acceso siempre lo confirma una persona en la app.
  Con **Permitir**, B crea una sesión `admin` para ese nodo, atada a su `NodeKey`, y la lista en **Vinculados** con
  el nombre real del equipo.
- Se revoca igual que hoy (**Vinculados → quitar**). Si el nodo sale del tailnet o cambia de dueño, la sesión deja
  de valer sola (se vuelve a comprobar `whois` en cada conexión).
- Opción para después, apagada por defecto: "Confiar en todos mis equipos de Tailscale sin preguntar". No va en la
  primera versión.

## 3. Órdenes remotas agénticas

**Qué es una orden:** `{ equipo destino, bot o motor, carpeta, texto de la orden, límite de tiempo }`.

- **Camino principal: los bots del equipo destino.** La orden llega como una tarea nueva para un bot de B, que
  usa sus propios motores (Claude, Codex, Antigravity…) y sus aprobaciones de siempre. El equipo A ve el avance en
  vivo en el riel, como hoy con un servidor conectado. Funciona en Mac, Linux y Windows, también en FFM.
- **herdr (opcional, Mac y Linux):** si B tiene herdr, el bot puede abrir un panel y lanzar ahí el agente, igual
  que Edu Git maneja al lead en omarchy: `herdr workspace create`, `herdr agent start --kind claude`,
  `herdr agent prompt`, y leer con `herdr agent read`. Esto necesita que B haya prestado la **terminal**
  (ya existe en **Ajustes → Servidores → Elegir qué puede usar**). `herdr machine` (remoto por SSH) **no** se usa:
  FFM no tiene SSH y no se puede activar sin admin, y Tailscale SSH no corre como servidor en Windows.
- **Aprobaciones en B:**
  - Cada orden muestra una tarjeta en B la primera vez por equipo y por carpeta, con **Permitir siempre** o
    **Solo esta vez**.
  - Comandos, escritura de archivos y pantalla siguen las reglas de aprobación del bot de B.
  - Un botón **Parar todo** en B corta todas las órdenes remotas al tiempo.
- **Registro:** cada orden queda en **Acceso al equipo** de B (quién, cuándo, qué, resultado).

## 4. Equipos de trabajo como FFM (sin admin, firewall corporativo)

Medido en FFM el 24 y 25-11:

- Edu Bot se instala por usuario (`%LOCALAPPDATA%\Programs\edu-bot`), sin admin.
- La red Tailscale queda como **Private**. El Firewall de Windows dejó pasar `:8799` por Tailscale sin regla nueva.
- Tailscale va por relé (`DERP(sao)`) porque la red de la oficina bloquea la conexión directa. Funciona; solo
  agrega unos 120 ms.
- El 443 lo tiene un `tailscale serve` viejo. La app usa `:8799` y lo dice (arreglo del pulido).

Reglas para un equipo de trabajo:

- Un switch **Equipo de trabajo** (lo marca la persona): las órdenes remotas quedan **apagadas** hasta
  encenderlas, la pantalla no se presta por defecto, y solo se aceptan carpetas que la persona elige.
- La lista de carpetas nunca incluye rutas que la persona marque como prohibidas. En FFM: `C:\Cheil`.
- Si la empresa tiene política de acceso remoto apagado, ya se respeta: `remotePolicyAllows` en
  `electron/tailnet-share.mjs` apaga todo.
- Si el firewall de otra empresa bloquea `:8799`, el equipo sale en la lista como "no contesta", con el texto
  "la red de este equipo bloquea la entrada; puedes usarlo como cliente". Sigue pudiendo **mandar** órdenes a otros.

## 5. Riesgos y cómo se cubren

| Riesgo | Cubierto por |
| --- | --- |
| Alguien en tu tailnet que no eres tú (nodos compartidos, `tags`) | Filtro por `UserID` y `whois` en cada conexión |
| Un equipo tuyo robado o con malware manda órdenes | La primera vez se confirma en el equipo destino; **Vinculados → quitar**; **Parar todo**; registro de cada orden |
| Una cabecera `Tailscale-User-Login` falsa | Solo vale si viene de `tailscaled` en loopback; si no, se usa `whois` |
| Datos de la empresa en FFM | **Equipo de trabajo**: órdenes apagadas, solo carpetas elegidas, carpetas prohibidas |
| Un bot borra o envía algo grave | Las aprobaciones del bot destino no cambian |

## 6. Plan de PRs y estimación

| PR | Qué | Agente | Estimación |
| --- | --- | --- | --- |
| 1 | **Mis equipos**: leer los `Peer` de Tailscale, filtro de dueño, sondeo de identidad, lista con estado. Solo ver. | Claude (Opus/Fable) + auditoría Grok | 2 a 3 días |
| 2 | Confianza por Tailscale: `whois`, "¿Dejar que … trabaje en este equipo?", sesión atada al nodo, revocar. Reemplaza el código para tus propios equipos (el código sigue para el teléfono y para otras personas). | Claude + auditoría Grok y Agy (seguridad) | 3 a 4 días |
| 3 | Órdenes remotas con los bots del destino: enviar, aprobar en destino, avance en vivo, **Parar todo**, registro, switch **Equipo de trabajo**. | Claude + auditoría Grok | 3 a 4 días |
| 4 | Correr una orden en herdr (Mac y Linux) usando la terminal prestada. | Claude + auditoría Agy | 2 días |
| — | Prueba real: Mac mini (home), FFM (trabajo), MacBook Pro, omarchy, S24. Textos en inglés y español. | Lead + Edu Git + Eduardo | 1 día |

Total: unas **2 semanas**, con las auditorías en serie (regla de 2 agentes en omarchy). Los PR 1 y 2 sirven solos:
después del 2 ya no hay enlace ni código entre tus equipos.

## Preguntas abiertas para Eduardo

1. La primera vez que un equipo tuyo quiere mandar en otro, ¿basta un clic en el equipo destino? (Es lo
   recomendado. Sin ese clic, un equipo robado podría mandar en todos.)
2. ¿FFM debe poder **recibir** órdenes, o solo **mandarlas**? Recomendado: solo mandarlas, por ser el PC de
   trabajo.
