# Edu Bot: avance

Hecho = verificado. Cada línea dice cómo se probó.

## Estado de los hitos

| Hito | Qué es | Estado |
| --- | --- | --- |
| M0 | El repo instala, compila y pasa tests en Linux | Hecho (PR #1, 21-11) |
| M1 | Nombre Edu Bot, licencias, sin telemetría, sin `enterprise/` | Hecho (PR #3, #4, #5, 21-11) |
| M2 | Memoria Edu en cada bot, con aprobaciones | Hecho (PR #7, #8, #9, #10, 22-11) |
| M3 | Organización, áreas y bots en archivos | Hecho (PR #13 a #17, 22-11) |
| M4 | Conector SQL, permisos por bot, registro de auditoría, conectores, Antigravity | Hecho (PR #19 a #26, 22-11) |
| M5 | CI en 3 sistemas, instaladores, README, versión 0.1.0 | Hecho (PR #28 a #31 y #34; v0.1.0 publicada 24-11) |
| M6 | Auditoría final con dos proveedores, inglés y español completos | Hecho (PR #32, #33, #35 a #43, 24-11); falta tu prueba en el Mac |

## M0: salud del repo

- [x] Push a `upstream` bloqueado en este equipo.
- [x] Dependencias instaladas con pnpm 10.33.0 y Node 26.
- [x] Typecheck sin errores (`pnpm typecheck`).
- [x] Lint sin errores (`pnpm lint`).
- [x] Build (`pnpm build`): pasa en 47 s. Antes fallaba por falta de memoria de Node
  (límite 2 GB en este equipo). Arreglo: el build usa 4 GB, igual que el release. PR #1.
- [x] Electron no se había descargado al instalar. Se bajó con `node install.js` del paquete electron.
- [x] Tests (`vitest`). En CI todo verde: Ubuntu y Windows (16 partes), smokes de macOS, paquete Ubuntu.
  2 partes fallaron 1 test cada una por carrera de tiempos (no por nuestro cambio). Al re-correr, pasaron.
  CI es la referencia del suite completo.
- Hallazgo: `/tmp` vive en la RAM. Los tests dejaron 4,7 GB ahí. Eso causó gran parte del corte.
  Para correr tests aquí usar `TMPDIR=/var/tmp/edubot-tests` (en disco, sin punto, fuera de HOME).
- Fallos que solo pasan en este PC (Arch), no en CI. Grok los revisó:
  - e2e de "cloud/team": aquí bubblewrap funciona; en Ubuntu 24.04 no. Upstream lo sabe (`ci.yml`).
  - `linux-after-install`: el script exige que la prueba viva en `/tmp`.
  - Con `TMPDIR` en carpeta oculta o dentro de HOME fallan 2 archivos más. Con `/var/tmp` pasan.
  - Un test de gráficos fallaba por el cambio de horario de Chile. Arreglo: los tests corren en UTC,
    igual que CI (`vite.config.ts`). Comprobado: sin UTC falla, con UTC pasa.
- [x] Con Node 26, 2 archivos de tests de interfaz fallaban: Node trae su propio `localStorage` vacío.
  Arreglo en `vite.config.ts` (`--no-experimental-webstorage`). Los 15 tests pasan.
- [x] La app abre en Linux (Omarchy, Wayland), con HOME y datos temporales, sin tocar datos reales.
  Ventana "MausBot". Se pasó la bienvenida con clic y cargó la pantalla principal.
  Cero errores en los logs. Capturas y logs en `~/Projects/edu-bot-wt/reports/m0-shots/`.
- [x] Auditoría de otro proveedor (Grok). Ronda 1: pidió 3 arreglos (estado de M1, explicación de fallos,
  prueba de apertura). Ronda 2: PASS. Reportes en `~/Projects/edu-bot-wt/reports/grok-m0-audit-v*.md`.
- [x] CI verde en el último commit (34 checks). PR #1 fusionado.

## M1: nombre Edu Bot, licencias, sin telemetría

- [x] PR #3 (fusionado): se borró `enterprise/` (código con licencia restrictiva).
  NOTICE y LICENSING.md dicen que Edu Bot es un fork de OpenMausBot (Apache 2.0).
- [x] PR #3: se quitó toda la analítica (PostHog). No queda código que mande datos de uso.
- [x] PR #3: la app ya no llama a servidores de upstream por defecto (anuncios, reportes de errores,
  Composio, cuenta Cloud, enlace del teléfono). La lista de conexiones está en `docs/edu-bot/network.md`.
- [x] PR #3: la interfaz ya no pide íconos a Google al abrir. Probado: 0 pedidos externos al cargar.
- [x] PR #3 auditado por Agy (Gemini): 3 rondas. Ronda 1 con 6 hallazgos, ronda 2 con 2 tests rotos,
  ronda 3 PASS. CI verde (34 checks) tras re-correr 2 tests inestables de Windows.
- [x] PR #4 (fusionado): nombre "Edu Bot" en toda la interfaz, menús y 16 idiomas. Ícono nuevo (una "E").
  Sin la mascota de upstream y sin promociones. El bot ayudante se llama "Edu"; los datos guardados se conservan.
  La app del teléfono se sigue llamando MausBot (es la app publicada en las tiendas).
  Lo hizo Codex; Claude arregló los tests que CI encontró. Grok auditó 3 rondas: 9 hallazgos, luego 3, luego PASS.
  CI verde (34 checks). Capturas en `~/Projects/edu-bot-wt/reports/m1-shots/`.
- [x] PR #5 (fusionado): identificadores propios. App id `io.github.eduardomoraga.edubot`, carpeta de datos
  `~/.edubot`, enlaces `edubot://`, comando `edubot`, instalación Linux en `/opt/edu-bot`.
  No toca ni mueve datos de OpenMausBot (`docs/edu-bot/data.md`). Ningún workflow puede escribir en repos de upstream.
  El emparejado del teléfono sigue usando `openmausbot://pair`, porque la app publicada del teléfono solo entiende eso.
  Agy auditó 2 rondas: 7 hallazgos, luego PASS. CI encontró un error real: la ruta "/opt/Edu Bot" con espacio
  hacía caer Electron en Linux. Arreglado. CI verde (34 checks).
- [x] Prueba final en main: la app abre aislada en Linux. Ventana "Edu Bot", datos en `~/.edubot` temporal,
  edición "oss", cero errores en logs. Captura: `~/Projects/edu-bot-wt/reports/m1-shots/m1-final-linux-main.png`.

## M2: memoria Edu en cada bot

Plan (exploración de Claude, `~/Projects/edu-bot-wt/reports/claude-m2-scout.md`):
- Cada bot recibe la memoria Edu como herramienta (MCP), con su propio cerebro o uno compartido por área.
- La memoria actual de Edu Bot sigue igual. Edu se suma para decisiones y lecciones de largo plazo.
- Los bots no pueden aprobar memoria canónica. Solo una persona aprueba, con una tarjeta en el chat.
- Si `edu` no está instalado, la app funciona igual, sin errores.

- [x] PR1 (#7, fusionado): cada bot recibe la memoria Edu (MCP) con su propio cerebro en `~/.edubot/brains/<bot>`,
  o una carpeta compartida. El bot puede recordar, guardar y proponer; no puede aprobar ni cambiar de cerebro.
  Tu `~/.edu` se lee pero no se ensucia: los cerebros de bots se registran aparte.
  Si `edu` no está, la app funciona igual. Se apaga con `"edu": {"enabled": false}` en `config.json`.
  Prueba real: un bot guardó y recuperó una nota en su cerebro temporal. Grok auditó 3 rondas (7 hallazgos,
  incluido un ataque con enlaces simbólicos; luego 1; luego PASS). CI verde (34).
- [x] PR2 (#8, fusionado): cuando un bot propone una regla o preferencia, aparece una tarjeta en el chat
  con palabras simples ("Regla", "Preferencia"). Se aprueba en la app de escritorio o desde un dispositivo emparejado.
  Un bot o un script solo puede rechazar. Nunca se aprueba por voz. La tarjeta no bloquea el chat.
  También aparece en Ajustes del bot -> Memoria y en "Necesita tu atención".
  Agy auditó 2 rondas: 6 hallazgos (el chat se bloqueaba, voto por voz, carreras), luego PASS. CI verde (34).
  Capturas: `~/Projects/edu-bot-wt/reports/m2-shots/round2-*.png`.
- [x] PR3 (#9, fusionado): el resumen de tu cerebro Edu entra al prompt de cada bot, como dato y no como orden.
  Grok encontró que una nota podía dar órdenes al bot (inyección de prompt); se arregló en 3 rondas, hasta PASS.
  Si Edu falla al conectar, sale una línea tranquila ("se reintenta en el próximo mensaje"), nunca un error.
  Se corrigió un error del PR1: con algunos motores, si Edu fallaba, fallaba toda la respuesta.
- [x] PR4 (#10, fusionado): Edu crew. Un bot puede pedir un plan (plan, construir, revisar) o una revisión de
  otro proveedor. Apagado por defecto. Cada paso del plan espera tu aprobación con una tarjeta.
  Las llaves se borran antes de enviar algo a otro proveedor. Al cerrar la app se detienen los trabajos.
  Agy auditó 3 rondas: 7 hallazgos (escape por enlaces, revisor del mismo proveedor, procesos vivos,
  secretos), luego 1, luego PASS. CI verde (34).
- [x] Prueba final en la app real, aislada: el bot "Edu" tiene su cerebro listo (Edu 6.0.0), lee el cerebro global
  temporal y no toca tu `~/.edu`. Cero errores en logs.

## M3: organización, áreas y bots en archivos

Plan (exploración de Claude, `~/Projects/edu-bot-wt/reports/claude-m3-scout.md`):
- Una carpeta de archivos (en un repo git) define la organización, las áreas (por ejemplo "BI") y sus bots.
  Cada bot es un archivo Markdown: arriba sus datos (modelo, herramientas, memoria), abajo sus instrucciones.
- Dos personas con la misma carpeta tienen los mismos bots. Las llaves y logins nunca van en los archivos:
  cada persona pone las suyas en su computador.
- La app lee la carpeta y muestra un plan ("agrega el área BI con 3 bots"). Nada cambia hasta que tú lo apruebas.
  Lo que da más acceso a un bot siempre pide tu confirmación en la app.
- Memoria compartida por área: un cerebro Edu por área en tu computador, o uno en edu-cloud para el equipo.

- [x] PR1 (#13, fusionado): formato de la carpeta de perfiles y `edubot profiles check` (revisa sin conectarse).
  Rechaza llaves escritas en los archivos, rutas de tu computador y caracteres invisibles, con una frase clara
  que dice archivo y línea. Grok auditó 5 rondas: buscó formas de esconder llaves y rutas. Al final las reglas
  se hicieron estructurales (sin listas de casos), y dio PASS. CI verde (34).
- [x] PR2 (#14, fusionado): la app lee la carpeta y arma un plan. Detecta cambios hechos aquí y conflictos,
  y nada que dé más acceso se aplica sin tu confirmación en la app. Dos personas con la misma carpeta
  obtienen los mismos bots (prueba real con dos instalaciones separadas).
  Agy auditó 2 rondas: 9 hallazgos (cambiar un archivo entre el plan y aplicar, rutas de red, un `.git` trampa,
  bots borrados por error), luego PASS. CI verde.
- [x] PR3 (#15, fusionado): pantalla Ajustes -> Perfiles. Eliges la carpeta, ves el plan en frases simples
  ("Agregará", "Cambiará", "Da más acceso"), y aplicas. Dar más acceso pide una segunda confirmación.
  En los ajustes de cada bot se ve "Viene del perfil bi/analista" y qué llaves faltan ("Falta tu llave").
  Grok auditó 2 rondas: 7 hallazgos de claridad (una frase decía "borra" cuando el bot se queda), luego PASS.
  Capturas: `~/Projects/edu-bot-wt/reports/m3-shots/`.
- [x] PR4 (#16, fusionado): cerebro compartido por área en tu computador, o en edu-cloud para el equipo.
  Opción `personalBrain: false` para que los bots del área no lean tu `~/.edu`.
  La llave de edu-cloud nunca llega al motor del bot: Edu Bot hace de intermediario y la agrega él mismo.
  Agy auditó 3 rondas (fuga de tu `~/.edu`, llave visible para el bot, redirecciones), luego PASS.
  PR del repo edu-cloud (llave por persona): auditado PASS, abierto para que tú lo fusiones.
- [x] PR #17 (fusionado): arreglo de seguridad encontrado en la prueba final. Si el motor de un bot no admite
  el nivel de aprobación del archivo, el bot baja al más restrictivo que sí admite ("Pedir aprobación").
  Nunca queda con más acceso que su archivo. Grok auditó: PASS.
- [x] Prueba final en la app real, aislada: aplicó la carpeta de ejemplo (2 áreas, 3 bots). Closer quedó en
  "Pedir aprobación" y explica por qué. Dar más acceso sin la app de escritorio fue rechazado. Sin errores en logs.

## M4: SQL, permisos, auditoría y conectores

Pedido de Eduardo (22-11): en su Mac los conectores no funcionan, porque dependían del servicio de MausBot.
Plan (exploración de Claude, `~/Projects/edu-bot-wt/reports/claude-m4-scout.md`), 5 PRs:
- [x] M4-1 (#19, fusionado): "Apps" sin servicio de MausBot. Sin llave explica en 3 pasos qué hacer, con botón
  "Pegar llave" que abre el campo correcto. Tus servidores MCP aparecen primero. Los bots ya no dicen "reinicia".
  Agy auditó 2 rondas: 7 hallazgos (ruta de menú inexacta, la llave de prueba podía ir a Composio real), luego PASS.
- [x] M4-2 (#20, fusionado): servidores MCP propios desde los archivos de perfiles y por área.
  Un servidor que necesita una llave que no guardaste queda apagado ("Falta tu llave"). Un comando que corre en tu
  computador siempre pide tu confirmación. Menú del área: "Servidores MCP de esta área".
  Grok auditó (2 hallazgos) y los arregló; Agy verificó: PASS. CI verde.
- [x] M4-3 (#22, fusionado; lo hizo Grok, Agy auditó 2 rondas y dio PASS): pruebas reales de punta a punta: un conector MCP y uno por Composio (con un Composio de prueba local;
  la prueba con Composio real solo corre si das una llave de prueba).
- [x] M4-4 (#23, fusionado; lo hizo Grok, Agy auditó 5 rondas hasta PASS): conector SQL (SQLite, DuckDB, Postgres), solo lectura por defecto, con conexiones guardadas en el Vault
  y una lista de tablas por bot. Los números salen de las consultas, nunca del modelo.
  Decisión (22-11): tras 2 auditorías de Agy con fallas graves (saltar la lista de tablas, leer archivos del computador),
  el conector sale SOLO DE LECTURA. Escribir en la base queda para después. La clave de la base nunca llega a un bot.
- [x] M4-5 (#26, fusionado; lo hizo Codex, Agy auditó 3 rondas hasta PASS): el tope de aprobación de un área se
  cumple siempre: al crear, editar, duplicar, importar o mover un bot, y al correr cada turno. Sacar un bot del área o
  borrar el área no sube su permiso sin una persona en la app. Nuevo visor de actividad, filtrado por bot y por área.
- Prueba final de M4 (22-11, app aislada en Linux): la app abre, Edu respondió con Gemini por Antigravity, la
  pantalla de conectores sin llave explica qué hacer, y no se tocaron tus datos reales.
- [x] M4-6 (#25, fusionado; lo hizo Agy, Grok auditó 5 rondas hasta PASS): Antigravity como proveedor, para usar
  Gemini desde la app. La app rechazaba tu `agy` 1.5 instalado; ahora lo usa. Prueba real con tu `agy`: respondió,
  usó una herramienta de Edu Bot y se canceló bien (3 turnos cortos). El permiso "acceso total" solo se da a un
  `agy` verificado justo antes de arrancar.

## M5: instaladores, README y versión 0.1.0

- [x] M5-1 (#28, fusionado; lo hizo Grok, Agy auditó 3 rondas hasta PASS): lanzamiento desde una etiqueta `v*`.
  Arma instaladores para Mac (dmg y zip, Apple y chip Intel), Windows (setup.exe) y Linux (AppImage y deb),
  los prueba en cada sistema y los deja en un borrador de release en GitHub, con sus sumas SHA256.
  Prueba en seco verde en los 3 sistemas, sin publicar nada. Versión 0.1.0.
  - Sin firma por ahora (no hay certificados de Apple ni de Windows). Se firma solo si agregas los secretos.
  - Se borraron 14 flujos de upstream que no aplican (Docker, npm, promote-stable, etc.).
  - Los instaladores no traen Chrome for Testing ni herramientas Android de Google (su licencia no lo permite).
  - Las pruebas en Mac encontraron 3 errores reales de rutas (`/private/var`) en código nuestro de M2 y M4.
    Arreglados. Mac corre sus pruebas al fusionar en main y antes de cada lanzamiento (no en cada PR:
    GitHub da pocas máquinas Mac gratis y los PR esperaban casi una hora).
  - Pendiente: una pieza de Windows (`agent-browser`) se baja al usarla desde un release de upstream.
    Está fijada por tamaño y SHA256, así que no se puede cambiar; conviene copiarla a nuestro repo.
- [x] M5-2 (#29, fusionado; lo hizo Grok porque Codex no tenía cupo, Agy auditó 2 rondas hasta PASS): README en
  inglés y español, escritos desde el código. Se sacó todo lo de upstream que no es cierto en Edu Bot (MausBot
  Cloud, el servicio de Composio de MausBot, links de descarga de upstream). Explica cómo abrir la app sin firma.
- [x] M5-3: versión v0.1.0 publicada el 24-11: https://github.com/EduardoMoraga/edu-bot/releases/tag/v0.1.0

## M6: revisión final, inglés y español, prueba en la app real

- [x] Español completo (#32, Agy; Grok auditó 2 rondas): 11.543 de 11.543 textos. Los textos que la persona ve
  dicen Edu Bot (se mantienen el crédito a OpenMausBot y la app del teléfono MausBot).
- [x] Prueba en la app real en inglés y español (#33, Claude; Grok auditó 3 rondas): 57 pantallas, arreglos de
  textos en inglés que quedaban, capturas nuevas del README. El plan de perfiles ahora vale en cualquier idioma.
- [x] Auditoría final (Fable 5.2, revisión de Grok en 3 rondas): 4 graves y 4 importantes, todos arreglados.
  - Seguridad (#35): un bot ya no puede aprobar su propia nota de Edu en ningún motor. Las herramientas de datos no
    leen las bases guardadas ni la carpeta de datos de la app (tampoco con `file://`, enlaces o carpetas). El token
    de edu-cloud no llega al bot. Dar acceso exige la huella del plan.
  - Textos (#37): el comando para instalar Edu funciona. Los errores del servidor salen en tu idioma. Lo que leen
    los bots y tú dice Edu Bot. El servidor dice "Edu Bot server on…" (#40); `/api/health` suma `product`.
- [x] Urgentes de Eduardo (23-11), probados en la app aislada:
  1. Conectar herramientas (#38): "Empieza aquí" con Notion, Linear y Atlassian en un clic (inicias sesión en el
     navegador), GitHub con una llave, tu servidor MCP pegando el enlace, Gmail/Calendar/Slack con Composio.
     Composio quedó en "Más apps (avanzado)". Los tokens de estos servidores no llegan al bot.
  2. "Grok Bot" ya no aparece en la app (#38). El proveedor Grok sigue.
  3. "Usar este computador" (#39): en desarrollo la app no traía el controlador, por eso no había nada a qué dar
     permiso. Ahora `pnpm dev:desktop` lo prepara (Mac y Windows) y baja Electron si falta. Probado en máquinas Mac
     Intel y Windows de GitHub. **Falta tu prueba en tu Mac** (paso 7 de "Necesito de Eduardo").
  4. Bienvenida (#38): "Te damos la bienvenida a Edu Bot", tres líneas y un botón.
- [x] v0.1.0 armada con todo lo anterior: borrador privado listo, con 7 instaladores (Mac Apple e Intel, Windows,
  Linux), SHA256SUMS y notas en inglés y español. Pasó CI completo, también Mac. (Un test de Mac solo fallaba en la
  línea de lanzamiento por un simulador incompleto; arreglado en #42.)
- [x] **v0.1.0 publicada** (24-11, a pedido de Eduardo): https://github.com/EduardoMoraga/edu-bot/releases/tag/v0.1.0
  Tiene 16 archivos. La descarga pública funciona (probado con `SHA256SUMS`).
- [ ] **Pendiente: tu prueba de "Usar este computador" en el Mac** (paso 7 de "Necesito de Eduardo"). Se publicó
  antes, como pediste. Si falla, lo arreglo y saco una v0.1.1.
- Quedan como están (decidido): la pieza de Windows `agent-browser` se baja de upstream (fijada por SHA256); el
  test "browser driver S4" de Windows se reintenta; los nombres internos `openmausbot` del archivo de bloqueo y la
  caché no se cambian (cambiarlos necesita migración).

## En curso y en cola (después de v0.1.0)

- [x] **Pulido de conectores y conexiones remotas** (#55, 25-11; Claude Fable, Grok auditó 3 rondas hasta PASS).
  Probado en la app aislada en inglés y español. Las ventanas de permiso que no logran abrirse ya no cuentan como
  "Permitir". En la lista de vinculados sale el nombre del equipo. En español se usan "equipo" y "vincular". El aviso
  del 443 ocupado dice la causa real. Las llaves equivocadas de Composio y GitHub dan una frase simple. La
  documentación de conexiones dice Edu Bot y los menús reales. Quedan sin hacer (necesitan alcance): el switch
  "En cualquier lugar, a través de Edu Bot" (no hay ese servicio), sinónimos de búsqueda en español, textos en
  otros idiomas y ejemplos `maus.example.com` de la línea de comandos.
- [ ] **Claude como en T3 Code**: en curso (rama `claude/own-cli`, Claude Opus).
- Detalle de Claude como en T3 Code (decisión de Eduardo, 25-11). Cada persona
  instala Claude Code y hace `claude auth login`. Edu Bot solo lanza el `claude` oficial y **nunca lee ni guarda
  tokens**: se quita de `server/plan-usage.ts` la lectura del token (archivo `.credentials.json` y llavero de macOS)
  y la consulta a `api.anthropic.com/api/oauth/usage`. Los límites salen solo de lo que imprime el CLI, o no se
  muestran. PR chico, aparte del plan de equipos.
- [ ] **En cola, después del pulido:** tus equipos aparecen solos por Tailscale y puedes mandar órdenes de un
  equipo a otro. Plan y estimación (unas 2 semanas, 4 PRs): [plan-tailnet-devices.md](plan-tailnet-devices.md).
  Ya decidiste las 2 preguntas (25-11): sin clic de confirmación, y FFM también recibe órdenes.
- [ ] Prueba con varios equipos: [multi-device-test.md](multi-device-test.md).

## Cómo trabajamos

- Límites de uso (pedido 22-11): si se acaba el límite semanal de Claude, no me detengo en silencio:
  lo anoto abajo en "Necesito de Eduardo" y sigo con Codex, Grok y Agy.
- Idiomas (pedido 22-11): inglés y español deben quedar completos y revisados en M6. Los demás pueden quedar como están.

- Regla de memoria (12 GB): máximo 2 agentes a la vez, el líder y 1 trabajador.
  Auditorías de Grok y Agy, una después de la otra. Build y tests en primer plano con 4 GB.
- El 21-11 a las 00:39 el sistema cortó todo por memoria. Se perdió el avance de Codex, Grok y Agy.
  Su trabajo quedó guardado en sus carpetas. M1 sigue ahora, un agente a la vez.
- Cerré 7 agentes inactivos de otros proyectos para liberar memoria. Sus sesiones se pueden reabrir:
  la lista está en `~/Projects/edu-bot-wt/reports/closed-idle-agents.txt`.

- Líder: Claude (este agente). Backend: Claude. Interfaz: Codex. Auditores: Grok y Antigravity.
- Cada agente tiene su copia del repo en `~/Projects/edu-bot-wt/<rol>`.
- Encargos en `~/Projects/edu-bot-wt/briefs/`. Reportes en `~/Projects/edu-bot-wt/reports/`.

## Decisiones

- Se quita PostHog completo. No queda ninguna analítica.
- `server/enterprise.ts` queda como pieza vacía (edición "oss"). Se borra la carpeta `enterprise/`.
- Puerto 8799 y variables `OMB_*` se mantienen por ahora.
- Carpeta de datos nueva: `~/.edubot`. Esquema de enlaces: `edubot://`.
- El bot ayudante se llama "Edu".

## GitHub Actions

- Eduardo activó Actions en el fork (21-11).
- Solo quedan activos 2 workflows: "CI" y "Stop CI for closed PRs".
- La rama `m5/release` borra los workflows de upstream (Docker, npm, promote-stable, Defender, etc.).
  Queda un solo Release: tag `v*`, borrador en este repo, sin firmar si no hay secretos.
  M5 sigue pendiente: el README en inglés y español es otra parte.

## Tests inestables vistos en CI (upstream)

Fallan a veces y pasan al re-correr. No vienen de nuestros cambios.
- `server/env-path.test.ts` (Linux): carrera con un proceso en segundo plano.
- `server/long-running-chief.e2e.test.ts` (Linux y Windows): 2 tests distintos.
- `server/room-roots.e2e.test.ts` (Windows): reinicio de un turno.
- Vistos 1 vez más (PR #3 a #5): `routine-failure-spacing`, `surface-pins.e2e`, `thread-aware-bots.e2e`,
  `decider-rooms.e2e`, `antigravity-turn-outcome`, `session-credentials.e2e`. Si se repiten, van a la lista.
Se sumaron a `scripts/testing/ci-retry-list.json`: 2 reintentos solo en CI. Si siguen, hay que arreglarlos.
- También en la lista (22-11): `post-to-room` (2 veces), `checkpoints-perf` (3 veces) y 2 tests de pestañas de
  Chrome en Windows (2 veces). Pasan solos en este PC; fallan por carga en CI.
- 23-11: `antigravity-turn-outcome` (inodo reusado) y la espera del teléfono por USB en Mac: arreglados de verdad,
  sin reintentos. Va a la lista: `saved-steps/store` "keeps the 200 most recently used" (Windows, 40 s).
- Pendiente: recalibrar el reparto de tests entre partes de CI (`update-shard-weights`). Los tests nuevos de
  M2 y M3 no tienen tiempo registrado y una parte quedó más lenta.

## Mejoras sugeridas para el repo de Edu

Edu Bot funciona sin ellas, pero serían más seguras. Detalle en `~/Projects/edu-bot-wt/reports/claude-m2-pr4.md`.
1. Aprobar una puerta del crew con un secreto que solo tiene quien lo inició (hoy un proceso local podría aprobar).
2. Comandos `edu crew review` y `edu orchestrate --no-auto-approve` en la línea de comandos.
3. Que la revisión acepte una pregunta o archivos, no solo un diff de git.
4. Una etiqueta por programa (`EDU_AGENT_LABEL`), para saber qué bot escribió cada nota.
5. Una política por proyecto que limite qué CLIs puede usar el crew.
6. Un `edu init` que no registre la carpeta en el cerebro global.
- Tu copia local `~/Projects/edu` está vieja (v4). La versión instalada es 6.0.0.

## Pendientes vistos (para M5 o M6)

- Unas 440 líneas internas del servidor aún dicen OpenMausBot (no se ven en la app).
- Las guías de auto-hospedaje aún apuntan a scripts y releases de upstream.
- El servicio de relay se llama "Edu Bot Relay" en un diagnóstico, pero es el de upstream y está apagado.
- El teléfono usa la app publicada "MausBot". Edu Bot no tiene app de teléfono propia.

## Para la auditoría final (M6)

- Test "browser driver S4" en Windows: falla seguido incluso con reintentos (pestañas de Chrome). Revisar en M6.
- En español, el chat de un bot nuevo aún muestra textos en inglés: "Pick a starting point", "Sol sets itself up for
  whichever you choose…" y el botón "Connect apps". Se ven en la captura del README; rehacer la captura en M6.
- Mensajes de motores no instalados dicen "for the user running OpenMausBot". Cambiar a Edu Bot (inglés y español).
- Herramientas de datos locales (heredadas de upstream): un bot puede leer archivos de tu computador con ellas, igual
  que con su terminal. Se intentó encerrarlas en M4 y rompía cosas; se revisará en M6 con calma.

## Para el lanzamiento (M5)

- Los instaladores de `m5/release` no incluyen Android platform-tools ni Chrome for Testing.
  La lista de lo que sí viaja está en `docs/edu-bot/third-party-binaries.md`.

## Avisos

- Incidente (22-11): el comando `gh` de Grok usó el repo de upstream por defecto y abrió por error un PR en
  milind-soni/OpenMausBot (#7038). No se subió código allá; el PR quedó cerrado de inmediato, pero es visible.
  Arreglo: todas las copias fijan EduardoMoraga/edu-bot como repo por defecto y las reglas exigen `-R` en cada `gh`.

- 23-11, 08:19: el computador se reinició y cerró todos los agentes. No se perdió trabajo (todo estaba subido).

- Incidente (22-11): una prueba de la auditoría de Agy arrancó un servidor sin carpeta temporal y creó `~/.edubot`
  (solo 2 bots de prueba; la carpeta no existía antes, no se perdió nada). La moví a
  `/var/tmp/edubot-quarantine/`. Ahora la regla obliga a usar carpetas temporales y a revisar `~/.edubot` al terminar.

- A Codex le queda poco cupo semanal (23 % el 21-11). Por eso Claude hizo los arreglos del PR #4.

## Necesito de Eduardo

1. **Revisar y fusionar el PR de edu-cloud** (ya auditado, PASS): https://github.com/EduardoMoraga/edu-cloud/pull/2
   Agrega una llave por persona, con permiso de "miembro" o "aprobador". Es tu repo privado, por eso no lo fusiono yo.
   Edu Bot funciona sin él, pero sin él nadie puede aprobar memoria del área desde la app.
2. **Opcional: llave de prueba de Composio.** Un proyecto Composio vacío (sin tus cuentas reales), su llave
   `ak_...` guardada como secreto `EDUBOT_COMPOSIO_TEST_KEY` en GitHub Actions. Sin ella, esa prueba se salta.
3. **Probar en tu Mac** la app empaquetada (después de M1): "Apps" debe mostrar los pasos para la llave, no un error.
   (Los instaladores llegan en M5.)
4. **Nombre en npm (para M5).** El comando se llama `edubot`. Los nombres `edubot` y `edu-bot` están libres en npm.
   Para que nadie los tome, conviene reservarlos con tu cuenta de npm. No es urgente.
5. **Memoria del equipo.** Con 12 GB y 5 agentes, el sistema corta los procesos largos.
   Opcional: iniciar Claude Code con `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1`,
   o cerrar las otras sesiones de agentes que no uses.
6. **Opcional: certificados para firmar los instaladores.** Sin ellos, Mac y Windows muestran un aviso al abrir
   la app (el README explica cómo abrirla igual). Para Mac: Apple Developer ID (USD 99 al año) y sus secretos
   `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD` y los de notarización. Para Windows: un certificado de firma de código
   (`WIN_CSC_LINK`). No es urgente.
7. **Pendiente: probar "Usar este computador" en tu Mac (2 minutos).** La v0.1.0 ya está publicada; esta prueba
   quedó para después. Con el repo actualizado (`git pull`):
   1. En la Terminal: `pnpm install`.
   2. `pnpm dev:server` (déjalo abierto). En otra pestaña: `pnpm dev` (déjalo abierto).
   3. En una tercera pestaña: `pnpm dev:desktop`. La primera vez dice "Getting the screen control driver". Espera.
   4. En la app: Ajustes, busca "Permitir control de este equipo". Pulsa los dos botones de Ajustes del Sistema y en
      cada lista activa **Electron** (si no aparece, tu **Terminal**). Cierra la app y ábrela otra vez (paso 3).
   5. Pídele a un bot "abre la Calculadora". Debe pedirte permiso y abrirla.
   Si algo falla, dime en qué paso y qué texto ves.
