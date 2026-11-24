# Prueba multi-dispositivo con Tailscale

Fecha: 24-11-2026. Versión: Edu Bot 0.1.0.

| Equipo | Rol | Tailscale |
| --- | --- | --- |
| Mac mini de EduardoMoraga | **home**: aquí viven los bots | `mac-mini-de-eduardomoraga.tail9f9734.ts.net` (100.90.146.38) |
| FFM-EDUARDOMORAGA | segundo computador (Windows, PC de trabajo) | `ffm-eduardomoraga.tail9f9734.ts.net` (100.124.16.12) |
| S24 Ultra o iPhone 15 Pro Max | teléfono | en la misma red Tailscale |
| NucBox_M6 | tercer computador, solo si se enciende | apagado hace 30 días |

No se toca `cheil-sofland` (es de otra persona), ni `C:\Cheil`, ni datos de Cheil. En FFM no se usa admin.

## Estado

**En curso.** Edu Bot 0.1.0 ya está instalado y abierto en el Mac mini y en FFM. H2 a H5 esperan que el Mac mini
comparta (pasos 1 a 3 de Eduardo). El resto está **preparado, falta correrlo**.

Desde este computador (omarchy) no tengo acceso a los equipos: el Mac mini rechaza mi llave SSH y FFM no tiene SSH. Los comandos de abajo son para Edu Git; los pasos con las manos son para Eduardo.

## Lo que ya revisé (desde omarchy, 24-11)

- Los dos equipos responden en Tailscale (`tailscale ping` al Mac mini: 65 ms).
- Mac mini: nada escucha en `:443` ni en `:8799` por Tailscale. Edu Bot no está abierto, o **Tus otros
  ordenadores** está apagado. Es lo esperado antes de empezar.
- FFM: `https://ffm-eduardomoraga.tail9f9734.ts.net/` responde `HTTP/2 502` vacío. Hay un `tailscale serve`
  viejo que apunta a un servidor apagado. No molesta a la prueba (FFM es cliente). No lo borro: Edu Git anota qué
  es con `tailscale serve status`.

Lo que dice el código (revisado, sin cambios):

1. **Vincular un ordenador** en el home da acceso completo (admin). El cliente entra por **＋ → Conectar a un
   servidor** pegando el enlace.
2. Prestar el PC al home **sí funciona** con un home que es un computador, si eres su único dueño. Tras emparejar,
   FFM pregunta **"¿Dejar que <Mac mini> use este equipo?"**. **Permitir** presta la pantalla. Las carpetas y
   la terminal se eligen después en **Ajustes → Servidores → Compartir este ordenador → Elegir qué puede usar**.
3. **Chrome no se presta a un home propio.** El código solo presta Chrome a My Cloud
   (`electron/computer-sharing.mjs`, `ownIdentity` fija `chrome: false`). Es así por diseño, no es un error. Con un
   Mac mini de home, el bot usa la pantalla de FFM, y con ella puede abrir y usar Chrome, pero no Chrome conectado
   directo.
4. En la lista **Emparejados** del home, FFM aparece como **"Chrome on Windows"**, no con su nombre. En los
   computadores prestados aparece con su nombre de equipo (`FFM-EDUARDOMORAGA`).
5. El teléfono usa la app **MausBot** de App Store o Google Play. El código de 6 dígitos sale en **Ajustes →
   Teléfono y dispositivos → Vincular un teléfono** y dura 2 minutos. Por Tailscale el teléfono usa
   `http://mac-mini-de-eduardomoraga.tail9f9734.ts.net:8810` (el nombre, no el número 100.x).
6. El cambio de nombre a Edu Bot no rompe nada de esto: el teléfono y el cliente siguen viendo `openmausbot` donde
   lo esperan.

## Resultados: Mac mini (home)

| # | Chequeo | Resultado |
| --- | --- | --- |
| H1 | Edu Bot 0.1.0 abierto, servidor en `127.0.0.1:8799` | **A medias** (Edu Git, 14:07 Chile): no estaba instalado. Se instaló el `.dmg` de la v0.1.0 y se abrió; el proceso corre. A los 10 s **no escuchaba en 8799**. Falta ver en qué puerto queda |
| H2 | **Tus otros ordenadores** encendido: dice `Listo en https://…ts.net` (o `http://…:8799`) | **No listo** (24-11, 16:59 UTC): el Mac mini no comparte nada. Ver "Intentos H2 a H5" |
| H3 | Desde omarchy: `/.well-known/openmausbot/environment` responde por Tailscale | **Falla por ahora**: `curl: (7) Failed to connect to mac-mini-de-eduardomoraga.tail9f9734.ts.net:443` (y `:8799`) |
| H4 | Seguridad: `Host: evil.example.com` da 421; `/api/bots` sin sesión da 403 | pendiente: necesita H3 |
| H5 | `:8799` escucha solo en loopback y Tailscale, nunca en `*:8799` | pendiente: necesita H3 |
| H6 | FFM aparece en **Emparejados** (como "Chrome on Windows") y en `GET /api/auth/sessions` | pendiente |
| H7 | Un bot del home lista la carpeta de prueba de FFM | pendiente |
| H8 | Un bot del home ve la pantalla de FFM (captura) y abre Chrome en FFM | pendiente |
| H9 | El teléfono aparece en la lista de teléfonos del home | pendiente |

### Instalación en el Mac mini (Edu Git, 24-11, 14:07 hora de Chile)

- Al llegar: Edu Bot **no estaba instalado** ni corriendo. Nada en `:8799`; `/api/health` vacío.
- Tailscale bien: `100.90.146.38`. Sin `tailscale serve`.
- Se instaló la v0.1.0 (el `.dmg` de la release) en `/Applications`. Se le quitó la cuarentena y se abrió.
- El proceso corre. La app guarda sus datos de ventana en `~/Library/Application Support/Edu Bot`.
- A los 10 s todavía **no escuchaba en 8799**. La app prueba los puertos 8799, 18799 y 28799, en ese orden
  (`electron/desktop-ports.mjs`). El registro del servidor está en `~/Library/Logs/Edu Bot/server.log`.
- **No confirmado**: que **Tus otros ordenadores** esté encendido. Antes no se podía, porque la app no existía.

Para saber en qué puerto quedó (Edu Git, en el Mac mini):

```sh
lsof -nP -iTCP -sTCP:LISTEN | grep -iE 'edu|electron|node' | head
for p in 8799 18799 28799; do printf '%s: ' $p; curl -s -m 3 http://127.0.0.1:$p/api/health; echo; done
tail -n 40 ~/Library/Logs/"Edu Bot"/server.log
```

### Intentos H2 a H5 (desde omarchy, que está en la misma red local que el Mac mini, `192.168.68.55`)

**24-11, 16:59 UTC.** El Mac mini está en línea en Tailscale (`tailscale ping`: 100 ms, directo por
`192.168.68.61`). En `100.90.146.38` el puerto 22 está abierto. Los puertos 80, 443, 5173, 8799, 8800, 8810, 8811 y
8443 rechazan la conexión (`Connection refused`). Quiere decir que Edu Bot no está abierto, o que **Tus otros
ordenadores** está apagado. Faltan los pasos 1 a 3 de Eduardo en el Mac mini.

Queda una vigilancia en omarchy: cuando el Mac mini abra 443, 8799, 18799 o 28799, corre sola estos chequeos y
los anoto aquí. A las 17:06 UTC (después de la instalación) los cuatro seguían cerrados por Tailscale: es lo
esperado mientras **Tus otros ordenadores** esté apagado, porque la app escucha solo en `127.0.0.1`.

- H3: `GET /.well-known/openmausbot/environment` y `/api/health` sin sesión, por `https://<nombre>` y
  `http://<nombre>:8799`.
- H4: `Host: evil.example.com` y `Host: 127.0.0.1:8799` deben dar 421; `/api/bots`, `/api/auth/sessions` y
  `POST /api/auth/pairing` sin sesión deben dar 403 o 401.
- H5: `http://192.168.68.61:8799` (red local, sin Tailscale) no debe responder. Con certificados HTTPS,
  `http://100.90.146.38:8799` tampoco debe responder (el servidor queda solo en loopback detrás de `tailscale serve`).

## Resultados: FFM-EDUARDOMORAGA (segundo computador)

| # | Chequeo | Resultado |
| --- | --- | --- |
| F1 | Edu Bot 0.1.0 instalado sin admin (instalador por usuario) y abierto | **OK** (Edu Git, 14:07 Chile): `EduBot-0.1.0-setup.exe /S` instaló en `%LOCALAPPDATA%\Programs\edu-bot`, sin admin. La app corre |
| F2 | **＋ → Conectar a un servidor** encuentra el Mac mini y dice "Tailscale" | pendiente |
| F3 | Conecta y se puede chatear con un bot del home desde FFM | pendiente |
| F4 | Sale "¿Dejar que … use este equipo?" y Permitir funciona | pendiente |
| F5 | **Ajustes → Servidores**: compartir la carpeta `EduBotPrueba` (solo lectura) | pendiente |
| F6 | Permisos de pantalla en Windows: el controlador de pantalla corre | pendiente |
| F7 | **Ajustes → Servidores → Acceso al equipo** registra lo que hizo el bot | pendiente |

### Instalación en FFM (Edu Git, 24-11, 14:07 hora de Chile)

- Tailscale bien: `100.124.16.12`.
- Solo había un clon viejo del código (`ee20686`), cerrado. No se usó.
- Se instaló la v0.1.0 con `EduBot-0.1.0-setup.exe /S` en `%LOCALAPPDATA%\Programs\edu-bot`, sin admin. La app
  corre.
- Chrome está en `C:\Program Files\Google\Chrome\Application\chrome.exe`.
- Carpeta de prueba creada: `%USERPROFILE%\EduBotPrueba\hola.txt`. Es lo único que se va a compartir.
- Sigue sin aclarar el `HTTP/2 502` en el puerto 443 de FFM (un `tailscale serve` viejo). Para verlo:
  `& "C:\Program Files\Tailscale\tailscale.exe" serve status`. No molesta: FFM es cliente.

## Resultados: teléfono

| # | Chequeo | Resultado |
| --- | --- | --- |
| T1 | Código de 6 dígitos en el home | pendiente |
| T2 | La app MausBot empareja con el código | pendiente |
| T3 | El teléfono ve los bots y chats del home | pendiente |
| T4 | Un mensaje desde el teléfono llega y el bot responde | pendiente |

## Resultados: NucBox_M6

Apagado hace 30 días. Si Eduardo lo enciende, se repiten los chequeos F1 a F7 aquí.

## Errores exactos

Ninguno todavía.

---

## Comandos para Edu Git

Solo leen, salvo crear la carpeta de prueba en FFM. Pega la salida completa de cada bloque.

### Mac mini, antes de empezar (Terminal)

```sh
TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale; command -v tailscale >/dev/null && TS=tailscale
"$TS" status --self; "$TS" serve status
defaults read "/Applications/Edu Bot.app/Contents/Info" CFBundleShortVersionString
pgrep -fl "Edu Bot" | head -3
lsof -nP -iTCP:8799 -sTCP:LISTEN
curl -s http://127.0.0.1:8799/api/health; echo
```

### FFM, antes de empezar (PowerShell normal, sin admin)

```powershell
& "C:\Program Files\Tailscale\tailscale.exe" status --self
& "C:\Program Files\Tailscale\tailscale.exe" serve status
Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* |
  Where-Object DisplayName -like "Edu Bot*" | Select-Object DisplayName, DisplayVersion, InstallLocation
Get-Process | Where-Object ProcessName -like "Edu Bot*" | Select-Object ProcessName, Id
Test-Path "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe", "C:\Program Files\Google\Chrome\Application\chrome.exe"
New-Item -ItemType Directory -Force "$env:USERPROFILE\EduBotPrueba" | Out-Null
Set-Content "$env:USERPROFILE\EduBotPrueba\hola.txt" "prueba multi-dispositivo $(Get-Date -Format s)"
Get-ChildItem "$env:USERPROFILE\EduBotPrueba"
```

Si Edu Bot no está en FFM: descarga `EduBot-0.1.0-setup.exe` y `SHA256SUMS` de
https://github.com/EduardoMoraga/edu-bot/releases/tag/v0.1.0 y compara:
`(Get-FileHash .\EduBot-0.1.0-setup.exe -Algorithm SHA256).Hash` con la línea de `SHA256SUMS`. El instalador es
por usuario: no pide admin. Si pide admin, para y anótalo.

### Mac mini, después de emparejar FFM

```sh
curl -s http://127.0.0.1:8799/api/auth/sessions | python3 -m json.tool
lsof -nP -iTCP:8799 -sTCP:LISTEN
```

### FFM, después de compartir

```powershell
Get-Process | Where-Object { $_.ProcessName -like "*cua*" } | Select-Object ProcessName, Id, Path
```

## Pasos para Eduardo

**En el Mac mini:**
1. Abre Edu Bot.
2. Ve a Ajustes. Busca "otros ordenadores". Enciende **Tus otros ordenadores**.
3. Espera la línea "Listo en …".
4. Pulsa **Vincular un ordenador**. Pulsa **Copiar enlace**. Mándate el enlace a FFM (sirve una sola vez).

**En FFM:**
1. Abre Edu Bot.
2. Pulsa **＋** (abajo a la izquierda) y luego **Conectar a un servidor**.
3. Pega el enlace. Pulsa **Conectar a** Mac mini.
4. Si pregunta "¿Dejar que … use este equipo?", pulsa **Permitir**.
5. Ve a Ajustes, luego Servidores, luego **Elegir qué puede usar**. Elige solo **la carpeta `EduBotPrueba`**.
   Nunca `C:\Cheil`.

**Prueba con un bot (desde FFM o el Mac mini):**
1. Escribe: "Lista los archivos de la carpeta EduBotPrueba de mi PC".
2. Escribe: "Toma una captura de la pantalla de mi PC".
3. Escribe: "Abre Chrome en mi PC".

**En el teléfono:**
1. Instala la app **MausBot** (App Store o Google Play) y abre Tailscale en el teléfono.
2. En el Mac mini: Ajustes, busca "Vincular un teléfono". Sale un código de 6 dígitos (dura 2 minutos).
3. En la app escribe la dirección `http://mac-mini-de-eduardomoraga.tail9f9734.ts.net:8810` y el código.
4. Abre un bot y escribe "hola".

Anota en cada paso lo que ves. Si sale un error, copia el texto exacto.
