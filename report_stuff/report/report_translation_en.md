# Peared — Bachelor's Project Report (Full English Translation)

> This is a faithful English rendering of the Georgian LaTeX report in
> `report_stuff/report/`. Use it to check what each Georgian sentence was
> meant to say and to catch any terms you would translate differently.
> Section order and paragraph boundaries match the LaTeX sources.

---

## Abstract

Working together on the same text file is part of everyday life today,
whether it is pair programming, a seminar, a lab session or a technical
interview. Despite this, most existing tools rest on two assumptions: the
document must be uploaded to some company's central server, and every
participant must have a stable internet connection. In our experience, both
assumptions frequently break down in a university classroom: when the
internet cuts out, screen sharing stops, and the whole seminar ends up
crowding around a single laptop.

To solve this problem we built Peared, a cross-platform desktop application
for collaborative text editing that works both on a local network (LAN)
without internet access and over the global network. The session initiator
(the host) runs a lightweight relay server on their own machine, managed
automatically by the application, while the other participants simply join
via a link. The document never leaves the participants' computers: no
central service, no accounts and no subscriptions are required.

Conflict-free merging of concurrent edits is guaranteed by a CRDT
(Conflict-free Replicated Data Type) algorithm, specifically the YATA
approach that underlies the Yjs library. Every client owns its own replica
of the document, and operations are constructed so that, regardless of the
order in which they are received, all participants converge to the same
text. The system consists of three independent components: a CRDT library
written in Rust, a desktop client built on Tauri (with a React/Monaco
frontend), and a WebSocket relay server written in Go. For global access
the application automatically opens a Cloudflare Tunnel, which lets remote
participants connect without port forwarding or any network configuration.

Special attention was paid to performance and memory efficiency: to speed
up position lookups we augmented the document with a B+ tree index, which
reduced key operations from linear to logarithmic time, and to reclaim the
tombstones left behind by deleted text we designed a host-centric garbage
collection scheme that takes advantage of a distinctive property of our
architecture — the host acting as the source of truth.

The result is a working product: an editor that runs on Linux, Windows and
macOS, with which several people can edit the same file simultaneously,
manage write permissions, open and save files, and control the full life
cycle of a collaboration session.

---

## Introduction

The choice of project topic began with a rather practical observation.
During our studies we repeatedly found ourselves in a situation where, in a
seminar or a lab session, several students needed to work on the same code
at the same time. The standard way out — screen sharing — often simply did
not work on the university network: the internet would drop, the video
stream would freeze, and in the end the whole group would gather around the
lecturer's laptop to participate in the seminar. Tools of the Google Docs
kind, apart from being awkward for editing code, require a stable internet
connection and a central server — that is, exactly what we often did not
have in the classroom.

From this came the question: is it possible to build a collaborative editor
that does not depend on a central service at all, and that works both on a
local network (even without internet) and with participants connected over
the internet? Our supervisor, Luka Absandze, helped us develop the topic in
this direction: at the initial stage of the project he suggested several
interesting ideas and directions, from which we made our final choice.

The problem the project addresses can be stated as follows: existing
solutions for real-time collaborative text editing almost always require
(1) storing the document on a third party's server, (2) a permanent
internet connection, and (3) often creating accounts and being tied to a
particular ecosystem. All three requirements are problematic when the
working file is confidential, the network is unstable, or we simply want to
collaborate within one room without extra infrastructure.

The goal of the project was to build a complete, cross-platform desktop
application that:

- lets one user (the host) start a session and the others join it simply
  via a link;
- resolves concurrent editing without conflicts using a CRDT algorithm, so
  that all participants are guaranteed to see the same text;
- works both on a local network without internet and globally, via
  Cloudflare Tunnel, without any network configuration;
- gives the host full control of the session: managing guests' write
  permissions, starting/ending the session, and saving files locally.

We deliberately bounded the scope of the project: a session works on one
document; the document is plain text (code, configuration, notes) and not
formatted rich text; and a session is ephemeral — it is born and dies with
the host's application, although the work can be saved to a file at any
moment.

Methodologically, we split the system into three independently buildable
components: a CRDT library in Rust (`crdt-core`), a desktop client on the
Tauri framework (a Rust backend + a React/TypeScript frontend with the
Monaco editor), and a lightweight relay server in Go (`gateway`).
Development took place on GitHub: functionality was broken down into
issues, every change was merged via a pull request with code review, and CI
automatically ran formatting, linter, test, and security checks on all
three components.

The potential users are, first of all, students and lecturers — seminars,
lab sessions, group projects — although the same scenarios extend naturally
to pair programming, technical interviews, mentoring, and any situation
where several people need to edit one text simultaneously without handing
the data over to a central service.

Finally, the project has several expected limitations. A session is tied to
the host's computer: if the host goes offline, the session ends (though
every participant keeps a full copy of the document). Global access depends
on the availability of Cloudflare's free trycloudflare.com service; if it
is unavailable, the application continues working in local-network mode.
Also, because the traces of deleted text must be preserved for some time
for the correctness of the CRDT algorithm, memory usage depends on the
editing history — to mitigate this problem we designed a special garbage
collection mechanism, which we describe in detail in later chapters.

---

## Main Body

### Domain research related to the project topic

#### Collaborative editing and existing technologies

Real-time collaborative editing is a feature familiar to everyone today —
Google Docs made it a mass-market product, and for programmers there are
specialized tools: VS Code Live Share, JetBrains Code With Me, the
browser-based Replit and CodeSandbox, the open-source Etherpad, and others.
If we look closely at these tools, almost all of them follow the same
architectural pattern: there is a central server that owns the "canonical"
version of the document, and clients connect to that server. This approach
works well for a commercial SaaS product, but it brings dependencies with
it: permanent internet, third-party infrastructure, and moving the
document's data onto someone else's server.

From a technical point of view, two major schools answer the problem of
merging concurrent edits. The first, and historically earlier, is
**Operational Transformation (OT)** [Ellis & Gibbs 1989]: when two users
edit the text simultaneously, their operations (insert/delete with
positions) are "transformed" against each other so that we get the same
result even after executing them in different orders. OT is used in Google
Docs and Etherpad, but it has two well-known weaknesses: writing the
transformation functions correctly is very hard (more than one published
algorithm in this area later turned out to be wrong), and practical OT
systems almost always need a central server that assigns a single total
order to the operations.

The second approach is **CRDT — Conflict-free Replicated Data Type**
[Shapiro et al. 2011]. Here the idea is inverted: instead of fitting
operations to one another, the data structure itself is built so that
operations are commutative — that is, the result does not change with the
order of arrival. Every inserted character (or block of characters) gets a
globally unique identifier, and "where" text landed is described precisely
by those identifiers rather than by positions. The price for this is that
traces of deleted elements — so-called tombstones — must be kept for some
time; in exchange, a central coordinator is no longer needed at all: CRDTs
fit peer-to-peer and decentralized architectures naturally.

Many CRDT algorithms for text exist (WOOT, RGA, Logoot/LSEQ and others),
but the most successful in practice turned out to be **YATA — Yet Another
Transformation Approach** [Nicolaescu et al. 2016], which is the foundation
of the Yjs library. Yjs is today probably the most widely used open-source
collaborative editing engine, and precisely its practical success convinced
us that YATA was the right choice. In YATA every insertion remembers not
only its own identifier but also its "origin" neighbors (origin left/right)
— between which two elements it was born. When two participants insert text
at the same place simultaneously, the conflict is resolved by a
deterministic rule, and, importantly, words typed in parallel do not get
mixed into each other — the algorithm rules out the so-called interleaving
problem that afflicts some other approaches (for instance Logoot, which is
based on positional identifiers).

#### Why CRDT and why YATA

Our choice rested on three arguments. First, the main motivation of the
project was precisely to remove the dependence on a central service — OT's
server-centric nature directly contradicts this goal, whereas CRDT lets us
turn the server-side component into a simple forwarding "pipe" that does
not understand the document's contents at all. Second, the correctness
argument for a CRDT is local: it is enough to prove that the integration of
operations is commutative, and any network delay or reordering becomes
safe. Third, YATA has a design tested for years in a real product (Yjs),
from which we took many practical techniques: operating on blocks (runs of
several characters) instead of single characters, splitting a block on
mid-block insertion, storing deletions compactly as ranges, and so on. We
also drew additional inspiration from the diamond-types project, which
showed us that a positional index can significantly speed up a CRDT
document.

#### Why Cloudflare Tunnel

One inconvenient detail of the decentralized approach is that the host's
computer is not directly reachable from the internet: in home and
university networks, NAT and firewalls block inbound connections, and
manually opening ports (port forwarding) is an impossible demand for an
ordinary user. We solve this with Cloudflare Tunnel: the host application
runs the `cloudflared` program, which establishes an *outbound* connection
from the host toward Cloudflare's network and in exchange receives a
temporary public address (`*.trycloudflare.com`). An outbound connection
passes through NAT without problems, the user has to configure nothing, the
connection is protected by TLS, and the service is free. If the tunnel
fails to open, the application does not fall over — the session continues
with the local-network link.

#### The nature of the project, requirements, and commercialization

The project offers an alternative solution to an existing challenge in the
field — the dependence on centralized infrastructure. We did not invent a
new consensus algorithm; the novelty is in the combination: a local-first
desktop application that manages the session infrastructure (the relay
server and the public tunnel) on the user's own computer, automatically and
invisibly. Worth separate mention is our garbage collection system, which,
to our knowledge, uses a host-authoritative scheme different from the
approaches common in CRDT implementations (details in the optimization
chapter).

In terms of technical requirements the project is entirely software-based
and needs no hardware component: for development, the Rust, Go and Node.js
toolchains suffice, and for the end user, an ordinary computer with Linux,
Windows or macOS. As for commercialization, the project has several
realistic directions: (1) educational licensing — a tool that works in
classrooms with weak infrastructure is a natural product for schools and
universities; (2) a self-hosting-oriented enterprise edition for companies
whose internal policies forbid sending code to third-party services; (3)
the niche market of technical interviews, where the ephemerality of the
session and the locality of the data are advantages. That said, it must be
honestly stated that the primary goal of the project was educational, and
commercialization remains a future prospect.

### Technical side of the project

#### Overall system architecture

The Peared system consists of three runtime components:

1. **The desktop application** (`tauri-app`) — every participant runs one.
   This is where the document's CRDT replica, the Monaco editor, and all of
   the session-management logic live.
2. **The gateway** (`gateway`) — a WebSocket relay server written in Go,
   which *only the host's* application launches as a helper (sidecar)
   process when a session starts and kills when the session ends. It keeps
   almost no state — it simply forwards bytes between the members of a
   room.
3. **The cloudflared tunnel** — an optional helper process that publishes
   the host's gateway at a temporary public `*.trycloudflare.com` address,
   so that guests outside the local network can also connect.

The network topology follows the hub-and-spoke model: every participant
(even the host's own client) connects to the same gateway over WebSocket,
and the gateway forwards every received frame to the others. This gives us
the properties of a peer-to-peer system (the document exists only with the
participants; no central service exists) without the complexity of a full
mesh network — each client needs only one connection.

*(Diagram 1: Overall system architecture — the gateway running on the
host's machine and the clients connected to it.)*

**Session life cycle.** When a user chooses to start (host) a session, the
application performs the following steps in order: (1) it launches the
gateway process and learns which port it started on from a JSON message
printed to standard output (stdout); (2) on a best-effort basis it launches
`cloudflared` and waits for the public link; (3) with an HTTP request it
creates a "room" on the gateway and receives its identifier; (4) it
connects to the room itself over WebSocket and immediately sends a snapshot
of the document, so that guests who arrive later can quickly "catch up"
with the current state. After that the host receives two links — one for
the local network and one public — and shares either with a single click.
On the guest's side the same process is much simpler: paste the link,
WebSocket connection, receive the snapshot, and start working.

Permissions within a session are asymmetric: the host always has full
rights, while guests, by default, join in read-only mode (when starting the
session the host may choose for guests to receive write permission
automatically). While the session is running, the host grants or revokes
write permission for each guest individually — we discuss the technical
details of this mechanism below.

#### The Tauri framework, conceptually

The desktop application is built on the Tauri 2 framework. Tauri's idea is
simple: the application's interface is written with ordinary web
technologies (in our case React + TypeScript) and runs in the operating
system's built-in webview, while the "native" logic — file access,
networking, process management — is written in Rust and lives in the core
of a separate process. Communication between the two worlds happens via
IPC: the frontend calls the backend's "commands", and the backend sends the
frontend "events". Compared to Electron, Tauri's binaries are much smaller
(it does not bundle Chromium), and having Rust as the backend language was
decisive for us — the CRDT library is written precisely in Rust and
embedded directly into the application without any glue.

Another Tauri feature we use actively is *sidecar* binaries: the gateway
and `cloudflared` ship together with the application, and the application
fully controls their life cycle — the user does not even notice that a
separate server has started on their computer.

#### The frontend and Monaco as the skeleton

As the core of the interface we chose the Monaco Editor — the same editor
component that VS Code is built on. This choice gives us a lot "for free":
syntax highlighting, multi-cursor editing, undo/redo, search, and familiar
keyboard shortcuts. Our frontend is drawn around Monaco: React manages the
application "shell" (the side panel, session status, participant list, file
menu), while Monaco manages the text itself. Local changes flow from Monaco
to the backend via IPC commands, and remote participants' changes come back
from the backend via events and are inserted into the editor in a way that
does not rebroadcast them. We describe the details of this bidirectional
flow in the frontend chapter.

*(Diagram 2: The client's (Tauri application's) layers and subsystems.)*

#### The CRDT library (crdt-core)

The heart of the system is `crdt-core`, an independent library written in
Rust that implements a YATA-style text CRDT. It knows nothing about either
the network or the interface: its responsibility is the document state, the
integration of operations, and the binary (wire) format.

**Blocks and the linked list.** The document is represented as a doubly
linked list of *blocks*. A block is a run of characters typed consecutively
by one author, and it has:

- a unique identifier `BlockId = (client_id, clock)` — the author's number
  and their local counter (an analogue of a Lamport clock). A long block
  covers a whole range of identifiers: a block of *n* characters spans from
  `(c, k)` to `(c, k+n-1)`;
- origin pointers `origin_left` and `origin_right` — between which two
  elements the block was born at the moment of insertion;
- its content and a deletion flag (`deleted`).

Operating on blocks instead of storing the whole text character by
character (an approach we took from Yjs) sharply reduces memory and network
traffic: during ordinary typing, the next character is glued onto the
previous block and remains a single operation. When a file is opened, the
text is cut into 64-character blocks (`from_text_chunked`), which is a good
middle ground between "many small objects" and "one gigantic string".

**Block splitting.** What happens when someone inserts text in the
*middle* of a block, or deletes from the middle? The block splits in two:
the left half keeps the original identifier, and the right half receives
the continuation of the same range (`(c, k+offset)`). Because identifiers
are ranges, splitting is "free" — no existing reference breaks: any
`BlockId` still uniquely finds its block; it may simply now land in the
middle of a block. This invariant (so-called decomposition invariance) is
critical: a remote participant's operation may refer to a block that on our
side has already been split into three pieces.

**Integration and conflict resolution.** When a remote block is received,
the algorithm must find its exact place in the list. If there is no
conflict, the block simply settles between its origins. If two participants
inserted text at the same place simultaneously (both blocks have the same
origins), YATA establishes order by a deterministic rule — the conflicting
blocks are arranged so that (1) every replica arrives at the same order and
(2) one author's consecutive runs stay together and do not interleave.
Rust's type system helped us a lot here: the integration logic sits in
strictly separated modules (`document/integrate.rs`) and every odd case is
covered by its own test.

**Deletion, the DeleteSet, and the state vector.** Deletion works
differently in a CRDT: a block cannot be physically removed, because
another participant's not-yet-arrived operation may rely on it as an
origin. So deletion is only *marking*: the block stays in the list as a
"tombstone" and is no longer visible in the text. Deletions are stored
compactly in the `DeleteSet` structure — for each client, a list of deleted
`clock` ranges. This representation is doubly useful: it is small to
transmit over the network (a thousand consecutively deleted characters are
one range) and it is idempotent — receiving the same DeleteSet twice breaks
nothing.

The document's "where am I" state is described by the *state vector*: for
each client, the maximum `clock` of the operations seen from them. By
comparing two replicas' vectors one can see exactly which operations either
side is missing. We use the vectors for two things: synchronizing a guest
who arrives late, and the garbage collector (see the optimization chapter),
where it determines which deletions everyone is guaranteed to have seen.

**Snapshots and the wire protocol.** The document's full state — blocks,
DeleteSet, state vector — serializes into a `Snapshot` structure (in
binary, with the `bitcode` library). On the network, every frame has a
one-byte prefix that determines its type: operation (`0x00`), snapshot
(`0x01`), control frame (`0x02`), garbage-collector commit (`0x04`),
membership change (`0x05`), state-vector report (`0x06`), permission change
(`0x07`), and peer information (`0x08`). Because this format is read by two
languages (Rust in the clients, Go in the gateway), both sides have
so-called protocol drift tests — byte-for-byte pinned samples that break
immediately if someone changes the format unilaterally.

**The positional B+ index.** CRDT operations work on identifiers, but the
editor works on character positions ("insert at position 42"). Converting
between these two worlds by walking the linked list is an O(n) operation,
and traversing the whole document on every keystroke slowed the system
noticeably on large files. To solve this we attached an *augmented B+
tree* to the document: the blocks lie in the tree's leaves in document
order, and every internal node stores the total visible length of its
subtree (`visible_len`; a deleted block's visible length is zero). When
searching by position, descending the tree we subtract the left children's
sums at each level — O(log n); conversely, when computing a block's
position we go up from the leaf and accumulate the left siblings' sums.
Insertion, splitting and deletion are mirrored into the tree, and the delta
"bubbles" up to the root. The design inspiration came from the
diamond-types project.

An important detail: the tree is a *secondary, derived* structure — the
source of truth always remains the linked list. To make sure they never
drift apart, in debug mode an "oracle" runs after every mutation: a
function that walks the whole list by hand and checks that the tree's
answers match exactly — on any mismatch the program immediately panics.
This caught more than one subtle bug during development, while in release
builds the check does not compile at all and costs nothing. The tree's
branching factors are also deliberately different: small in debug (4), so
the splitting logic gets exercised often in tests, and wide in release
(64/32) — fewer levels and better cache locality.

*(Diagram 3: The CRDT document structure — the linked list of blocks below,
with the tombstone in red, and the positional B+ index built on top, with
visible-character sums in the nodes.)*

The dynamics of insertion and deletion are shown by two frame-by-frame
diagrams (Diagrams 4 and 5): the first shows how a new block lands
simultaneously in the list and in a tree leaf and how the visible-length
delta "bubbles" up to the root; the second shows how a block becomes a
tombstone and how the sums are corrected along the whole branch.

*(Diagram 4: Step-by-step block insertion — step 1: initial state; step 2:
the new block lands in the list and in the leaf; step 3: the delta (+2)
bubbles to the root.)*

*(Diagram 5: Step-by-step block deletion — step 1: the block is marked
deleted (tombstone); step 2: the delta (−2) bubbles to the root.)*

#### The Tauri application (the desktop client)

The Tauri application's Rust backend is where all the subsystems meet (see
Diagram 2): the document actor, the WebSocket connection, the session state
machine, process management, the garbage collector, file saving, the
permission system, and metrics.

**The document actor.** The most important design decision is how access
to the document is organized. The naive approach would be
`Mutex<Document>` — a shared object behind a lock that every thread fights
over. Instead we used the *actor* pattern: the document is owned by a
single tokio task (`DocActor`) that reads a message channel (`mpsc`) in an
infinite loop. Any action — a local insertion, a remote operation, taking a
snapshot, reading the text to write to a file — is sent into the channel as
a `DocOp` message, and the reply comes back on a one-shot channel. This
approach has several advantages: locks and the risk of deadlock disappear;
operations are naturally serialized (which the CRDT requires anyway); and
adding a new operation only means writing a new `DocOp` variant and its
handler. Rust's ownership system works in our favor here — a reference to
the document simply cannot "leak" outside the actor.

**IPC — from backend to frontend.** When the actor integrates a remote
change, it sends the frontend a Tauri event: `crdt://remote-change`
(position and content), `crdt://snapshot-applied` (the document changed
wholesale, e.g. when joining a session) or `crdt://document-reset`. In the
opposite direction the frontend calls `#[tauri::command]` commands:
`insert`, `delete`, `replace`, file operations, session management and so
on. An interesting nuance: messages between the webview and the backend are
asynchronous, so the user may click at a position at a moment when someone
else's change has already arrived in the backend (but has not yet been
reflected in the editor). Because of this, every local command carries a
`base_seq` — the number of the last remote change the editor had seen when
the command was sent. The actor keeps a small log of recent remote
operations and transforms the incoming position against them — a small,
OT-flavored bridge between the webview and the backend replica that
eliminated hard-to-catch synchronization bugs.

**Process management.** When a session starts, the `process_coordinator`
launches the gateway sidecar, reads the `{"port": N}` message from its
standard output, then (best-effort) launches `cloudflared` and captures the
issued public link from its logs. For authorization with the gateway the
application generates a random bearer token per session and passes it to
the process via an environment variable — this token is used to create the
room and end the session (the WebSocket connection itself does not require
the token, because guests do not and should not know it). Separate
attention went to process life cycles: when the window closes, the
application synchronously deletes the room and kills both sidecars, so no
"orphaned" server keeps running in the background on the user's machine.

**Asynchrony and WebSocket management.** The whole backend runs on tokio's
asynchronous runtime. A WebSocket connection is served by three independent
tokio tasks: `write_loop` (the queue of outgoing frames), `receive_loop`
(receiving incoming bytes and recognizing their type), and `process_loop`
(handing received operations to the document actor and other subsystems).
This separation of tasks gives us two things: a slow network can never
block document processing, and on disconnect it is enough to cancel all
three tasks and clean the state in a single place (the disconnect handler).

**The session state machine.** The session state is a strict finite state
machine (FSM): `Undecided → Starting → Host/Guest → Undecided`. Every
transition is validated, and an illegal transition returns an error.
Starting a session is a multi-step asynchronous process (launching
processes, creating the room, the WebSocket connection) and can fail at any
step — therefore the `Starting` state is protected by an RAII "guard": if
a function ends with an error and the guard is destroyed without the
session having been completed, the state automatically returns to
`Undecided`. This ruled out "stuck" intermediate states without writing
manual rollbacks.

**Permission management.** The authority for write permissions is the
gateway: it treats the first joiner as the host, keeps a write flag for
every client, and simply drops operations from a read-only client (even if
a modified version of the client code tried to bypass the rule, the gateway
would not propagate its operations). The host requests a permission change
with a special frame (`0x07`); the gateway verifies that the request really
comes from the host, flips the flag, and sends the same frame to everyone
as the authoritative echo. On the client side, the `roster` module
maintains the participant list (names, host status, permissions), while the
guest's own permission is stored inside `AppRole::Guest` and gates the
`insert`/`delete`/`replace` commands like a checkpoint. In the interface
this is reflected as Monaco's `readOnly` mode. One trick was needed here:
in read-only mode Monaco silently drops even programmatic changes, so when
a remote change is inserted we lift the flag momentarily and put it back.

**File saving and opening.** The document is saved in two formats,
depending on the extension: ordinary text (any extension) or our own
`.pcdoc` format — `PCDC` magic bytes, a version, and the full CRDT snapshot
serialized in binary, with history and identifiers. On opening, the format
is recognized not by extension but by the magic bytes. Writing is always
atomic — first into a temporary file, then a rename — so that an
interruption during saving (a power cut, a crashed process) cannot leave us
a half-written file. A separate problem turned out to be line endings:
Windows files use CRLF, while Monaco and the CRDT expect LF. On opening we
normalize the text to LF, remember whether the file had CRLF, and on saving
put it back — this way a Windows file round-trips byte-identical, and in a
cross-platform session positions no longer "drift" (we really had this bug
and mention it separately in the problems section below). Finally, the
application maintains a most-recently-used (MRU) list of recently opened
files — no full-blown file manager, just quick access.

**The metrics system.** For diagnostics the application has a built-in
metrics panel. The gateway maintains atomic counters — active rooms and
clients, the number and volume of relayed frames, snapshot-sync
successes/failures, slow-client disconnects — and publishes them on an HTTP
endpoint. In the host application a separate tokio task
(`process_metrics_aggregator`) periodically reads this endpoint and
`cloudflared`'s own metrics, aggregates them, and delivers them to the
frontend via an event, where the user sees them in a panel. This was very
useful when debugging sessions — you can see at once whether traffic is
flowing and who is connected.

#### The frontend

The frontend is a React + TypeScript application (built with Vite) with the
Monaco editor at its center. Its main job is the correct operation of the
bidirectional flow: local keystrokes toward the backend, remote changes
toward the editor.

**Sending local changes.** Every content change in Monaco
(`onDidChangeModelContent`) is translated into an IPC command: `insert`,
`delete` or `replace`, with a position and content. So that commands cannot
overtake one another during fast typing, they are placed on a single chain
(`opQueue` — each next command waits for the previous one to finish). Each
command carries a `baseSeq` — the number of the last remote change the
editor had reflected at the moment of sending — with which the backend
recalculates the position when needed (see the previous chapter).

**Receiving remote changes.** The backend's `crdt://remote-change` event is
listened to by `remoteChangeListener`, which inserts the change into Monaco
programmatically. Two traps lurk here: first, a programmatic insertion also
triggers `onDidChangeModelContent`, which would send the change back toward
the backend and create an infinite loop — we close this with the
`isApplyingRemote` flag, which disables the local handler for the duration
of the insertion. Second, in read-only mode Monaco ignores programmatic
edits too, so during a remote insertion the `readOnly` flag is lifted
momentarily. When a snapshot is received (e.g. on joining a session), a
separate listener replaces the whole document.

**Interface structure.** Visually the application is a VS-Code-style
shell: on the left a narrow icon strip (the side rail), which opens the
side panel with three sections — Files (open/save/recent files),
Collaborate (start/join/leave a session), and personal settings (name,
theme, font size). The top bar holds the session status, the participants'
avatars (each gets a deterministically computed color), the invite-link
popover, and the menu. The participants panel gives the host a write-
permission toggle for each guest. The interface state is organized into
React hooks (`useRoomState`, `useSessionEvents`, `useWritePermission`,
`useTheme`, etc.), which listen to backend events and feed the components
with plain props. One technical detail: client identifiers are 64-bit
integers, while JavaScript numbers lose integers above 2^53 — so
identifiers always cross to the frontend as strings.

In the visual design iterations of the frontend (color palette, component
layout, themes) we used Claude as an assisting tool; the final design
decisions and their implementation are the team's.

The frontend also has its own tests (vitest): the critical synchronization
helper logic — computing inverse edits and tracking `baseSeq` — is checked
automatically, and type checking and the linter run in CI.

#### The gateway (the Go relay server)

The gateway is deliberately a "dumb" server (a dumb relay): it stores
nothing about the document — neither a snapshot nor an operation history —
and does not even decode the contents of CRDT frames. Its job is to forward
bytes quickly and fairly. This decision follows directly from the project's
philosophy: the source of truth is the participants' (and first of all the
host's) replicas, and the server needs no access to the document.

Its core concepts are:

- **Hub** — the room registry: creates rooms (`POST /rooms`), finds them by
  identifier, and deletes them at the end of a session;
- **Room** — the space of one session: the member list and the forwarding
  logic. A received frame is sent to every member of the room except the
  sender;
- **Client** — one WebSocket connection: a role (the first joiner is the
  host), an atomic write-permission flag, and a buffer of outgoing frames.

Despite its "dumbness", the gateway does have a few active duties. When a
new member joins, it sends the host a snapshot-request control frame and
forwards the host's response only to the new member — this way a guest who
arrives late receives the document's current state within seconds, without
the server ever having to store the document. On every member join/leave
the room sends everyone a membership frame (the garbage collector uses
this), and sends the new member the full list of existing members with
names and permissions. For permission frames it plays the authoritative
arbiter: it accepts the request only from the host, forbids changing the
host's own permission, and silently drops a read-only member's operations.

On the security and robustness side: every HTTP endpoint (except `/health`
and `/ws`) requires a bearer token that only the host's application knows;
the rate of WebSocket connections is limited (by default 5 connections per
minute from one address, configurable); and if some client cannot keep up
with receiving frames (a slow network, a stuck process), its buffer fills
up and the gateway disconnects it so that it does not hold back the rest of
the room — the standard solution to the so-called slow client problem.
Added to this is the metrics registry mentioned above, which the host
application reads periodically.

The gateway is fully stateless and single-session: it is born together with
the host's application, serves one room, and at the end of the session
(`POST /end-session` or when the host's window closes) sends members the
session-ended frame and shuts down. Go fit this task naturally: goroutines
and channels are exactly the primitives that a "two loops per client, one
distributor per room" architecture needs, and a single static binary is
ideal for launching as a sidecar.

#### System optimization

In the second half of the project we carried out two big optimizations: the
positional B+ index and the garbage collection system. Both answer problems
that trouble every serious CRDT implementation and whose solutions Yjs
devotes a large part of its own design to.

**The positional B+ index in numbers.** We described the index's structure
in the CRDT chapter; here we talk about its effect. Before the
optimization, every keystroke required walking the document's linked list
from the start — O(n) in both directions (from a position to a block and
from a block to a position). On small files this is imperceptible, but the
cost grows linearly with the number of blocks, and this cost is paid on
*every* keystroke and on *every* remote operation. By our measurements
(debug build, where the tree's branching factor is deliberately small):

| Number of blocks | List walk (O(n)) | B+ tree (O(log n)) | Speedup |
|---:|---:|---:|---:|
| ~200 | ~127 µs | ~14 µs | 9× |
| 1,000 | ~620 µs | ~16 µs | ~39× |
| 10,000 | ~6,200 µs | ~18 µs | ~340× |

*(Table 1: Position lookup time before and after the index.)*

The key observation is that the tree column is almost constant — the
logarithm is "flat" in practice. In a release build (branching 64/32, full
optimizations) each lookup is under 1 µs regardless of document size, so
the index never threatens the editor's frame budget. This is exactly why
mature CRDT implementations (Yjs, diamond-types) consider such indexes a
necessity.

**The garbage collector — why it is needed.** As noted, in a CRDT deletion
is only marking, and deleted blocks remain as tombstones. During active
editing this accumulates fast: in a long-running session, most of the
document's memory may end up occupied by long-deleted text, which also
travels the network along with snapshots. But simply deleting a tombstone
is dangerous: if some participant has not yet seen it, or if a delayed
operation relies on it as an origin, premature removal causes silent
divergence of the replicas. That is precisely why Yjs devotes a separate,
rather delicate mechanism to garbage collection.

**What makes our approach distinctive.** Here we exploited a property of
our architecture that "pure" peer-to-peer systems do not have: our session
has a distinguished node — the host — which is always online (the session
cannot exist without it) and to which the gateway supplies an exact picture
of membership. This makes the host a natural coordinator, while the
document's data still remains fully decentralized. The scheme works like
this:

1. Every guest periodically (with debouncing, so the network is not
   overloaded) publishes its state vector — "here is how much I have seen
   from each author";
2. The host collects all members' vectors (the gateway's membership frames
   tell it who is currently in the room) and computes their *minimum* — the
   "floor": the boundary of operations that everyone is guaranteed to have
   seen;
3. The host intersects this floor with its own DeleteSet and obtains the
   set of "confirmed" deletions — deletions that everyone has seen;
4. The confirmed ranges are sent to all participants (and to the host's own
   document) as a `gc-commit` frame, which they all execute identically.

The execution of a `gc-commit` is deliberately conservative: blocks are
*not* removed structurally — only their text content is emptied, and the
snapshot-only deletion sets are pruned. The block's identifier and its
place in the list remain unchanged, so a delayed operation that uses this
block as an origin still integrates exactly — this is what makes our
garbage collection convergence-safe. Structural removal would be the next
step, but it violates the integration algorithm's invariants (invariance
under splitting would be lost), and the memory gain is not worth the risk —
the main gain (freeing the text and shrinking snapshots) is achieved
anyway.

As far as we know, this host-authoritative, state-vector-floor-based scheme
differs from the approaches of common CRDT implementations, which either
use fully symmetric protocols or postpone garbage collection until the
document is "saved". In our case the host's distinguished role was already
part of the system — using it to simplify garbage collection turned out to
be a natural extension of the architecture.

**Problems we ran into along the way.** In accordance with the guidelines,
we summarize here the significant problems raised during development and
their solutions:

- **Position "drift" between the webview and the backend** — because of
  asynchronous IPC, a local command could carry a stale position. Solution:
  `baseSeq` + transforming the position against a small log of remote
  operations in the backend.
- **Windows CRLF desynchronization** — when a CRLF file was opened,
  positions no longer matched across platforms and mid-line edits landed in
  the wrong place. Solution: normalization to LF on open and restoring CRLF
  on save.
- **Monaco's readOnly trap** — in read-only mode Monaco dropped even
  programmatic edits, and a guest stopped receiving remote changes.
  Solution: momentarily lifting the flag while inserting a remote change.
- **A snapshot-synchronization race** — initially the host sent a snapshot
  only when connecting, and a guest who arrived late might receive a stale
  state. Solution: a request–response scheme — for every new member the
  gateway asks the host for a *fresh* snapshot.
- **Chunking large insertions** — giant single blocks (e.g. pasting a whole
  file) burdened the index and the network. Solution: cutting the text into
  64-character blocks on open.
- **The index drifting from the list** — the most dangerous risk when
  introducing the B+ tree was silent divergence of the two structures.
  Solution: the debug oracle, which does a full comparison after every
  mutation, plus a separate validator of the tree's internal invariants.

### Result obtained and evaluation

The project's final result is a working, cross-platform desktop application
that runs on Linux, Windows and macOS. The typical workflow looks like
this: on first launch the user picks a name (remembered for later
launches), then opens or creates a document and starts a session from the
side panel. Within a few seconds the application returns two invite links —
one for the local network and one public — which the host shares with one
click. Guests paste the link into their own application and immediately see
the document's current state; every subsequent change is reflected for
everyone in real time. From the participants panel the host controls who
may edit, and the work can be saved at any time either as an ordinary text
file or in the `.pcdoc` format (with full history).

*(Screenshot placeholders: first-run username prompt; main editor window
with side rail and side panel open; hosting flow with the invite popover
showing LAN and public URLs; two clients editing the same document
simultaneously; peers panel with per-guest write-permission toggles; file
section with open/save/recents and the metrics popup.)*

**Achievement of the goals.** All four goals stated in the introduction
have been achieved: (1) starting a session and joining via a link works in
both network modes — on a LAN without internet and globally via Cloudflare
Tunnel; (2) concurrent editing merges without conflicts via the YATA CRDT
and participants are guaranteed to see the same text; (3) infrastructure
management is fully automated — the user never even notices the server; (4)
the host fully controls the session with individual permission management.

**Quality assurance.** All three components have their own tests: in the
CRDT library — integration, splitting, deletion and index tests (including
conflict scenarios and the debug oracle); in the gateway — room, forwarding
and permission tests; on the frontend — tests of the synchronization helper
logic. Protocol drift tests protect both sides of the binary protocol. CI
(GitHub Actions) runs formatting, linters (in Rust, clippy warnings count
as errors), tests, and security checks (`cargo audit`, `npm audit`,
`govulncheck`) on every change, and a pre-push hook enforces the same
checks locally.

**Remaining limitations.** An honest evaluation requires noting what the
system cannot do yet: a session is limited to one document (there is no
support for multi-file projects), participants' cursors are not yet visible
to each other, and the host going offline ends the session — we have no
backup-host election mechanism. These items are natural candidates for
future development (see the conclusion).

---

## Conclusion

Building Peared brought together in one project what several different
courses normally cover: the theory of distributed systems (CRDTs, state
vectors, convergence arguments), data structures (an augmented B+ tree),
systems programming in Rust, network programming in Go, and modern
desktop/web interfaces. The final product — a collaborative editor that
works without a central service on both local and global networks — meets
the goal set from the beginning and is genuinely useful in the real
scenario (a classroom with unstable internet).

Beyond technical knowledge, the project taught us several more general
lessons. First, the value of correctness infrastructure: the debug oracle,
the protocol drift tests and strict CI caught the most dangerous class of
distributed-system errors (silent divergence of replicas) already at the
development stage, before they could turn into "rare, unreproducible
bugs". Second, drawing abstraction boundaries correctly: the fact that
`crdt-core` knows nothing about the network, the gateway knows nothing
about the document, and the frontend knows nothing about the CRDT allowed
all three components to be tested independently and developed in parallel.
Third, the discipline of teamwork: merging three people's work every day
through pull requests, code review and automated checks turned out to be as
much a part of the project as the algorithms.

The project has a clear path of development. The nearest steps are already
obvious: showing participants' cursors and selections (presence), support
for multi-file projects, an in-session chat. Further out — handing over the
host role without interrupting the session (the foundation for this, a full
copy of the document at every participant, already exists), end-to-end
encryption for zero trust toward the gateway, and persistent rooms for
those who like hosting on their own servers. A separately interesting
direction is using the `.pcdoc` format for browsing a document's history —
the format already stores the full editing history, and building a
"time-travel" feature on top of it would be a natural continuation.

To sum up: we started with a practical problem noticed in the classroom and
finished with a working system, to build which we had to study the theory
of modern distributed editing quite deeply. The project showed us that the
local-first approach — where the data stays with the user and the
infrastructure lives on their own computer — is not only ideologically
attractive but a practically achievable alternative to centralized
services.

---

## References

1. P. Nicolaescu, K. Jahns, M. Derntl, and R. Klamma, "Near Real-Time
   Peer-to-Peer Shared Editing on Extensible Data Types," in Proc. GROUP
   '16, 2016, pp. 39–49.
2. M. Shapiro, N. Preguiça, C. Baquero, and M. Zawirski, "Conflict-free
   Replicated Data Types," in Proc. SSS '11, 2011, pp. 386–400.
3. C. A. Ellis and S. J. Gibbs, "Concurrency control in groupware
   systems," in Proc. ACM SIGMOD '89, 1989, pp. 399–407.
4. K. Jahns, "Yjs Documentation." https://docs.yjs.dev/
5. J. Gentle, "diamond-types: The world's fastest CRDT."
   https://github.com/josephg/diamond-types
6. Tauri Working Group, "Tauri 2.0 Documentation." https://v2.tauri.app/
7. Microsoft, "Monaco Editor." https://microsoft.github.io/monaco-editor/
8. Cloudflare, Inc., "Cloudflare Tunnel Documentation."
   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
9. Anthropic, "Claude." https://claude.com/ (used as an assisting tool in
   the frontend's visual design iterations)

## Appendices

- Project GitHub link: https://github.com/CarlTeapot/Peared

---

### Glossary of Georgian terms used in the report (for your review)

| Georgian used in report | Intended English meaning |
|---|---|
| ერთობლივი რედაქტირება | collaborative editing |
| გეითვეი | gateway (transliterated) |
| სარელეო სერვერი | relay server |
| გვირაბი | tunnel |
| დაკავშირებული სია | linked list |
| მდგომარეობის ვექტორი | state vector |
| ნაგვის შემგროვებელი | garbage collector |
| „საფლავის ქვა" (tombstone) | tombstone |
| ხილული სიგრძე | visible length |
| წარმოშობის მაჩვენებლები | origin pointers |
| ბლოკის გაყოფა | block splitting |
| სნეფშოტი | snapshot |
| მთვლელი | counter (clock) |
| სასრული ავტომატი / მდგომარეობის მანქანა | finite state machine |
| მცველი (RAII) | guard (RAII) |
| ჩაწერის უფლება | write permission |
| მოთხოვნა-პასუხის სქემა | request–response scheme |
| დელტა „ბუბლდება"/„ბუშტდება" | the delta "bubbles up" |
| იატაკი (min_sv) | floor (minimum state vector) |
| უხმო დაშორება | silent divergence |
| განშტოების ფაქტორი | branching factor |
| კეშ-ლოკალურობა | cache locality |
| ეფემერული სესია | ephemeral session |
