# 06: Hosting

There are three ways to run a game for friends. All of them run the same server: it serves the game's page and runs the rooms, so players only need a browser.

| Way                         | For                                         | Needs                                 |
| --------------------------- | ------------------------------------------- | ------------------------------------- |
| [Host app](#host-app-lan)   | Playing together on one network (home, LAN) | One download on the host's computer   |
| [From source](#from-source) | Developers                                  | Node.js 22                            |
| [VPS](#vps-internet)        | Playing over the internet                   | A small server, a domain name, Docker |

## Host app (LAN)

One person downloads the host app and starts it. Everyone else opens the address it shows in their browser. The app is a single file with the whole game inside; there is nothing to install.

### Starting it

1. Download the file for your computer from the [latest release](https://github.com/NeonGrayX/Some-Assembly-Required/releases/latest):

   | Computer                     | File                                             |
   | ---------------------------- | ------------------------------------------------ |
   | Windows                      | `some-assembly-required-host-windows-x64.exe`    |
   | Mac with Apple silicon (M1+) | `some-assembly-required-host-macos-arm64.zip`    |
   | Mac with Intel               | `some-assembly-required-host-macos-x64.zip`      |
   | Linux                        | `some-assembly-required-host-linux-x64.tar.gz`   |
   | Linux on ARM (Raspberry Pi)  | `some-assembly-required-host-linux-arm64.tar.gz` |

2. Start it:
   - **Windows:** double-click the `.exe`. Windows may say "Windows protected your PC", because the app is not signed by a publisher Microsoft knows. Click **More info**, then **Run anyway**.
   - **Mac:** unzip it and double-click the file. macOS refuses the first time because the app is not notarised by Apple. Open **System Settings → Privacy & Security**, scroll down to the message about the app and click **Open Anyway**. Or in Terminal: `xattr -d com.apple.quarantine some-assembly-required-host-macos-arm64`, then run it.
   - **Linux:** `tar -xzf some-assembly-required-host-linux-x64.tar.gz` and run `./some-assembly-required-host-linux-x64`.
3. If the firewall asks, **allow access on private networks**. Without that, friends cannot connect.

A window opens with the addresses, and the game opens in your browser:

```
  Some Assembly Required is running.

  You play at:      https://localhost:7777
  Friends join at:  https://192.168.1.20:7777
```

Friends type the **Friends join at** address into their browser. Once you create a room, **Copy link** gives a link that joins it directly. Closing the window stops the game.

### The certificate warning

The host app uses HTTPS, which browsers require for microphone access (proximity voice chat). A real certificate needs a domain name, which a home computer does not have, so the app makes its own ("self-signed"). Browsers do not know it and warn the first time:

- **Chrome / Edge:** "Your connection is not private". Click **Advanced**, then **Proceed to 192.168.1.20 (unsafe)**.
- **Firefox:** "Warning: Potential Security Risk Ahead". Click **Advanced…**, then **Accept the Risk and Continue**.

Each browser asks once. The connection is still encrypted; the warning only means no certificate authority vouched for the address. The certificate is kept in `.some-assembly-required` in your home folder and reused, so the warning does not come back unless your computer's address changes.

Typing the address without `https://` works too: the app sends the browser to the HTTPS address.

### Options

Start it from a terminal to pass options (`--help` lists them):

| Option      | Effect                                                              |
| ----------- | ------------------------------------------------------------------- |
| `--port N`  | Use port N instead of 7777 (or set the `PORT` environment variable) |
| `--http`    | Plain HTTP: no certificate warning, but voice chat is listen-only   |
| `--no-open` | Do not open the browser                                             |

### When friends cannot connect

- **Same network?** Friends must be on the same Wi-Fi or LAN as the host, not a guest network.
- **Firewall:** the first start asks to allow the app; if it was denied, allow it in the firewall settings (Windows: "Allow an app through Windows Firewall", for private networks).
- **Wrong address:** the app lists other addresses too (VPNs, virtual machines); those are usually not the one to use.
- **Over the internet:** forwarding port 7777 on the router works but is not supported. Use a [VPS](#vps-internet) instead.

## From source

With Node.js 22:

```sh
npm install
npm run build
npm start           # http://localhost:7777 and the LAN addresses
npm start -- --https  # with a self-signed certificate, like the host app
```

To build the host app yourself (needs [Bun](https://bun.sh)):

```sh
npm run build:host                                  # for this computer
npm run build:host -w @sar/server -- --target all   # for every platform
```

The files land in `release/`. Pushing a tag like `v0.5.0` makes GitHub Actions build every platform and publish them as a release.

## VPS (internet)

Any small Linux server works: 1 vCPU and 1 GB of RAM runs several rooms. You need a domain name (or a subdomain) pointing at the server's IP address. [Caddy](https://caddyserver.com) sits in front of the game and gets a free HTTPS certificate from Let's Encrypt, so there is no warning to click through.

1. Install Docker on the server ([instructions](https://docs.docker.com/engine/install/)).
2. Point your domain at the server: an `A` record for `game.example.com` with the server's IP.
3. Open ports 80 and 443 in the server's firewall.
4. Get the code and start it:

   ```sh
   git clone https://github.com/NeonGrayX/Some-Assembly-Required.git
   cd Some-Assembly-Required/deploy/selfhost
   DOMAIN=game.example.com docker compose up -d --build
   ```

The game is at `https://game.example.com`, and rooms at `https://game.example.com/ABCD`. Logs: `docker compose logs -f game`. To update: `git pull`, then the same `docker compose up -d --build`.

The public copy at https://sar.arrow-lab.de is deployed differently, from tagged images through a Gitea registry; see [DEPLOYMENT.md](../DEPLOYMENT.md).

Building the image needs more memory than running the game. On a 1 GB server, add swap first (`fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`), or build the image elsewhere.

### Voice chat over the internet

Voice goes straight between players' browsers, not through the server. To find a way to each other they ask a public STUN server (Google's, by default), which works for most home connections. Some networks (strict company or university networks, some mobile carriers) block direct connections; for those, run the optional TURN relay, [coturn](https://github.com/coturn/coturn), next to the game:

1. Open more ports in the server's firewall: **3478** (UDP and TCP) and **49160–49200** (UDP).
2. Start everything with a secret and the `turn` profile:

   ```sh
   DOMAIN=game.example.com TURN_SECRET=$(openssl rand -hex 32) \
     docker compose --profile turn up -d --build
   ```

   Keep using the same secret on later starts (put it in a `.env` file next to `deploy/selfhost/docker-compose.yml`: `TURN_SECRET=...`).

The game hands each player a password for the relay that is valid for a day, signed with the secret; the secret itself stays on the server. Only voice that cannot go directly uses the relay, at about 30 kbit/s per voice.

Environment variables of the game server, for other setups:

| Variable          | Effect                                                                              |
| ----------------- | ----------------------------------------------------------------------------------- |
| `SAR_STUN`        | Comma-separated STUN URLs, or `none`. Default: `stun:stun.l.google.com:19302`       |
| `SAR_TURN_URL`    | Comma-separated TURN URLs, e.g. `turn:game.example.com:3478?transport=udp`          |
| `SAR_TURN_SECRET` | coturn's `static-auth-secret` (`use-auth-secret` mode); without it TURN is not used |

On a LAN none of this is needed: players find each other directly.

### Without Docker

Copy the Linux host app to the server and run it with `--http --no-open` behind any reverse proxy that forwards WebSockets (Caddy: `reverse_proxy localhost:7777`). As a systemd service:

```ini
# /etc/systemd/system/some-assembly-required.service
[Unit]
Description=Some Assembly Required
After=network.target

[Service]
ExecStart=/opt/some-assembly-required/some-assembly-required-host-linux-x64 --http --no-open
Environment=PORT=7777
DynamicUser=yes
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Then `systemctl enable --now some-assembly-required`.
