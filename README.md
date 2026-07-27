# Peared

Peared is a cross-platform collaborative code editor built as a Tauri
desktop app. It lets one person host an editing session, share a room URL, and
have other peers join from their own desktop clients. Everyone edits the same
document, and changes are synchronized through CRDT operations so concurrent
typing can be merged without a central document server owning the file.

Some internal package names, repository paths, and generated sidecar filenames
may still use older `peercode` identifiers.

## What It Is For

Peared is useful when several people need to work in the same text buffer
without moving the document into a hosted SaaS editor.

Common use cases include:

- Pair programming or small-group coding sessions.
- Teaching, labs, mentoring, and code walkthroughs.
- Interview-style collaborative editing.
- Quickly sharing a scratch file with peers on the same network.
- Remote collaboration through a temporary public tunnel.
- Editing ordinary text/code files while keeping the host in control of the
  session lifecycle and guest write permissions.

## Features

- Monaco-based code editor with light and dark themes.
- Host and guest collaboration modes.
- Shareable LAN and public room URLs.
- Local file open/save/save-as support.
- Recent files and document forking/reset support.
- Host-controlled guest write permissions.
- Peer roster and session status UI.
- CRDT-backed insert, delete, replace, snapshot, and garbage-collection flows.
- Go gateway sidecar for WebSocket room relay.
- Optional `cloudflared` sidecar for public tunnel URLs.

## Repository Layout

Peared is split into three independently buildable workspaces:

- `tauri-app/` - the desktop client. The frontend is React, TypeScript, Vite,
  and Monaco. The native backend is Rust/Tauri.
- `crdt-core/` - the Rust CRDT library used by the desktop backend. It owns the
  YATA-style document model, snapshots, delete sets, and binary wire framing.
- `gateway/` - the Go WebSocket relay launched by the host app as a sidecar.
  It creates rooms, accepts peers, forwards binary frames, and helps late
  joiners request a snapshot from the host.

The root `Makefile` is the preferred entry point for setup, development,
testing, formatting, and production builds.

## How It Works

At startup, the Tauri backend creates a single document actor. All document
changes go through that actor as typed operations, which keeps the CRDT state
serialized and avoids shared mutable document access.

When a user hosts a session, the backend:

1. Starts the local Go gateway sidecar.
2. Tries to start `cloudflared` to publish a temporary public tunnel.
3. Creates a room on the gateway.
4. Connects the host client to that room over WebSocket.
5. Emits the LAN/public invite URLs to the frontend.

Guests paste an invite URL into the app. The guest client connects directly to
the gateway or cloudflared URL, joins the room, receives the host's current
snapshot, and then applies live CRDT operations from the room.

The gateway does not own the document. It validates and relays protocol frames
between peers. The real document state lives in each desktop client, and the
CRDT layer resolves concurrent edits. This keeps the relay lightweight while
still allowing late joiners to catch up from a host-provided snapshot.

## Prerequisites

Install these tools before running the project:

- Rust and Cargo via `rustup`.
- Node.js LTS and npm.
- Go.
- `make`.
- Git and a Unix-like shell for the root build scripts.

The app uses Tauri 2, so each operating system also needs Tauri's native build
dependencies.

## Running On Linux

The included Linux dependency target is for Debian/Ubuntu-style systems:

```bash
make install-linux-deps
```

Install the common language toolchains if you do not already have them. Use
your preferred Node.js LTS installer or version manager; on Debian/Ubuntu the
system packages are enough to get started if they provide a recent Node/npm:

```bash
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
sudo apt-get install -y nodejs npm golang-go make
```

Then install frontend packages and run the app:

```bash
make install
make dev
```

`make dev` builds the gateway sidecar for your Rust host target, downloads the
matching `cloudflared` sidecar if it is missing, starts Vite, and launches the
Tauri desktop app.

For other Linux distributions, install the equivalent Tauri dependencies for
WebKitGTK 4.1, appindicator/ayatana-appindicator, librsvg, OpenSSL, and build
tools before running the same `make install` and `make dev` commands.

## Running On macOS

Install Apple's command-line developer tools:

```bash
xcode-select --install
```

Install the project toolchains. `rustup` is the recommended Rust installer, and
Homebrew is a convenient route for Node.js, Go, and GNU Make:

```bash
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
brew install node go make
```

Restart your terminal after installing Rust, then run:

```bash
make install
make dev
```

The development target automatically builds the Go gateway sidecar for your Mac
architecture and downloads the matching `cloudflared` binary when needed.

## Running On Windows

Use a Windows shell that can run the repository's Bash-based scripts, such as
Git Bash or MSYS2. You also need the Windows Tauri requirements:

- Microsoft C++ Build Tools with "Desktop development with C++" selected.
- Microsoft Edge WebView2 Runtime.
- Rust with the MSVC toolchain, for example `x86_64-pc-windows-msvc`.
- Node.js LTS, npm, Go, and `make`.

One practical setup is:

```powershell
winget install --id Rustlang.Rustup
winget install --id OpenJS.NodeJS.LTS
winget install --id GoLang.Go
winget install --id Git.Git
```

Install `make` through MSYS2, Chocolatey, or another Windows package manager.
After installing Visual Studio Build Tools and WebView2, open Git Bash or MSYS2
in the repository and run:

```bash
make install
make dev
```

The build scripts detect Windows through the shell environment and create
Windows-targeted sidecars such as `peercode-gateway-*-windows-msvc.exe` and
`cloudflared-*-windows-msvc.exe`.

## Production Build

Build the frontend, sidecars, and Rust release binary:

```bash
make prod-build
```

Run the release binary:

```bash
make prod-run
```

Or build and run in one step:

```bash
make prod
```

To create platform-specific Tauri bundles/installers, use:

```bash
cd tauri-app
npm run tauri build
```

Tauri bundles are produced under `tauri-app/src-tauri/target/release/bundle/`.

## Development Commands

```bash
make install              # install frontend npm dependencies
make dev                  # run the desktop app in development mode
make prod-build           # build production frontend, sidecars, and Rust app
make prod-run             # run the Rust release binary
make test-all             # run Rust, frontend, and Go tests
make format-all           # format Rust, Go, and frontend code
make lint-all             # run frontend lint, Rust clippy, and Go vet
make check                # format and lint everything
make clean                # remove generated artifacts
make reset-identity       # clear the persisted username for first-run testing
```

Individual test targets are also available:

```bash
make test-crdt
make test-tauri
make test-frontend
make test-go
```

## Working With Sessions

To collaborate:

1. Launch the app with `make dev` or a production build.
2. Choose a username on first run.
3. Open or type a document.
4. Use the collaboration panel to host a session.
5. Share the LAN URL with peers on the same network, or the public URL if the
   cloudflared tunnel started successfully.
6. Guests launch their own app, choose Join, and paste the shared URL.

The host can decide whether guests can edit by default and can change each
guest's write access from the peer panel during the session.

## Notes And Troubleshooting

- `make dev` may download `cloudflared` and install `sccache` the first time it
  runs.
- If you only need local-network collaboration, the app can continue even when
  the cloudflared tunnel is unavailable.
- On Linux, missing WebKitGTK or appindicator packages usually show up as Tauri
  build errors. Install the distro-specific Tauri dependencies and rerun
  `make dev`.
- On Windows, make sure Rust is using the MSVC toolchain:

  ```powershell
  rustup default stable-msvc
  ```

- If port `1420` is busy, pass a different Vite/Tauri development port:

  ```bash
  make dev PORT=1421
  ```

## External References

- Tauri 2 prerequisites: <https://v2.tauri.app/start/prerequisites/>
- Tauri bundling and distribution: <https://v2.tauri.app/distribute/>
