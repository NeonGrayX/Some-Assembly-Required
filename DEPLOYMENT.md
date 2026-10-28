# Deployment

https://sar.arrow-lab.de is deployed the way every arrow-lab.de app is, following the
playbook at [docs.arrow-lab.de](https://docs.arrow-lab.de/) (agents:
[llms.txt](https://docs.arrow-lab.de/llms.txt)). Push a `v*` tag, a Gitea runner builds the
image and pushes it to the Gitea registry, then asks the VPS over SSH to release it there; the
VPS swaps the container.

```
./deploy.sh  ->  tag v1.2.3 pushed to Gitea
runner:  docker build -> regctl push (gzip, 50 MB chunks) -> git.grombach-home.de/neongrayx/<repo>:v1.2.3
         ssh "release v1.2.3 sha256:<digest>" (the deploy key can do nothing else)
VPS:     some-assembly-required-deploy -> remote-release.sh (both installed by hand)
         docker pull <image>@<digest> -> pin tag in /srv/some-assembly-required/.env -> compose up --wait
browser -> Cloudflare (HTTPS) -> VPS :443 nginx -> 127.0.0.1:4380 -> container :8080
```

To run your own copy on any other server, see the [hosting guide](docs/06-hosting.md)
instead; it uses `deploy/selfhost/`.

## The six values

| Placeholder      | Value                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `<app>`          | `some-assembly-required`                                                                        |
| `<user>`         | `sar` (check `getent passwd sar` prints nothing on the VPS first)                               |
| `<port>`         | `4380`, also the default of `./serve.sh`                                                        |
| `<hostname>`     | `sar.arrow-lab.de`                                                                              |
| `<health-path>`  | `/build-info.json`                                                                              |
| `<owner>/<repo>` | `NeonGrayX/<repo>`, as the repository is named on Gitea. The workflow lowercases the image name |

## Files

| File                                       | What it does                                                                                                                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`                               | Builds the client and the host executable; the runtime stage holds only the executable, listens on 8080 as a non-root user, writes `/build-info.json` from the tag and health-checks it                    |
| `deploy/compose.yaml`                      | Installed on the VPS by hand, runs there. Image and tag come from `.env`; the port is published on loopback only; read-only filesystem                                                                     |
| `deploy/remote-release.sh`                 | Installed on the VPS by hand. Pulls the tag (by the digest the workflow pushed), pins it in `.env`, recreates the container, waits for the health check, and puts the previous tag back if it never passes |
| `deploy/nginx/some-assembly-required.conf` | The host's nginx site: TLS from the shared origin certificate, the `/ws` WebSocket, and CORS on `/build-info.json` for the arrow-lab.de landing page                                                       |
| `deploy/some-assembly-required-deploy`     | The deploy key's forced command, installed by hand in `/usr/local/sbin/`: takes only `release <tag> <sha256:digest>` and runs the installed `remote-release.sh` with the image fixed in it                 |
| `.gitea/workflows/deploy.yml`              | Runs on a `v*` tag: build, push, record the image digest, one SSH call `release <tag> <digest>`; uploads nothing                                                                                           |
| `deploy.sh`                                | Suggests the next version, then creates and pushes the tag                                                                                                                                                 |
| `serve.sh`                                 | Local development on port 4380                                                                                                                                                                             |

## Per-app setup (once, needs sudo)

The account-level Gitea setup (registry tokens, deploy key, `REGISTRY_USER`,
`REGISTRY_TOKEN`, `DEPLOY_HOST`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`) is shared with
the other apps; see Part 2 of the playbook.

1. **Gitea:** the tag must reach the Gitea copy of this repository, since that is where the
   workflow runs. Enable Actions on it, and add the repo secret `DEPLOY_USER` = `sar` (the
   only per-repo deploy secret; the wrapper knows the path, so a secret with the deploy path
   is no longer read and can be deleted).
2. **VPS: deploy user**

   ```bash
   sudo useradd --system --create-home --home-dir /srv/some-assembly-required --shell /bin/bash sar
   sudo usermod -aG docker sar
   sudo usermod -p '*' sar
   sudo install -d -m 755 -o root -g root /srv/some-assembly-required/.ssh
   echo 'restrict,command="/usr/local/sbin/some-assembly-required-deploy",from="<runner address>" <deploy-key-pub>' \
     | sudo tee -a /srv/some-assembly-required/.ssh/authorized_keys
   sudo chown root:root /srv/some-assembly-required/.ssh /srv/some-assembly-required/.ssh/authorized_keys
   sudo chmod 755 /srv/some-assembly-required/.ssh && sudo chmod 644 /srv/some-assembly-required/.ssh/authorized_keys
   sudo -iu sar docker login git.grombach-home.de -u NeonGrayX   # the read-only token
   ```

   Root owns `.ssh` and `authorized_keys`, so the account cannot add keys for itself. For
   `<runner address>` and the deploy files, see "Installing the deploy files and restricting
   the key" below.

3. **VPS: nginx site**

   ```bash
   sudo cp deploy/nginx/some-assembly-required.conf /etc/nginx/sites-available/some-assembly-required
   sudo ln -s /etc/nginx/sites-available/some-assembly-required /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

4. **Cloudflare:** an `A` record for `sar.arrow-lab.de` at the VPS, proxied, SSL mode Full,
   Always Use HTTPS on.
5. **Port registry:** add `4380 | some-assembly-required` to the table in Part 0 of the
   playbook (the Arrow-Lab repository).

## Installing the deploy files and restricting the key

A deploy uploads nothing: the deploy key's forced command `some-assembly-required-deploy`
runs the `remote-release.sh` installed in `/srv/some-assembly-required`. So
`deploy/compose.yaml`, `deploy/remote-release.sh` and the wrapper are installed on the VPS
by hand: before the first tag after this change, and again before any tag whose release
changes them (`git diff <deployed-tag> <new-tag> --stat -- deploy/`). From a checkout of the
tag, as your admin account:

```bash
# on your machine
ssh <admin>@212.227.184.160 'mkdir -p /tmp/some-assembly-required-deploy'
scp deploy/compose.yaml deploy/remote-release.sh deploy/some-assembly-required-deploy \
  <admin>@212.227.184.160:/tmp/some-assembly-required-deploy/
# on the VPS
cd /tmp/some-assembly-required-deploy \
  && sudo install -o sar -g sar -m 755 remote-release.sh /srv/some-assembly-required/ \
  && sudo install -o sar -g sar -m 644 compose.yaml /srv/some-assembly-required/ \
  && sudo install -o root -g root -m 755 some-assembly-required-deploy /usr/local/sbin/some-assembly-required-deploy \
  && cd / && rm -rf /tmp/some-assembly-required-deploy
```

The deploy key's line in `/srv/some-assembly-required/.ssh/authorized_keys` is one line, with
the file root-owned 644 and the `.ssh` directory root-owned 755 (step 2 above):

```
restrict,command="/usr/local/sbin/some-assembly-required-deploy",from="<runner address>" ssh-ed25519 AAAA… gitea-deploy
```

```bash
sudo chown root:root /srv/some-assembly-required/.ssh /srv/some-assembly-required/.ssh/authorized_keys
sudo chmod 755 /srv/some-assembly-required/.ssh && sudo chmod 644 /srv/some-assembly-required/.ssh/authorized_keys
```

`<runner address>` is the address the VPS sees the runner connect from: the home
connection's public address, not 10.10.11.216, unless there is a VPN. The sshd log shows it:
`sudo journalctl -u ssh | grep 'Accepted publickey for sar'`. If that address is dynamic, a
`from=` breaks the deploy at the next reconnect.

The order, once: merge the change (untagged); install the files and the wrapper and restrict
the key; only then push a tag. Until the key is restricted, the workflow's `release …` is an
unknown shell command and the deploy fails.

The check, from the runner host (the TrueNAS, 10.10.11.216):
`ssh -i <deploy key> sar@212.227.184.160 id` prints
`deploy: usage: release <tag> <sha256:digest>` and gives no shell; from any other address the
key is refused. Anything by hand on the VPS goes through your admin account
(`sudo -iu sar …`), as below.

## Voice chat relay (optional)

Voice goes directly between browsers, using a public STUN server. For players on networks
that block that, coturn can run on the VPS next to the game. It is off by default. To turn it
on:

1. Open **3478** (UDP and TCP) and **49160–49200** (UDP) in the VPS firewall.
2. Add these lines to `/srv/some-assembly-required/.env`. The release script keeps them
   across deploys. The TURN address must be the raw IP: Cloudflare's proxy does not carry
   UDP.

   ```bash
   COMPOSE_PROFILES=turn
   SAR_TURN_SECRET=<output of: openssl rand -hex 32>
   SAR_TURN_URL=turn:<vps-ip>:3478?transport=udp,turn:<vps-ip>:3478?transport=tcp
   ```

3. Apply it: `sudo -iu sar bash /srv/some-assembly-required/remote-release.sh <the live tag>`.

## Shared builds

The community page (**Shared builds** on the main menu) is the one thing the game writes to disk.
It keeps posts in the `data` volume, mounted at `/data` in the otherwise read-only container, so
they survive deploys and rollbacks. Back it up with:

```bash
sudo -iu sar docker run --rm -v some-assembly-required_data:/data -v /srv/some-assembly-required:/backup \
  debian tar czf /backup/shared-builds.tgz -C /data .
```

To take down any post or comment, add an admin key to `/srv/some-assembly-required/.env`, apply
it with `remote-release.sh` as for the voice relay, then on the site run
`localStorage.setItem('sar.forum.key', '<the key>')` in the browser console. Every post and
comment shows a delete button for that browser.

```bash
SAR_FORUM_ADMIN_KEY=<output of: openssl rand -hex 24>
```

## Release

```bash
./deploy.sh
```

Then watch the run under the repository's Actions on Gitea, and verify:

```bash
curl -s https://sar.arrow-lab.de/build-info.json                 # the new tag and commit
curl -sI https://sar.arrow-lab.de/build-info.json | grep -i '^access-control-allow-origin'
```

## Rollback

On the VPS, from your admin account as the deploy user (the deploy key opens no shell):

```bash
sudo -iu sar bash /srv/some-assembly-required/remote-release.sh v1.0.0
```

Any pushed tag works; the last five are kept locally. A release that never becomes healthy is
rolled back automatically.

For anything that fails, see Part 7 (troubleshooting) of the playbook.
