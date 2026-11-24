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

**Cambio de plan (24-11, 15:27 hora de Chile).** Eduardo está en FFM, no en el Mac mini. Hoy se prueba **FFM
como home** con el teléfono **S24 Ultra**. Ver la sección "Hoy: FFM como home y el S24". El emparejamiento del
Mac mini con FFM queda para cuando Eduardo esté en el Mac mini.

Desde este computador (omarchy) no tengo acceso a los equipos: el Mac mini rechaza mi llave SSH y FFM no tiene SSH.
Los comandos son para Edu Git; los pasos con las manos son para Eduardo.

## Hoy: FFM como home y el S24

| Equipo | Rol | Tailscale |
| --- | --- | --- |
| FFM-EDUARDOMORAGA | **home** (Edu Bot 0.1.0 ya instalado) | `ffm-eduardomoraga.tail9f9734.ts.net` (100.124.16.12) |
| S24 Ultra de Eduardo | teléfono (Android) | `s24-ultra-de-eduardo.tail9f9734.ts.net` (100.104.237.32) |

**Cuidado, es el PC de trabajo de Cheil:**

- La pantalla: antes de probar, cierra o minimiza todo lo de Cheil. El bot ve lo que haya en pantalla.
- Chrome: **no** uses el perfil **Mi Chrome** en FFM. Ese perfil le da al bot tu Chrome real, con tus sesiones
  de trabajo abiertas. Chrome se prueba solo con la pantalla, en una página neutra (`example.com`).
- La carpeta: solo `%USERPROFILE%\EduBotPrueba`. Nunca `C:\Cheil`.

### Lo que vi desde omarchy (24-11, 18:29 UTC)

- FFM responde en Tailscale, pero **por relé** (`via DERP(sao)`, 123 ms, `direct connection not established`).
  Funciona, solo que es más lento. Probablemente la red de la oficina bloquea la conexión directa.
- Los puertos 443, 8799, 18799 y 8810 de FFM **no contestan** (`Connection timed out`). Es lo esperado mientras
  **Tus otros ordenadores** siga apagado.
- El `HTTP/2 502` que se veía antes en el 443 ya no aparece.
- **Riesgo**: si después de encender **Tus otros ordenadores** siguen sin contestar, el sospechoso es el
  Firewall de Windows. En un PC de empresa no se puede cambiar sin admin. Los comandos de (c) lo revisan.

### (a) Emparejar el S24 con FFM: pasos para Eduardo

**En el S24:**
1. Abre la app **Tailscale**. Debe decir **Connected**.
2. Instala la app **MausBot** desde Google Play. Edu Bot usa la app de teléfono de MausBot. Si no la encuentras,
   anótalo y para aquí.

**En FFM:**
1. Abre Edu Bot.
2. Ve a **Ajustes**. Busca "otros ordenadores". Enciende **Tus otros ordenadores**. Espera "Listo en …".
   Esto enciende también Tailscale dentro de la app.
3. En la misma página (**Teléfono y dispositivos**), pulsa **Vincular un teléfono**.
4. Sale un **código QR** y un **código de 6 dígitos**. El código dura **2 minutos**.

**En el S24, con la app MausBot:**
1. Escanea el **QR** de la pantalla de FFM. Es lo más fácil.
2. Si el QR no funciona, elige **Other ways to connect** (otras formas de conectar) y escribe:
   - Dirección: `http://ffm-eduardomoraga.tail9f9734.ts.net:8810`
   - Código: los 6 dígitos de FFM. Si pasaron 2 minutos, pide otro en FFM.
3. Confirma el nombre del computador. Debe decir **Tailscale connection**.
4. Abre un bot y escribe "hola". Debe contestar.

Anota el texto exacto de cualquier error.

### (b) El bot usa la carpeta, la pantalla y Chrome de FFM

Antes: el bot necesita un motor con sesión iniciada en FFM, por ejemplo Claude o Codex. Los comandos de (c) lo
revisan. Si no hay ninguno, inicia sesión en **Ajustes → IA → Proveedores**.

**Carpeta:**
1. Abre un bot. Ve a lo que puede usar. En **Carpeta de trabajo**, pulsa **Elegir…** y elige
   `C:\Users\<tu usuario>\EduBotPrueba`. Guarda.
2. Empieza una **tarea nueva** (la carpeta vale desde la tarea nueva).
3. Escribe: "Lista los archivos de tu carpeta de trabajo y lee hola.txt".
4. Debe nombrar `hola.txt` y decir "prueba multi-dispositivo …".

**Pantalla:**
1. Cierra o minimiza todo lo de Cheil.
2. En el panel **Pantalla** del bot, en **Trabaja en**, elige **Este equipo**.
3. Si aparece "El control de pantalla no está corriendo en este PC", pulsa **Iniciar control de pantalla**.
   Si dice que Seguridad de Windows lo detuvo, copia el texto y para aquí: no lo permitas con admin.
4. Escribe: "Toma una captura de mi pantalla y dime qué ves".

**Chrome (con la pantalla, sin Mi Chrome):**
1. Escribe: "Abre Google Chrome y entra a example.com. Dime el título de la página".
2. Debe abrir Chrome en la pantalla de FFM y decir "Example Domain".

| # | Chequeo | Resultado |
| --- | --- | --- |
| L1 | **Tus otros ordenadores** dice "Listo en …" (anota la dirección) | pendiente |
| L2 | Desde omarchy: FFM responde por Tailscale; rechaza `Host` falso (421) y `/api/bots` sin sesión (403) | pendiente |
| L3 | El bot lista `EduBotPrueba` y lee `hola.txt` | pendiente |
| L4 | Control de pantalla corre en FFM | pendiente |
| L5 | El bot toma una captura de la pantalla de FFM | pendiente |
| L6 | El bot abre Chrome en FFM y lee el título de `example.com` | pendiente |
| P1 | **Vincular un teléfono** muestra QR y código de 6 dígitos | pendiente |
| P2 | La app MausBot del S24 empareja (QR o dirección + código) y dice **Tailscale connection** | pendiente |
| P3 | El S24 ve los bots y chats de FFM | pendiente |
| P4 | "hola" desde el S24 llega y el bot responde | pendiente |
| P5 | El S24 aparece en la lista de teléfonos de FFM | pendiente |

### (c) Comandos para Edu Git en FFM (PowerShell normal, sin admin, solo lectura)

**Antes de empezar** (pega toda la salida):

```powershell
$ts = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
if (-not $ts) { $ts = "C:\Program Files\Tailscale\tailscale.exe" }
"tailscale CLI: $ts"
& $ts status --self
& $ts serve status
Get-Process | Where-Object ProcessName -like "Edu Bot*" | Select-Object ProcessName, Id
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object LocalPort -in 443,8799,8800,8810,8811,18799,28799 |
  Select-Object LocalAddress, LocalPort, OwningProcess, @{n="Proceso";e={(Get-Process -Id $_.OwningProcess).ProcessName}}
foreach ($p in 8799,18799,28799) { try { "${p}: " + (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://127.0.0.1:$p/api/health").Content } catch { "${p}: sin respuesta" } }
Get-Command claude, codex, agy, gemini -ErrorAction SilentlyContinue | Select-Object Name, Source
Get-ChildItem "$env:USERPROFILE\EduBotPrueba"
Get-NetConnectionProfile | Select-Object InterfaceAlias, NetworkCategory
Get-NetFirewallProfile -ErrorAction SilentlyContinue | Select-Object Name, Enabled, DefaultInboundAction
Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "*Edu Bot*" -or $_.DisplayName -like "*Tailscale*" } |
  Select-Object DisplayName, Enabled, Direction, Action, Profile
```

Si algún comando da "Acceso denegado", anótalo y sigue.

**Después de que Eduardo encienda Tus otros ordenadores** (repite el bloque de arriba y además):

```powershell
& $ts serve status
Get-ChildItem "$env:APPDATA\Edu Bot\logs" -ErrorAction SilentlyContinue
Get-Content "$env:APPDATA\Edu Bot\logs\server.log" -Tail 40 -ErrorAction SilentlyContinue
```

**Después de emparejar el S24:**

```powershell
foreach ($p in 8799,18799,28799) { try { "${p}: " + (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://127.0.0.1:$p/api/auth/sessions").Content } catch { "${p}: sin respuesta" } }
```

Desde omarchy, cuando FFM diga "Listo en …", corro yo los chequeos de L2 (identidad, `Host` falso y
`/api/bots` sin sesión).

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
| H1 | Edu Bot 0.1.0 abierto, servidor en `127.0.0.1:8799` | **OK** (Edu Git, 14:58 Chile): escucha solo en `127.0.0.1:8799`, `:8800` y `:64199`. Health: `app: openmausbot`, `product: Edu Bot`, `version: 0.1.0`, doctor 9 chequeos, 0 problemas. (A los 10 s del primer arranque todavía no escuchaba.) |
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

Edu Git (14:58) no encontró `server.log` en `~/Library/Application Support/Edu Bot` ni en `~/.edubot`. La app lo
escribe en la carpeta de logs del sistema: `~/Library/Logs/Edu Bot/server.log`.

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
