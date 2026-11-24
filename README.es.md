# Edu Bot

[English](README.md)

Edu Bot es una app de escritorio para Linux, Windows y macOS.
Conversas con varios bots de IA. Cada bot puede usar un motor que ya tienes.
Las conversaciones se quedan en tu computador. La app es de código abierto.

![Edu Bot en español: bandeja de entrada, el ayudante Edu y un bot nuevo](docs/images/chat-es.png)

## Instalar

Descarga la **0.1.0** desde [GitHub Releases](https://github.com/EduardoMoraga/edu-bot/releases).

Estos instaladores no están firmados. El sistema pide confirmación antes de abrirlos.

**macOS** (Apple silicon o Intel): `EduBot-0.1.0-arm64.dmg` o `EduBot-0.1.0-x64.dmg`. La misma versión también trae un `.zip` de la misma compilación.
Arrastra la app del `.dmg` a Aplicaciones.
Ábrela una vez. macOS la bloquea.
Luego abre Configuración del Sistema, luego Privacidad y seguridad, y elige Abrir de todas formas.

**Windows** (64 bits): `EduBot-0.1.0-setup.exe`.
Si aparece SmartScreen, elige Más información y después Ejecutar de todas formas.

**Linux** (64 bits):

- AppImage: `chmod +x EduBot-0.1.0-x86_64.AppImage` y ejecuta ese archivo.
- Paquete deb: `sudo apt install ./EduBot-0.1.0-amd64.deb`.

Cada versión incluye `SHA256SUMS`. Compara el archivo que descargaste con esa lista antes de abrirlo.

La app no se actualiza sola. Descarga el instalador nuevo desde la misma página e instálalo del mismo modo. Tus chats siguen en `~/.edubot`.

## Primeros pasos

1. Inicia sesión en un motor en este computador. Edu Bot usa programas que ya tienes, por ejemplo `claude`, `codex` y Antigravity (`agy`, para Gemini). Hay más en **Ajustes → IA → Proveedores**.
2. Crea un bot con **Bot nuevo**.
3. Abre Apps. Pulsa Conectar en Notion, Linear o Atlassian e inicia sesión en tu navegador. Para GitHub, pega un token. Para tu propio servidor MCP, pega su enlace. Gmail, Google Calendar y Slack necesitan tu propia clave de proyecto de Composio (empieza con `ak_`): Apps la pide en Más apps. Mira [Conectar apps](docs/composio.md) y [servidores MCP propios](docs/custom-mcp-servers.md).
4. En Ajustes, activa el **Modo avanzado**, o busca **Datos**. Luego agrega una conexión SQL de solo lectura en **Ajustes → Datos → Conexiones de datos**. Sirven SQLite, DuckDB y Postgres. La contraseña queda en la Bóveda. Por una conexión, un bot lee solo las tablas que tú permites: ese es el límite firme. Las herramientas de datos locales del bot pueden leer otros archivos a los que el bot llega, igual que su terminal. Rechazan el archivo de base de datos de una conexión, una carpeta permitida para conexiones y la carpeta de datos de Edu Bot, también a través de un enlace, y rechazan una carpeta demasiado grande para revisarla.

## Memoria Edu

Instala [Edu](https://github.com/EduardoMoraga/edu) 6.0.0 o más nuevo. Necesita Node.js 22 o más nuevo. Edu no está en el registro de npm: instala su archivo de versión verificado.

```bash
curl -fsSLO https://github.com/EduardoMoraga/edu/releases/latest/download/edu-agent.tgz
curl -fsSLO https://github.com/EduardoMoraga/edu/releases/latest/download/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS   # en macOS: shasum -a 256 --check --ignore-missing SHA256SUMS
npm install -g ./edu-agent.tgz
```

En Windows, usa el instalador de una línea de la [guía rápida de Edu](https://github.com/EduardoMoraga/edu#quickstart). Cada bot recibe entonces un cerebro Edu. Puede recordar notas y proponer otras.

Una nota canónica queda como propuesta hasta que una persona la acepta. En el uso normal, la app impide que un bot la apruebe: cada motor corre con la protección de trabajador de crew de Edu. Un bot con terminal podría quitar esa protección, así que el límite firme necesita un secreto de aprobación en el propio Edu; es una mejora planeada de Edu. La app funciona igual si Edu no está instalado.

Edu crew deja que un bot pida a otras herramientas de código que armen un plan. Sigue apagado hasta que lo actives en ese bot. Tú apruebas cada plan.

Detalle: [cerebro Edu](docs/edu-brain.md).

## Perfiles de la organización

La organización, sus áreas y sus bots pueden vivir en archivos. Dos personas con la misma carpeta obtienen los mismos bots. Las claves se quedan en el computador de cada persona.

La app muestra un plan primero. Nada cambia hasta que lo aplicas. Una línea **Da más acceso** solo se aplica si tú la permites en la app de escritorio.

Ábrelo en **Ajustes → Perfiles**. En una copia local, ejecuta `pnpm omb profiles plan <carpeta>` y `pnpm omb profiles apply <carpeta>`.

Detalle: [Perfiles](docs/profiles.md).

## Privacidad

Edu Bot no envía analítica de uso. La app de escritorio no busca actualizaciones.

Al iniciar, Edu Bot consulta unas listas públicas de modelos y de versiones. Un motor que ya instalaste puede llamar a su propio servicio en ese momento. Cualquier otro contacto ocurre solo cuando usas esa función. La lista está en [Red](docs/edu-bot/network.md).

Los chats, los bots y los ajustes quedan en `~/.edubot`, en este computador. Mira [dónde viven los archivos](docs/edu-bot/data.md).

## Compilar desde el código

Necesitas Node.js 24 o más nuevo, y pnpm 10.33.0. Los dos están en `package.json`.

```sh
git clone https://github.com/EduardoMoraga/edu-bot.git
cd edu-bot
pnpm install
```

Ejecuta `pnpm dev:server` en una terminal y `pnpm dev` en otra. Deja las dos corriendo.

`pnpm dev:server` es el servidor local. `pnpm dev` es la app en el navegador. `pnpm dev:desktop` abre la ventana de escritorio, y necesita que las dos estén corriendo. La primera vez descarga Electron si falta y, en macOS y Windows, el driver con el que los bots usan este equipo. En Mac, permite Electron (o la terminal desde la que lo iniciaste) en Accesibilidad y Grabación de pantalla.

`pnpm lint` revisa tu copia local. [CI](docs/ci.md) dice qué tests corren.

Para colaborar, crea una rama desde `main` y abre un pull request en este repositorio.

## Licencia y créditos

Edu Bot es [Apache-2.0](LICENSE). Los avisos de copyright están en [NOTICE](NOTICE).

Edu Bot se basa en [OpenMausBot](https://github.com/milind-soni/OpenMausBot). Es un proyecto aparte. No está afiliado a Supamaus Software Private Limited ni al proyecto OpenMausBot.

Los programas de terceros dentro de los instaladores están en [binarios de terceros](docs/edu-bot/third-party-binaries.md).
