const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=*, microphone=*');
  next();
});

// Fallback route for single-page app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = http.createServer(app);

// Zero-knowledge ephemeral signaling server
// Rooms strictly limited to exactly 2 peers max.
// ZERO messages, media, or transcripts pass through or are saved here.
const wss = new WebSocketServer({ server });

/**
 * Room structure:
 * roomId -> Set<WebSocket> (max size 2)
 */
const rooms = new Map();

wss.on('connection', (ws) => {
  let currentRoomId = null;

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'join': {
          const { roomId } = message;
          if (!roomId || typeof roomId !== 'string') {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid Room ID' }));
            return;
          }

          currentRoomId = roomId;

          if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
          }

          const room = rooms.get(roomId);

          // Strictly enforce: ONLY TWO PERSONS ARE ALLOWED
          if (room.size >= 2) {
            ws.send(JSON.stringify({
              type: 'room-full',
              message: 'This private room already has 2 participants and is strictly locked.'
            }));
            ws.close();
            return;
          }

          room.add(ws);
          ws.roomId = roomId;

          const isInitiator = room.size === 1;

          ws.send(JSON.stringify({
            type: 'joined',
            roomId,
            isInitiator,
            peerCount: room.size
          }));

          // When the 2nd peer joins, notify both that room is ready and fully locked
          if (room.size === 2) {
            for (const client of room) {
              client.send(JSON.stringify({
                type: 'ready',
                message: 'Both peers connected. Private session locked.'
              }));
            }
          }
          break;
        }

        // Ephemeral WebRTC signaling relays (Offer, Answer, ICE Candidates)
        // Relayed directly to the other peer in the room. Never stored.
        case 'offer':
        case 'answer':
        case 'ice-candidate':
        case 'low-signal-alert':
        case 'peer-video-state': {
          if (!currentRoomId || !rooms.has(currentRoomId)) return;
          const room = rooms.get(currentRoomId);
          for (const client of room) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(data.toString());
            }
          }
          break;
        }

        case 'leave': {
          cleanupPeer(ws);
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error('Error handling WS message:', err.message);
    }
  });

  ws.on('close', () => {
    cleanupPeer(ws);
  });

  ws.on('error', () => {
    cleanupPeer(ws);
  });
});

function cleanupPeer(ws) {
  if (ws.roomId && rooms.has(ws.roomId)) {
    const room = rooms.get(ws.roomId);
    room.delete(ws);

    // Notify remaining peer if any
    for (const client of room) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'peer-left',
          message: 'The other person has disconnected.'
        }));
      }
    }

    if (room.size === 0) {
      rooms.delete(ws.roomId);
    }
  }
}

// Heartbeat to prune dead connections
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      cleanupPeer(ws);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🔒 Private Duo Secure Call Server running`);
  console.log(`📡 Local:   http://localhost:${PORT}`);
  console.log(`🔐 Maximum capacity: 2 peers per room (Strict Lock)`);
  console.log(`⚡ Zero-Logs / Direct P2P Media & E2EE DataChannel`);
  console.log(`======================================================\n`);
});
