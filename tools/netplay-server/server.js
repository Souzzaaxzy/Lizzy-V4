/**
 * Servidor de netplay do EmulatorJS — com DESLIGAMENTO AUTOMATICO.
 *
 * Base: `EmulatorJS/EmulatorJS-Netplay` (branch `main`, `server.js`, MIT).
 * O que foi acrescentado aqui:
 *
 *   1. O servidor se DESLIGA sozinho quando fica sem salas:
 *      - enquanto nunca houve sala, vale `NETPLAY_GRACE_MS` (tempo para o
 *        jogador abrir o link e criar a sala);
 *      - depois que a ultima sala fecha, vale `NETPLAY_IDLE_SHUTDOWN_MS`.
 *      Se chegar sala nova nesse intervalo, o desligamento e cancelado.
 *      `NETPLAY_SELF_SHUTDOWN=0` desliga esse comportamento (servidor fixo).
 *
 *   2. `GET /status` — diagnostico leve (salas/jogadores/uptime), sem expor
 *      nada dos jogadores. O `/list` oficial continua igual.
 *
 * O servidor NUNCA deve rodar "sempre ligado": quem o sobe e o bot, no momento
 * em que alguem pede uma sala (`!kof @fulano` + `sim`).
 *
 * Variaveis:
 *   PORT                     porta (padrao 3000)
 *   NETPLAY_IDLE_SHUTDOWN_MS tempo sem NENHUMA sala antes de sair (padrao 60s)
 *   NETPLAY_GRACE_MS         tempo inicial sem sala antes de sair (padrao 120s)
 *   NETPLAY_SELF_SHUTDOWN    '0' desliga o auto-desligamento (padrao ligado)
 */
'use strict';

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT || 3000);
const IDLE_SHUTDOWN_MS = Number(process.env.NETPLAY_IDLE_SHUTDOWN_MS || 60 * 1000);
// Tempo para o PRIMEIRO jogador abrir o link e criar a sala. A URL publica
// (tunel Cloudflare) leva ~90 s so para propagar o DNS, e ainda falta a pessoa
// tocar no botao — com 2 min o servidor morria antes de alguem entrar.
const GRACE_MS = Number(process.env.NETPLAY_GRACE_MS || 10 * 60 * 1000);
const SELF_SHUTDOWN = process.env.NETPLAY_SELF_SHUTDOWN !== '0';

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  credentials: true,
}));

const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const startedAt = Date.now();
let rooms = {};

const getClientIp = (socket) => {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return socket.handshake.headers['x-real-ip'] || socket.handshake.address;
};

// ---------------------------------------------------------------------------
// DESLIGAMENTO AUTOMATICO
// ---------------------------------------------------------------------------
// O bot sobe o processo sob demanda. Se ninguem criar sala, ou se todas
// fecharem, ele sai sozinho -- nao faz sentido um servidor de netplay ocupando
// memoria e porta com zero jogadores.
let shutdownTimer = null;

function salasAtivas() {
  return Object.keys(rooms).length;
}

function cancelarDesligamento() {
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }
}

function agendarDesligamento(ms, motivo) {
  if (!SELF_SHUTDOWN) return;
  cancelarDesligamento();
  shutdownTimer = setTimeout(() => {
    // Reconfere: pode ter chegado sala no intervalo.
    if (salasAtivas() > 0) {
      shutdownTimer = null;
      return;
    }
    console.log(`[NETPLAY] ${motivo} — encerrando (0 salas).`);
    encerrar(0);
  }, ms);
  shutdownTimer.unref?.();
}

function encerrar(code = 0) {
  cancelarDesligamento();
  try { io.close(); } catch { /* ok */ }
  try { server.close(); } catch { /* ok */ }
  // `close` nao derruba sockets abertos; forca a saida.
  const t = setTimeout(() => process.exit(code), 500);
  t.unref?.();
  server.close(() => process.exit(code));
}

/** Reavalia o estado apos criar/fechar sala. */
function reavaliarVida() {
  if (!SELF_SHUTDOWN) return;
  if (salasAtivas() > 0) {
    cancelarDesligamento();
  } else {
    agendarDesligamento(IDLE_SHUTDOWN_MS, 'sem salas ativas');
  }
}

// ---------------------------------------------------------------------------
// Rotas HTTP
// ---------------------------------------------------------------------------
app.get('/list', (req, res) => {
  const gameId = req.query.game_id;
  const openRooms = Object.keys(rooms)
    .filter((sessionId) => {
      const room = rooms[sessionId];
      return (
        room &&
        Object.keys(room.players).length < room.maxPlayers &&
        String(room.gameId) === gameId
      );
    })
    .reduce((acc, sessionId) => {
      const room = rooms[sessionId];
      const ownerPlayerId = Object.keys(room.players).find(
        (playerId) => room.players[playerId].socketId === room.owner
      );
      const playerName = ownerPlayerId ? room.players[ownerPlayerId].player_name : 'Unknown';
      acc[sessionId] = {
        room_name: room.roomName,
        current: Object.keys(room.players).length,
        max: room.maxPlayers,
        player_name: playerName,
        hasPassword: !!room.password,
      };
      return acc;
    }, {});
  res.json(openRooms);
});

// Diagnostico leve (nao expoe nada dos jogadores).
app.get('/status', (_req, res) => {
  const players = Object.values(rooms).reduce(
    (n, r) => n + Object.keys(r.players).length,
    0
  );
  res.json({
    ok: true,
    plugin: 'netplay',
    rooms: salasAtivas(),
    players,
    uptimeMs: Date.now() - startedAt,
    selfShutdown: SELF_SHUTDOWN,
    idleShutdownMs: IDLE_SHUTDOWN_MS,
    graceMs: GRACE_MS,
  });
});

app.get('/', (_req, res) => {
  res.json({ ok: true, plugin: 'netplay', rooms: salasAtivas() });
});

// ---------------------------------------------------------------------------
// Socket.IO (logica oficial de salas)
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  const clientIp = getClientIp(socket);

  socket.on('open-room', (data, callback) => {
    let sessionId, playerId, roomName, gameId, maxPlayers, playerName, roomPassword;
    if (data.extra) {
      sessionId = data.extra.sessionid;
      playerId = data.extra.userid || data.extra.playerId;
      roomName = data.extra.room_name;
      gameId = data.extra.game_id;
      maxPlayers = data.maxPlayers || 4;
      playerName = data.extra.player_name || 'Unknown';
      roomPassword = data.extra.room_password || 'none';
    }
    if (!sessionId || !playerId) {
      return callback('Invalid data: sessionId and playerId required');
    }
    if (rooms[sessionId]) {
      return callback('Room already exists');
    }

    let finalDomain = data.extra.domain;
    if (finalDomain === undefined || finalDomain === null) {
      finalDomain = 'unknown';
    }

    rooms[sessionId] = {
      owner: socket.id,
      players: { [playerId]: { ...data.extra, socketId: socket.id } },
      peers: [],
      roomName: roomName || `Room ${sessionId}`,
      gameId: gameId || 'default',
      domain: finalDomain,
      password: data.password || null,
      maxPlayers: maxPlayers,
    };
    socket.join(sessionId);
    socket.sessionId = sessionId;
    socket.playerId = playerId;
    io.to(sessionId).emit('users-updated', rooms[sessionId].players);
    console.log(`[NETPLAY] sala criada ${sessionId} (${salasAtivas()} ativa(s))`);
    reavaliarVida();
    callback(null);
  });

  socket.on('join-room', (data, callback) => {
    const { sessionid: sessionId, userid: playerId, player_name: playerName = 'Unknown' } = data.extra || {};

    if (!sessionId || !playerId) {
      if (typeof callback === 'function') callback('Invalid data: sessionId and playerId required');
      return;
    }

    const room = rooms[sessionId];
    if (!room) {
      if (typeof callback === 'function') callback('Room not found');
      return;
    }

    const roomPassword = data.password || null;
    if (room.password && room.password !== roomPassword) {
      if (typeof callback === 'function') callback('Incorrect password');
      return;
    }

    if (Object.keys(room.players).length >= room.maxPlayers) {
      if (typeof callback === 'function') callback('Room full');
      return;
    }

    room.players[playerId] = { ...data.extra, socketId: socket.id };
    socket.join(sessionId);
    socket.sessionId = sessionId;
    socket.playerId = playerId;

    io.to(sessionId).emit('users-updated', room.players);

    if (typeof callback === 'function') {
      callback(null, room.players);
    }
    reavaliarVida();
  });

  /** Remove o jogador do socket; devolve true se a sala foi apagada. */
  function sairDaSala() {
    const sessionId = socket.sessionId;
    const playerId = socket.playerId;
    if (!sessionId || !playerId) return false;
    if (!rooms[sessionId]) return false;

    delete rooms[sessionId].players[playerId];
    rooms[sessionId].peers = rooms[sessionId].peers.filter(
      (peer) => peer.source !== socket.id && peer.target !== socket.id
    );
    io.to(sessionId).emit('users-updated', rooms[sessionId].players);
    if (Object.keys(rooms[sessionId].players).length === 0) {
      delete rooms[sessionId];
      console.log(`[NETPLAY] sala ${sessionId} fechou (${salasAtivas()} ativa(s))`);
      return true;
    }
    if (socket.id === rooms[sessionId].owner) {
      const remainingPlayers = Object.keys(rooms[sessionId].players);
      if (remainingPlayers.length > 0) {
        const newOwnerId = rooms[sessionId].players[remainingPlayers[0]].socketId;
        rooms[sessionId].owner = newOwnerId;
        rooms[sessionId].peers = rooms[sessionId].peers.map((peer) => {
          if (peer.source === socket.id) {
            return { source: newOwnerId, target: peer.target };
          }
          return peer;
        });
        if (rooms[sessionId].peers.length > 0) {
          io.to(newOwnerId).emit('webrtc-signal', {
            target: rooms[sessionId].peers[0].target,
            requestRenegotiate: true,
          });
        }
        io.to(sessionId).emit('users-updated', rooms[sessionId].players);
      }
    }
    socket.leave(sessionId);
    delete socket.sessionId;
    delete socket.playerId;
    return false;
  }

  socket.on('leave-room', () => {
    const fechou = sairDaSala();
    if (fechou) reavaliarVida();
  });

  socket.on('webrtc-signal', (data) => {
    try {
      const { target, candidate, offer, answer, requestRenegotiate } = data || {};

      if (!target && !requestRenegotiate) {
        throw new Error('Target ID missing unless requesting renegotiation');
      }

      if (requestRenegotiate) {
        const targetSocket = io.sockets.sockets.get(target);
        if (targetSocket) {
          targetSocket.emit('webrtc-signal', {
            sender: socket.id,
            requestRenegotiate: true,
          });
        }
      } else {
        io.to(target).emit('webrtc-signal', {
          sender: socket.id,
          candidate,
          offer,
          answer,
        });
      }
    } catch (error) {
      console.error(`WebRTC signal error: ${error.message}`);
    }
  });

  socket.on('data-message', (data) => {
    if (socket.sessionId) {
      socket.to(socket.sessionId).emit('data-message', data);
    }
  });

  socket.on('snapshot', (data) => {
    if (socket.sessionId) {
      socket.to(socket.sessionId).emit('snapshot', data);
    }
  });

  socket.on('input', (data) => {
    if (socket.sessionId) {
      socket.to(socket.sessionId).emit('input', data);
    }
  });

  socket.on('disconnect', () => {
    const fechou = sairDaSala();
    if (fechou) reavaliarVida();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[NETPLAY] ouvindo na porta ${PORT} (pid ${process.pid})`);
  if (SELF_SHUTDOWN) {
    // Sem sala nenhuma, o processo se encerra se ninguem aparecer.
    agendarDesligamento(GRACE_MS, 'nenhuma sala criada');
    console.log(`[NETPLAY] sem sala em ${Math.round(GRACE_MS / 1000)}s eu encerro; sem salas ativas em ${Math.round(IDLE_SHUTDOWN_MS / 1000)}s tambem.`);
  } else {
    console.log('[NETPLAY] auto-desligamento DESATIVADO (NETPLAY_SELF_SHUTDOWN=0).');
  }
});
