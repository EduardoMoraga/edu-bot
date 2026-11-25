# Using Edu Bot on more than one device

This page is for a person with two or more computers, or a computer and a phone, who wants the same bots everywhere.
It says what each device keeps, what does and does not travel between them, the ways to use one set of bots from every
device, and what to check when a device looks empty.

## What each device keeps

The desktop app runs a full Edu Bot on the computer it is installed on. Until you choose another home (below), that
computer is the bots' **home**: their conversations, memory, skills, routines, connected apps and keys are stored
there, and its routines run there.

Installing Edu Bot on a second computer does not copy the first computer's home. Unless both computers open the same
home (below), each has its own: a new computer can show an empty Inbox, and a bot created on one computer does not
appear in the other's list. Engine sign-ins (Claude, Codex and the rest) are separate too, because they belong to the
machine the bots run on.

Bots work together only within one home: a bot on one computer cannot reach a teammate on another.

## One set of bots on every device

Pick one home, then open it from your other devices. There are two ways:

| Home | Good for | How |
| --- | --- | --- |
| **One of your computers** | Two desktops on the same Tailscale network | On the computer with the bots, turn on **Settings → Phone & devices → Your other computers** and choose **Pair a computer**. On the other, open **Settings → This app → Your computers → Connect to a server** and paste the link. The bots stay on the first computer, which must be on. See [desktop-companion.md](desktop-companion.md). |
| **Your own server** | A VPS or always-on machine you run yourself | Pair each device with it, then right-click the server's circle at the window's left edge and choose **Make <server> my home** to move this computer's bots there. See [self-hosting.md](self-hosting.md). |

Edu Bot does not offer MausBot Cloud (My Cloud, Team Clouds or their plans). The app has no Cloud sign-in unless the
person who runs it sets `OMB_CLOUD_ACCOUNT=1`, which points it at the upstream service.

A phone is paired separately, with the **MausBot** app from the App Store or Google Play: Edu Bot uses that published
phone app. On the computer, choose **Settings → Phone & devices → Pair a phone**. It shows a QR code and a six-digit
code that lasts two minutes. The phone connects on the same Wi-Fi or through Tailscale, and opens the home it paired
with. See [ios-companion.md](ios-companion.md).

## See your own computers

**Settings → Phone & devices → My computers** lists your other computers on Tailscale and says, for each, whether it
has Edu Bot open (with its version), is online without Edu Bot, or is off. This computer is not in the list.

- Only your own devices count: the same Tailscale user as this computer, in the same tailnet, with no tags. Nodes
  someone shared into your tailnet, and devices of other people in it, are never listed.
- It only looks. Nothing is paired, shared or connected from the list, and no other computer learns anything new: each
  one is asked the same public question **Connect to a server** asks (`/.well-known/openmausbot/environment`), over
  Tailscale only.
- A computer shows Edu Bot only while **Your other computers** is on there, since that switch is what lets other
  computers reach it.
- The list is read when you open it and every minute while it stays open, and never in the background. It needs
  Tailscale's command-line tool on this computer.

## What the other computer lends

When a computer connects to a home that is yours alone, it asks once: **Let <home> use this computer?** **Allow**
lends the apps on that computer's screen while Edu Bot is open there. Folders and a terminal are added on that same
computer, in **Settings → This app → Your computers → Share this computer → Choose what it can use** (turn on
**Advanced mode** at the bottom of Settings to see **Your computers**).

Chrome is not lent to a home that is one of your computers or your own server. The home's bots get the other
computer's screen and folders, and can open and use Chrome there through the screen. Lending Chrome itself with its
signed-in profile is built only for a MausBot Cloud home, which Edu Bot does not offer.

After a move to your own server, the computer you moved from stops running its copy, so no routine runs twice. On
your own server lending happens by itself only when you are its one owner; on a server with other members or admins,
lending also needs `features.sharedComputers` set to `true` (see [feature-flags.md](feature-flags.md)).

## Moving bots by hand

To copy one computer's bots to another home without a move, export a backup on the old one with **Settings → Import &
export → Export backup** and import it on the new one with **Import backup**. Importing replaces the bots and chats
already on the new home: they move to a safety copy under `.backups/` in its data folder, so export the new home's own
backup first if you still need what is on it. API keys, engine sign-ins and paired
devices stay where they are on both sides, and routines arrive paused: sign in to your AI on the new home and turn the
routines you want back on.

## When a device looks wrong

| What you see | Why, and what to do |
| --- | --- |
| A computer where you just installed Edu Bot has an empty Inbox and no bots | It has its own home. Open the home that has your bots (the other computer or your server), or move the bots as above. |
| A bot made on one computer is missing on another | Each home has its own bots. Use one home for both computers. |
| A bot says it can't reach a teammate | The teammate lives in another home. Bring both homes together with one of the ways above. |
| Bots came over in a backup but can't answer | Engine sign-ins and API keys stay out of a backup. Sign in to your AI again on the new home. |
| Routines did not run after a backup import | Imported routines arrive paused. Turn them back on. |
| The second computer can't connect to the first | Check the troubleshooting table in [desktop-companion.md](desktop-companion.md). |
