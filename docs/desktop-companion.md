# Open one computer's bots from another computer

A desktop app can share itself with your other computers over Tailscale. The computer that has the bots is the
**host**. The computer you sit at is the **client**: it opens the host's bots in its own window, from **Connect to a
server**. The bots, their conversations, keys and routines stay on the host.

Any desktop build can be the host or the client: Windows, macOS or Ubuntu. Both computers need Tailscale, signed in to
the same Tailscale account, with MagicDNS on. Nothing here is reachable from outside your Tailscale network.

A phone uses a different path: **Settings → Phone & devices → Pair a phone**, with the MausBot app from the App Store
or Google Play (Edu Bot uses that published phone app). A phone's code has six digits and only the phone app can use
it. The link a phone pairing creates is phone-only too: a desktop client that refuses it is
behaving as expected. A computer needs the link below.

## Share the host

1. On the host, open **Settings → Phone & devices**. Settings search finds the row too: type "other computers" or
   "tailscale".
2. Turn on **Your other computers**. This turns Tailscale on in the app first, if it is off, and turning the share off
   turns it off again unless you turned Tailscale on yourself or a phone is paired. The app never installs, starts or
   signs in Tailscale itself: if Tailscale is not installed, not running, signed out or waiting for approval on your
   Tailscale network, the row says so.
3. Wait for the line under the row: `Ready at https://<name>.ts.net` when Tailscale's HTTPS Certificates are on, or
   `Ready at http://<name>.ts.net:8799` when they are off. Both are private to your Tailscale network.
   When another program on the host already uses Tailscale's https address (an earlier `tailscale serve` on port 443),
   the app leaves that program alone and shares at `http://<name>.ts.net:8799`. The line says so. Nothing needs fixing.
4. Choose **Pair a computer**. The dialog shows the address and a 12-character code, with **Copy link**. The code works
   once, and the dialog says until when.

In Advanced mode the same page also has **More ways in → Tailscale**, the switch step 2 turns on for you.

## Connect the client

1. On the client, open the **You** menu at the bottom left, choose **Switch place**, then **Connect to a server**.
   Once the client has one server connected, **＋** at the end of the rail at the window's left edge opens the same
   sheet. So does **Settings → This app → Your computers → Connect to a server** (Advanced mode).
2. Paste the link. Or type the address and the code in their two boxes.
3. The sheet names the host it found and says it is on Tailscale. Choose **Connect to** and the host's name.
4. If the host is yours alone, the client asks **Let <host> use this computer?** **Allow** lends the apps on the
   client's screen while the app is open there; **Not now** lends nothing.

The host now sits on the client's rail beside This computer, and the host lists the client under **Paired** by its
computer name (a browser is listed as, for example, "Chrome on Windows").

## What the client lends

On the client, **Settings → This app → Your computers** (Advanced mode) has a **Share this computer** switch for the
host, and **Choose what it can use** for folders (read-only unless you allow edits), a terminal and screen control.
**Stop sharing** ends it at once, and **Activity on this computer** lists every request the host's bots made.

Chrome is not lent to a host that is one of your computers. The host's bots can open and use Chrome on the client
through the screen. Lending Chrome itself is built only for a MausBot Cloud home, which Edu Bot does not offer.

## End a connection

To end a connection from the host's side, remove that
device under **Paired** on the host's Phone & devices page. Turning **Your other computers** off stops the host
answering every other computer at once.

## Keep the host reachable

The host must be on, awake and connected to Tailscale. **Keep this computer awake** on the host's Phone & devices page
holds it awake while a way in is on, and that includes **Your other computers**.

## What the client says when it can't connect

| It says | Do this |
|---|---|
| "…is an Edu Bot desktop app. To open it from here, turn on Tailscale and Your other computers…" | The address reached the host's phone link or an app that is not shared. Share the host as above and use its link. |
| "That code is for the phone app…" | A six-digit code was typed. Use **Pair a computer** on the host. |
| "Tailscale isn't connected on this computer." | Open Tailscale on the client and sign in. |
| "…isn't on this computer's tailnet." | The two computers are signed in to different Tailscale accounts. |
| "…is on your tailnet but didn't answer." | The host is asleep, offline, or **Your other computers** is off. |
| "macOS blocked the connection…" | On the client, allow the app in System Settings → Privacy & Security → Local Network. |

## Security

- The share is off until you turn it on, and an organization's policy that turns remote access off disables it.
- With HTTPS Certificates on, `tailscale serve` fronts the host's server on port 443 of its `.ts.net` name. With them
  off, the server listens on the host's own Tailscale addresses on port 8799. It never listens on every interface, so
  a device on the same Wi-Fi that is not on your Tailscale network gets no answer.
- A request that names another host is refused, and so is one that names the loopback address from outside.
- Being on the Tailscale network is not enough: every client pairs with a one-time code and gets its own session,
  which the host lists and can sign out.

[docs/verification/tailscale.md](verification/tailscale.md) has the script that proves this on two real computers.

## Without Tailscale

Run a server of your own (`edubot serve`) and connect both computers to it: see [self-hosting](self-hosting.md).
Edu Bot does not offer MausBot Cloud (My Cloud).

## The earlier desktop companion connection

Older versions paired one desktop app to another with a six-digit code and a managed `https://c-….` address, and the
client restarted into a client mode. No new connection of that kind can be made. Desktop Companion mode is marked in
the app for sunset on December 7, and the log line `the secure address ended (retired)` is that shutdown being
reported, not a failure. An installation still connected that
way sees a notice in **Settings → This app** (Advanced mode) with **Disconnect and use this computer**; after disconnecting, connect again
with the steps above.
