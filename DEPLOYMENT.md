# Deployment

https://sar.arrow-lab.de is deployed the way every arrow-lab.de app is, following the
playbook at [docs.arrow-lab.de](https://docs.arrow-lab.de/) (agents:
[llms.txt](https://docs.arrow-lab.de/llms.txt)). Push a `v*` tag, a Gitea runner builds the
image and pushes it to the Gitea registry, then SSHes into the VPS and swaps the container.

```
./deploy.sh  ->  tag v1.2.3 pushed to Gitea
runner:  docker build -> docker push git.grombach-home.de/neongrayx/<repo>:v1.2.3
         ssh (tar of deploy/compose.yaml + deploy/remote-release.sh, then run it)
VPS:     docker pull -> pin tag in /srv/some-assembly-required/.env -> compose up --wait
browser -> Cloudflare (HTTPS) -> VPS :443 nginx -> 127.0.0.1:4290 -> container :8080
```

To run your own copy on any other server, see the [hosting guide](docs/06-hosting.md)
instead; it uses `deploy/selfhost/`.

## The six values

| Placeholder      | Value                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `<app>`          | `some-assembly-required`                                                                        |
| `<user>`         | `sar` (check `getent passwd sar` prints nothing on the VPS first)                               |
| `<port>`         | `4290`, also the default of `./serve.sh`                                                        |
| `<hostname>`     | `sar.arrow-lab.de`                                                                              |
| `<health-path>`  | `/build-info.json`                                                                              |
| `<owner>/<repo>` | `NeonGrayX/<repo>`, as the repository is named on Gitea. The workflow lowercases the image name |

## Files

| File                                       | What it does                                                                                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`                               | Builds the client and the host executable; the runtime stage holds only the executable, listens on 8080 as a non-root user, writes `/build-info.json` from the tag and health-checks it |
| `deploy/compose.yaml`                      | Runs on the VPS. Image and tag come from `.env`; the port is published on loopback only; read-only filesystem                                                                           |
| `deploy/remote-release.sh`                 | Pulls the tag, pins it in `.env`, recreates the container, waits for the health check, and puts the previous tag back if it never passes                                                |
| `deploy/nginx/some-assembly-required.conf` | The host's nginx site: TLS from the shared origin certificate, the `/ws` WebSocket, and CORS on `/build-info.json` for the arrow-lab.de landing page                                    |
| `.gitea/workflows/deploy.yml`              | Runs on a `v*` tag: build, push, upload the two deploy files, run the release script                                                                                                    |
| `deploy.sh`                                | Suggests the next version, then creates and pushes the tag                                                                                                                              |
| `serve.sh`                                 | Local development on port 4290                                                                                                                                                          |

## Per-app setup (once, needs sudo)

The account-level Gitea setup (registry tokens, deploy key, `REGISTRY_USER`,
`REGISTRY_TOKEN`, `DEPLOY_HOST`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`) is shared with
the other apps; see Part 2 of the playbook.

1. **Gitea:** the tag must reach the Gitea copy of this repository, since that is where the
   workflow runs. Enable Actions on it, and add the repo secrets `DEPLOY_USER` = `sar` and
   `DEPLOY_PATH` = `/srv/some-assembly-required`.
2. **VPS: deploy user**

   ```bash
   sudo useradd --system --create-home --home-dir /srv/some-assembly-required --shell /bin/bash sar
   sudo usermod -aG docker sar
   sudo usermod -p '*' sar
   sudo install -d -m 700 -o sar -g sar /srv/some-assembly-required/.ssh
   echo 'restrict <deploy-key-pub>' | sudo tee -a /srv/some-assembly-required/.ssh/authorized_keys
   sudo chown sar:sar /srv/some-assembly-required/.ssh/authorized_keys
   sudo chmod 600 /srv/some-assembly-required/.ssh/authorized_keys
   sudo -iu sar docker login git.grombach-home.de -u NeonGrayX   # the read-only token
   ```

3. **VPS: nginx site**

   ```bash
   sudo cp deploy/nginx/some-assembly-required.conf /etc/nginx/sites-available/some-assembly-required
   sudo ln -s /etc/nginx/sites-available/some-assembly-required /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

4. **Cloudflare:** an `A` record for `sar.arrow-lab.de` at the VPS, proxied, SSL mode Full,
   Always Use HTTPS on.
5. **Port registry:** add `4290 | some-assembly-required` to the table in Part 0 of the
   playbook (the theme-gallery repository).

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

3. Apply it: `bash /srv/some-assembly-required/remote-release.sh <the live tag>`.

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

On the VPS, as the deploy user:

```bash
sudo -iu sar
bash /srv/some-assembly-required/remote-release.sh v1.0.0
```

Any pushed tag works; the last five are kept locally. A release that never becomes healthy is
rolled back automatically.

For anything that fails, see Part 7 (troubleshooting) of the playbook.
