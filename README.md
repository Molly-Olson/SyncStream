# SyncStream

**Watch together. Miles apart. Frame in frame.**

SyncStream is a real-time playback coordinator for friends who want to watch movies or shows together remotely — each on their own streaming service, each using their own account. SyncStream sits in the middle and keeps everyone's playback perfectly in sync via WebSockets, broadcasting play, pause, and seek events to everyone in the room with sub-100ms latency.

No browser extensions. No screen sharing. No shared subscription. Just synchronized timing.

---

## Tech Stack

| Layer       | Technology                          |
|-------------|-------------------------------------|
| Runtime     | Node.js                             |
| Server      | Express 4                           |
| Real-time   | Socket.io 4                         |
| ID gen      | uuid                                |
| Frontend    | Vanilla JS + Bootstrap 5 (CDN)      |
| Storage     | In-memory Map (MVP, no DB required) |

---

## Getting Started

### Prerequisites

- Node.js 18+ installed
- npm 9+

### Install & Run

```bash
# 1. Clone or unzip the project
cd SyncStream

# 2. Install dependencies
npm install

# 3. Start the server
npm start
# → Server running at http://localhost:3000

# Development mode (auto-restart on file changes)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## How to Use

1. **Create a Room** — Click "Create a Room", enter your display name, and get a 4-character room code (e.g. `AB3X`).
2. **Share the Code** — Paste the code in your group chat. Each friend visits the site, clicks "Join a Room", and enters the code.
3. **Queue Your Title** — Everyone opens the same movie or show on their own streaming service and pauses at the beginning.
4. **Press Play All** — Hit "Play All" in SyncStream. The play event broadcasts to everyone simultaneously. Your streams start together.
5. **Stay in Sync** — Any play, pause, or seek event in SyncStream is mirrored to every participant's video player instantly.
6. **Chat** — Use the integrated chat panel to react without needing a separate voice or text app.

---

## API Reference

| Method | Endpoint            | Description                        |
|--------|---------------------|------------------------------------|
| POST   | `/api/rooms`        | Create a new room → `{ roomId, roomCode }` |
| GET    | `/api/rooms/:code`  | Get room info by 4-char code       |

### Socket Events (client → server)

| Event       | Payload                        | Description                         |
|-------------|--------------------------------|-------------------------------------|
| `join-room` | `{ roomCode, username }`       | Join a room by code                 |
| `play`      | `{ timestamp }`                | Broadcast play at timestamp (secs)  |
| `pause`     | `{ timestamp }`                | Broadcast pause at timestamp        |
| `seek`      | `{ timestamp }`                | Broadcast seek to timestamp         |
| `chat`      | `{ message }`                  | Send a chat message to the room     |

### Socket Events (server → client)

| Event        | Payload                                  | Description                      |
|--------------|------------------------------------------|----------------------------------|
| `room-joined`| room object                              | Confirms join, returns room state|
| `user-joined`| `{ username, users[] }`                  | Someone else joined              |
| `user-left`  | `{ username, users[] }`                  | Someone disconnected             |
| `play`       | `{ timestamp, from }`                    | Remote play event                |
| `pause`      | `{ timestamp, from }`                    | Remote pause event               |
| `seek`       | `{ timestamp, from }`                    | Remote seek event                |
| `chat`       | `{ from, message, timestamp }`           | Incoming chat message            |
| `error`      | `{ message }`                            | Error from server                |

---

## Project Structure

```
SyncStream/
├── server.js          # Express + Socket.io server
├── package.json
├── .gitignore
├── README.md
└── public/
    ├── index.html     # Landing page (create / join room)
    ├── room.html      # Sync room UI (video + chat + controls)
    └── style.css      # Shared dark-theme styles
```

---

## Scaling Notes (beyond MVP)

- **Persistence** — Replace the in-memory `Map` with Redis for multi-process / multi-server deployments.
- **Latency compensation** — Add a round-trip time (RTT) measurement on join and offset the broadcast timestamp by half the sender's RTT to achieve tighter sync.
- **Room passwords** — Add an optional PIN to the room creation flow.
- **Reconnect grace** — Store the last known timestamp per room so a reconnecting user can snap back to the current position.

---

## License

MIT
