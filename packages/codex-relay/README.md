# Codex Relay CLI

Codex Relay runs a local bridge server for the Codex Relay mobile app. Keep Codex on your computer, then use your phone to pair with that local session, send prompts, watch streamed output, and respond to approval requests.

Codex Relay is an independent project. It is not affiliated with, endorsed by, or sponsored by OpenAI or the OpenAI Codex team.

## Requirements

- Node.js 22.14 or newer
- Codex CLI installed and signed in on the computer running the relay
- The Codex Relay mobile app on the same network, Tailscale network, or another route that can reach your computer

## Start the Relay

Run the server from the workspace you want Codex to use:

```sh
npx codex-relay@latest
```

The CLI prints a QR code, a mobile URL, and a `codex-relay://pair...` pairing payload. Scan the QR code from the mobile app. If the relay detects multiple possible network addresses, the QR includes them and the app automatically uses the first address it can reach. If scanning is not available, paste the full pairing payload into the app.

When the app shows an approval code, approve it on the computer:

```sh
npx codex-relay@latest approve XXXX-XXXX
```

After approval, the phone can list Codex threads, start new work, stream messages, and handle approval prompts from the local Codex runtime.

## Shared Terminal and Mobile Sessions

By default, Codex Relay starts a private app-server process. A terminal TUI that was started separately can resume the same saved thread, but it does not receive the relay process's live events.

On macOS, Linux, or WSL, opt in to Codex's shared app-server socket:

```sh
npx codex-relay@latest --shared-app-server
```

Then connect a new terminal TUI to the shared app-server socket:

```sh
codex resume --remote unix://
```

Pass a thread ID after `unix://` to open a specific thread. The relay prints the attach command at startup. Mobile and the connected terminal can then observe the same live sessions through one socket-backed app-server. An already-running standalone TUI cannot be converted in place; exit it and reconnect with `--remote`.

Shared mode requires a recent Codex CLI with Unix-socket app-server and `resume --remote` support. If those features are unavailable, update Codex or omit `--shared-app-server` to keep the existing private mode. Native Windows is not currently supported; use WSL or private mode there.

## Background Mode

To keep the relay running after the command returns:

```sh
npx codex-relay@latest --bg
```

Background mode writes runtime files under `.codex-relay/` in the current directory:

- `.codex-relay/server.log`
- `.codex-relay/server.pid`
- `.codex-relay/server-state.json`
- `.codex-relay/auth.db`

Print the current pairing QR again:

```sh
npx codex-relay@latest qr
```

Stop a background server with the printed process id:

```sh
kill -TERM <pid>
```

## Commands

```sh
npx codex-relay@latest
```

Start the relay in the foreground.

```sh
npx codex-relay@latest --bg
```

Start the relay in the background.

```sh
npx codex-relay@latest --shared-app-server
```

Start the relay through Codex's shared app-server socket.

```sh
npx codex-relay@latest qr
```

Print the latest pairing QR for an already running relay.

```sh
npx codex-relay@latest approve XXXX-XXXX
```

Approve a pending mobile pairing request.

```sh
npx codex-relay@latest --dangerously-auto-approve
```

Start the relay and automatically approve mobile pairing requests. Use this only for controlled review or demo environments.

## Configuration

The relay listens on `0.0.0.0:8787` by default. Configure it with environment variables:

| Variable                               | Purpose                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `PORT`                                 | Server port. Defaults to `8787`.                                                                   |
| `HOST`                                 | Listen host. Defaults to `0.0.0.0`.                                                                |
| `CODEX_RELAY_WORKSPACE_PATH`           | Workspace path Codex should use. Defaults to the directory where you run `npx codex-relay@latest`. |
| `CODEX_RELAY_AUTH_DB_PATH`             | Pairing and session database path. Defaults to `.codex-relay/auth.db`.                             |
| `CODEX_RELAY_APPROVAL_SECRET`          | Secret used by the local approve command. Usually generated automatically.                         |
| `CODEX_RELAY_DANGEROUSLY_AUTO_APPROVE` | Set to `1` to auto-approve mobile pairing requests. Prefer the CLI flag for local use.             |
| `CODEX_RELAY_APP_SERVER_MODE`          | Set to `socket` for shared terminal/mobile sessions. Defaults to `stdio`.                          |
| `CODEX_HOME`                           | Codex home directory, used when reading Codex session metadata.                                    |
| `CODEX_BIN`                            | Codex CLI executable path.                                                                         |

Examples:

```sh
PORT=8788 npx codex-relay@latest
```

```sh
CODEX_RELAY_WORKSPACE_PATH=/path/to/project npx codex-relay@latest
```

## Network Notes

The phone must be able to reach one of the URLs printed by the relay.

- On the same Wi-Fi network, the relay usually prints a local network address.
- On Tailscale, the relay prefers your Tailscale address when it can detect one.
- If several Wi-Fi, VPN, or virtual network addresses are available, the QR includes all detected candidates and the app tries them automatically.

## Troubleshooting

If `npx codex-relay@latest qr` cannot find a server, start one first:

```sh
npx codex-relay@latest
```

If the relay says another process is using the local pairing database, use the existing server:

```sh
npx codex-relay@latest qr
```

Or stop the background process shown by the CLI:

```sh
kill -TERM <pid>
```

If the mobile app cannot connect, confirm that the phone can reach the printed `Mobile:` URL and that the chosen port is not blocked by a firewall.

Connection checklist:

- Are the phone and computer on the same Wi-Fi or LAN?
- If keeping the same network is difficult, are both devices connected through Tailscale or another reachable private network?
- Can the phone open the exact `Mobile:` URL printed by the relay?
- Does the computer firewall allow inbound traffic on the relay port, usually `8787`?
