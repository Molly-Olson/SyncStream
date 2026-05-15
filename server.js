require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// CORS: open in dev, locked to ALLOWED_ORIGINS in production
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

const io = new Server(server, {
  cors: {
    origin: NODE_ENV === 'production' ? allowedOrigins : '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  // Needed for some proxy/hosting setups
  transports: ['websocket', 'polling']
});

// Trust proxy headers (required for Railway, Render, Heroku)
app.set('trust proxy', 1);

// ─── In-memory store ────────────────────────────────────────────────────────
// rooms: Map<roomCode, { roomId, roomCode, createdAt, users: Map<socketId, { username, socketId }> }>
const rooms = new Map();
// socketToRoom: Map<socketId, roomCode>  — for fast lookup on disconnect
const socketToRoom = new Map();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate a unique 4-character uppercase room code.
 * Retries until it finds one not already in use.
 */
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // omit ambiguous chars
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

function roomPublicView(room) {
  return {
    roomId: room.roomId,
    roomCode: room.roomCode,
    createdAt: room.createdAt,
    userCount: room.users.size,
    users: Array.from(room.users.values()).map(u => ({
      username: u.username,
      socketId: u.socketId
    }))
  };
}

// ─── REST API ─────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// POST /api/rooms — create a new room
app.post('/api/rooms', (req, res) => {
  const roomId = uuidv4();
  const roomCode = generateRoomCode();

  const room = {
    roomId,
    roomCode,
    createdAt: new Date().toISOString(),
    users: new Map()
  };

  rooms.set(roomCode, room);

  console.log(`[Room Created] code=${roomCode} id=${roomId}`);
  res.status(201).json({ roomId, roomCode });
});

// GET /api/rooms/:code — get room info
app.get('/api/rooms/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = rooms.get(code);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  res.json(roomPublicView(room));
});

// ─── Socket.io Events ─────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[Socket Connected] ${socket.id}`);

  // join-room: { roomCode, username }
  socket.on('join-room', ({ roomCode, username }) => {
    if (!roomCode || !username) {
      socket.emit('error', { message: 'roomCode and username are required.' });
      return;
    }

    const code = roomCode.toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      socket.emit('error', { message: `Room "${code}" does not exist.` });
      return;
    }

    // Leave any previous room
    const prevCode = socketToRoom.get(socket.id);
    if (prevCode && prevCode !== code) {
      _leaveRoom(socket, prevCode);
    }

    // Join the Socket.io room channel
    socket.join(code);
    socketToRoom.set(socket.id, code);

    const user = { username: username.trim(), socketId: socket.id };
    room.users.set(socket.id, user);

    console.log(`[Join Room] ${username} (${socket.id}) → room ${code}`);

    // Confirm to the joiner
    socket.emit('room-joined', roomPublicView(room));

    // Notify everyone else
    socket.to(code).emit('user-joined', {
      username: user.username,
      socketId: socket.id,
      users: Array.from(room.users.values()).map(u => u.username)
    });
  });

  // play: { timestamp }
  socket.on('play', ({ timestamp }) => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const user = room.users.get(socket.id);
    console.log(`[Play] ${user?.username} @ ${timestamp}s in room ${code}`);
    socket.to(code).emit('play', { timestamp, from: user?.username });
  });

  // pause: { timestamp }
  socket.on('pause', ({ timestamp }) => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const user = room.users.get(socket.id);
    console.log(`[Pause] ${user?.username} @ ${timestamp}s in room ${code}`);
    socket.to(code).emit('pause', { timestamp, from: user?.username });
  });

  // seek: { timestamp }
  socket.on('seek', ({ timestamp }) => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const user = room.users.get(socket.id);
    console.log(`[Seek] ${user?.username} → ${timestamp}s in room ${code}`);
    socket.to(code).emit('seek', { timestamp, from: user?.username });
  });

  // chat: { message }
  socket.on('chat', ({ message }) => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const user = room.users.get(socket.id);
    if (!message || !message.trim()) return;

    const payload = {
      from: user?.username || 'Unknown',
      message: message.trim(),
      timestamp: new Date().toISOString()
    };

    console.log(`[Chat] ${payload.from}: ${payload.message}`);
    // Send to everyone in the room including sender
    io.to(code).emit('chat', payload);
  });

  // disconnect
  socket.on('disconnect', () => {
    console.log(`[Socket Disconnected] ${socket.id}`);
    const code = socketToRoom.get(socket.id);
    if (code) {
      _leaveRoom(socket, code);
    }
  });
});

/**
 * Remove a socket from a room and notify others.
 */
function _leaveRoom(socket, roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const user = room.users.get(socket.id);
  room.users.delete(socket.id);
  socketToRoom.delete(socket.id);
  socket.leave(roomCode);

  if (user) {
    console.log(`[Leave Room] ${user.username} (${socket.id}) left room ${roomCode}`);
    socket.to(roomCode).emit('user-left', {
      username: user.username,
      socketId: socket.id,
      users: Array.from(room.users.values()).map(u => u.username)
    });
  }

  // Optional: clean up empty rooms after a grace period
  if (room.users.size === 0) {
    setTimeout(() => {
      const r = rooms.get(roomCode);
      if (r && r.users.size === 0) {
        rooms.delete(roomCode);
        console.log(`[Room Cleaned Up] ${roomCode}`);
      }
    }, 5 * 60 * 1000); // 5 minutes
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n  SyncStream server running at http://localhost:${PORT}\n`);
});
