const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { nanoid } = require('nanoid');

const PORT = process.env.PORT || 80;
const TICK_RATE = 60; // physics updates per second
const BROADCAST_RATE = 20; // client updates per second
const WORLD_SIZE = 7000;
const START_MASS = 40;
const FOOD_AMOUNT = 2800;
const FOOD_VARIANTS = [
  { mass: 1, color: '#7bc8ff' },
  { mass: 2, color: '#ffdf6b' },
  { mass: 4, color: '#ff7bbd' },
];
const VIRUS_AMOUNT = 70;
const VIRUS_BASE_MASS = 100;
const EJECT_MASS = 12;
const SPLIT_MIN_MASS = 30;
const MAX_CELLS = 16;
const DECAY_START = 150;
const DECAY_RATE = 0.0015;
const RECOMBINE_DELAY = 7 * 1000;
const VIRUS_SHOOT_THRESHOLD = 30;
const VIRUS_EAT_FACTOR = 1.3;
const VIRUS_REWARD = 1.6; // multiplier of virus mass when eaten

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '..', 'public')));

const gameState = {
  players: new Map(),
  food: [],
  viruses: [],
  ejected: [],
};

function randomPosition() {
  return {
    x: Math.random() * WORLD_SIZE - WORLD_SIZE / 2,
    y: Math.random() * WORLD_SIZE - WORLD_SIZE / 2,
  };
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function radiusFromMass(mass) {
  return Math.sqrt(mass) * 4;
}

function speedFromMass(mass, cellsCount = 1) {
  const base = 340 / Math.sqrt(mass + 14);
  const multi = 1 + Math.max(0, 0.35 - Math.min(0.25, cellsCount * 0.015));
  return Math.max(22, base * multi);
}

function spawnFood() {
  while (gameState.food.length < FOOD_AMOUNT) {
    const pos = randomPosition();
    const variant = FOOD_VARIANTS[Math.floor(Math.random() * FOOD_VARIANTS.length)];
    gameState.food.push({ ...pos, mass: variant.mass, color: variant.color });
  }
}

function spawnViruses() {
  while (gameState.viruses.length < VIRUS_AMOUNT) {
    const pos = randomPosition();
    gameState.viruses.push({ ...pos, mass: VIRUS_BASE_MASS, color: '#42b72a', feed: 0 });
  }
}

function spawnPlayer(name) {
  const id = nanoid();
  const color = `hsl(${Math.random() * 360},80%,55%)`;
  const pos = randomPosition();
  const cell = { ...pos, mass: START_MASS, id: nanoid(), mergeAt: Date.now(), vx: 0, vy: 0 };
  const player = {
    id,
    name: name || 'Anon',
    color,
    cells: [cell],
    target: { x: pos.x, y: pos.y },
    alive: true,
    score: START_MASS,
    best: START_MASS,
    isSpectating: false,
  };
  gameState.players.set(id, player);
  return player;
}

function moveCells(player) {
  const cellCount = player.cells.length;
  for (const cell of player.cells) {
    const dx = player.target.x - cell.x;
    const dy = player.target.y - cell.y;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = speedFromMass(cell.mass, cellCount) / TICK_RATE;
    cell.x += (dx / dist) * speed + (cell.vx || 0);
    cell.y += (dy / dist) * speed + (cell.vy || 0);
    if (cell.vx) cell.vx *= 0.88;
    if (cell.vy) cell.vy *= 0.88;
    cell.x = Math.max(-WORLD_SIZE / 2, Math.min(WORLD_SIZE / 2, cell.x));
    cell.y = Math.max(-WORLD_SIZE / 2, Math.min(WORLD_SIZE / 2, cell.y));
  }
}

function mergeCells(player) {
  for (let i = 0; i < player.cells.length; i++) {
    for (let j = i + 1; j < player.cells.length; j++) {
      const a = player.cells[i];
      const b = player.cells[j];
      if (Date.now() < a.mergeAt || Date.now() < b.mergeAt) continue;
      const dist = distance(a, b);
      if (dist < radiusFromMass(a.mass) + radiusFromMass(b.mass) * 0.2) {
        if (a.mass >= b.mass) {
          const angle = Math.atan2(player.target.y - a.y, player.target.x - a.x);
          a.mass += b.mass;
          a.vx = (a.vx || 0) + Math.cos(angle) * 0.6;
          a.vy = (a.vy || 0) + Math.sin(angle) * 0.6;
          player.cells.splice(j, 1);
          j--;
        } else {
          const angle = Math.atan2(player.target.y - b.y, player.target.x - b.x);
          b.mass += a.mass;
          b.vx = (b.vx || 0) + Math.cos(angle) * 0.6;
          b.vy = (b.vy || 0) + Math.sin(angle) * 0.6;
          player.cells.splice(i, 1);
          i--;
          break;
        }
      }
    }
  }
}

function consumeFood(player) {
  for (const cell of player.cells) {
    for (let i = 0; i < gameState.food.length; i++) {
      const food = gameState.food[i];
      if (distance(cell, food) <= radiusFromMass(cell.mass)) {
        cell.mass += food.mass;
        player.score += food.mass;
        gameState.food.splice(i, 1);
        i--;
      }
    }
  }
}

function consumeEjected(player) {
  for (const cell of player.cells) {
    for (let i = 0; i < gameState.ejected.length; i++) {
      const pellet = gameState.ejected[i];
      if (distance(cell, pellet) <= radiusFromMass(cell.mass) && cell.mass > pellet.mass + 5) {
        cell.mass += pellet.mass;
        player.score += pellet.mass;
        gameState.ejected.splice(i, 1);
        i--;
      }
    }
  }
}

function consumeViruses(player) {
  for (const cell of player.cells) {
    for (let i = 0; i < gameState.viruses.length; i++) {
      const virus = gameState.viruses[i];
      if (distance(cell, virus) <= radiusFromMass(cell.mass)) {
        if (cell.mass > virus.mass * VIRUS_EAT_FACTOR) {
          cell.mass += virus.mass * VIRUS_REWARD;
          player.score += virus.mass * VIRUS_REWARD;
        } else {
          splitIntoFragments(player, cell, 8 + Math.floor(cell.mass / 80));
          cell.mass = Math.max(cell.mass * 0.35, START_MASS);
        }
        gameState.viruses.splice(i, 1);
        i--;
      }
    }
  }
}

function splitIntoFragments(player, cell, parts) {
  const massPer = Math.max(cell.mass / parts, START_MASS / 2);
  cell.mass -= massPer * (parts - 1);
  for (let i = 0; i < parts - 1 && player.cells.length < MAX_CELLS; i++) {
    const angle = Math.random() * Math.PI * 2;
    const nx = cell.x + Math.cos(angle) * radiusFromMass(cell.mass);
    const ny = cell.y + Math.sin(angle) * radiusFromMass(cell.mass);
    player.cells.push({
      id: nanoid(),
      x: nx,
      y: ny,
      mass: massPer,
      mergeAt: Date.now() + RECOMBINE_DELAY,
      vx: Math.cos(angle) * 3.5,
      vy: Math.sin(angle) * 3.5,
    });
  }
  cell.mergeAt = Date.now() + RECOMBINE_DELAY;
}

function handlePlayerCollisions(player) {
  for (const other of gameState.players.values()) {
    if (!other.alive || other.id === player.id) continue;
    for (const cell of player.cells) {
      for (const target of other.cells) {
        const dist = distance(cell, target);
        if (dist < radiusFromMass(cell.mass) && cell.mass > target.mass * 1.12) {
          cell.mass += target.mass;
          other.cells.splice(other.cells.indexOf(target), 1);
          other.score = Math.max(0, other.score - target.mass);
          if (other.cells.length === 0) {
            other.alive = false;
            other.isSpectating = true;
          }
        }
      }
    }
  }
}

function decayMass(player) {
  for (const cell of player.cells) {
    if (cell.mass > DECAY_START) {
      cell.mass -= cell.mass * DECAY_RATE;
    }
  }
}

function clampCells(player) {
  for (const cell of player.cells) {
    cell.x = Math.max(-WORLD_SIZE / 2, Math.min(WORLD_SIZE / 2, cell.x));
    cell.y = Math.max(-WORLD_SIZE / 2, Math.min(WORLD_SIZE / 2, cell.y));
  }
}

function updatePlayer(player) {
  moveCells(player);
  consumeFood(player);
  consumeEjected(player);
  consumeViruses(player);
  mergeCells(player);
  handlePlayerCollisions(player);
  decayMass(player);
  clampCells(player);
  const currentMass = player.cells.reduce((s, c) => s + c.mass, 0);
  player.score = Math.max(player.score, currentMass);
  player.best = Math.max(player.best, currentMass);
}

function handleSplit(player) {
  const newCells = [];
  for (const cell of player.cells) {
    if (cell.mass < SPLIT_MIN_MASS || player.cells.length + newCells.length >= MAX_CELLS) continue;
    const splitMass = cell.mass / 2;
    cell.mass = splitMass;
    const angle = Math.atan2(player.target.y - cell.y, player.target.x - cell.x);
    const nx = cell.x + Math.cos(angle) * (radiusFromMass(cell.mass) * 2);
    const ny = cell.y + Math.sin(angle) * (radiusFromMass(cell.mass) * 2);
    const impulse = 7.5;
    cell.vx = (cell.vx || 0) + Math.cos(angle) * impulse * -0.4;
    cell.vy = (cell.vy || 0) + Math.sin(angle) * impulse * -0.4;
    newCells.push({
      id: nanoid(),
      x: nx,
      y: ny,
      mass: splitMass,
      mergeAt: Date.now() + RECOMBINE_DELAY,
      vx: Math.cos(angle) * impulse,
      vy: Math.sin(angle) * impulse,
    });
    cell.mergeAt = Date.now() + RECOMBINE_DELAY;
  }
  player.cells.push(...newCells);
}

function handleEject(player) {
  for (const cell of player.cells) {
    if (cell.mass <= EJECT_MASS + 5) continue;
    cell.mass -= EJECT_MASS;
    const angle = Math.atan2(player.target.y - cell.y, player.target.x - cell.x);
    const speed = 30;
    const pellet = {
      id: nanoid(),
      x: cell.x + Math.cos(angle) * radiusFromMass(cell.mass),
      y: cell.y + Math.sin(angle) * radiusFromMass(cell.mass),
      mass: EJECT_MASS,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: player.color,
    };
    gameState.ejected.push(pellet);
  }
}

function feedViruses() {
  for (let i = 0; i < gameState.ejected.length; i++) {
    const pellet = gameState.ejected[i];
    for (const virus of gameState.viruses) {
      if (distance(pellet, virus) <= radiusFromMass(virus.mass)) {
        virus.feed += pellet.mass;
        gameState.ejected.splice(i, 1);
        i--;
        if (virus.feed >= VIRUS_SHOOT_THRESHOLD) {
          virus.feed = 0;
          shootVirus(virus);
        }
        break;
      }
    }
  }
}

function shootVirus(virus) {
  const angle = Math.random() * Math.PI * 2;
  const pos = { x: virus.x + Math.cos(angle) * 30, y: virus.y + Math.sin(angle) * 30 };
  const newVirus = { ...pos, mass: VIRUS_BASE_MASS, color: '#42b72a', feed: 0 };
  gameState.viruses.push(newVirus);
}

function updateEjected() {
  for (const pellet of gameState.ejected) {
    pellet.x += pellet.vx / TICK_RATE;
    pellet.y += pellet.vy / TICK_RATE;
    pellet.vx *= 0.95;
    pellet.vy *= 0.95;
  }
  gameState.ejected = gameState.ejected.filter((p) => Math.abs(p.x) < WORLD_SIZE && Math.abs(p.y) < WORLD_SIZE);
}

function leaderboard() {
  return Array.from(gameState.players.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((p) => ({ name: p.name, score: Math.floor(p.score), id: p.id }));
}

function broadcast() {
  const snapshot = {
    players: Array.from(gameState.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      cells: p.cells.map((c) => ({
        x: Math.round(c.x * 10) / 10,
        y: Math.round(c.y * 10) / 10,
        mass: Math.round(c.mass * 10) / 10,
        id: c.id,
      })),
      alive: p.alive,
      isSpectating: p.isSpectating,
    })),
    food: gameState.food,
    viruses: gameState.viruses,
    ejected: gameState.ejected,
    leaderboard: leaderboard(),
    worldSize: WORLD_SIZE,
  };

  const payload = JSON.stringify({ type: 'update', data: snapshot });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function sendLobby(ws, player) {
  ws.send(
    JSON.stringify({ type: 'welcome', data: { id: player.id, color: player.color, worldSize: WORLD_SIZE } })
  );
}

function tick() {
  spawnFood();
  spawnViruses();
  updateEjected();
  feedViruses();
  for (const player of gameState.players.values()) {
    if (!player.alive && !player.isSpectating) continue;
    updatePlayer(player);
  }
  const now = Date.now();
  if (now - (tick.lastBroadcast || 0) >= 1000 / BROADCAST_RATE) {
    tick.lastBroadcast = now;
    broadcast();
  }
}

wss.on('connection', (ws) => {
  let player = null;
  let joined = false;

  ws.on('message', (raw) => {
    try {
      const { type, data } = JSON.parse(raw);
      if (type === 'join') {
        if (joined) return;
        joined = true;
        player = spawnPlayer(data?.name);
        sendLobby(ws, player);
      }
      if (!player) return;
      if (type === 'move') {
        player.target = data;
      } else if (type === 'split') {
        handleSplit(player);
      } else if (type === 'eject') {
        handleEject(player);
      } else if (type === 'respawn') {
        if (player) gameState.players.delete(player.id);
        player = spawnPlayer(data?.name || player?.name);
        sendLobby(ws, player);
      }
    } catch (err) {
      console.error('Bad packet', err);
    }
  });

  ws.on('close', () => {
    if (player) {
      gameState.players.delete(player.id);
    }
  });
});

setInterval(tick, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Serwer agar.io startuje na porcie ${PORT}`);
});
