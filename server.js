const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const state = {
  videoId: null,
  playlistId: null,
  queue: [],
  isPlaying: false,
  currentTime: 0,
  lastSyncTime: Date.now()
};

const users = new Map();

function extractYouTubeId(url) {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return match ? match[1] : null;
}

function extractPlaylistId(url) {
  const match = url.match(/[?&]list=([^&]+)/);
  return match ? match[1] : null;
}

function getCalculatedTime() {
  if (state.isPlaying && state.videoId) {
    return state.currentTime + (Date.now() - state.lastSyncTime) / 1000;
  }
  return state.currentTime;
}

// API-free playlist fetcher using Piped's public instance
async function fetchPlaylistVideos(playlistId) {
  try {
    const res = await fetch(`https://pipedapi.kavin.rocks/playlists/${playlistId}`);
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    return data.relatedStreams
      .filter(v => v?.url)
      .map(v => extractYouTubeId(`https://${v.url}`))
      .filter(Boolean);
  } catch (err) {
    console.error('Playlist fetch failed:', err.message);
    return [];
  }
}

io.on('connection', (socket) => {
  socket.emit('promptUsername');

  socket.on('setUsername', async (rawName) => {
    const name = rawName.trim().slice(0, 20) || `User${Math.floor(Math.random()*900)+100}`;
    users.set(socket.id, name);
    io.emit('updateUsers', Array.from(users.values()));

    // Send full current state immediately
    socket.emit('sync', {
      ...state,
      currentTime: getCalculatedTime(),
      users: Array.from(users.values())
    });
  });

  socket.on('changeVideo', (url) => {
    const videoId = extractYouTubeId(url.trim());
    if (videoId) {
      state.videoId = videoId;
      state.isPlaying = true;
      state.currentTime = 0;
      state.lastSyncTime = Date.now();
      io.emit('videoChanged', { ...state, currentTime: 0 });
    }
  });

  socket.on('loadPlaylist', async (url) => {
    const playlistId = extractPlaylistId(url.trim());
    if (!playlistId) return;

    const queue = await fetchPlaylistVideos(playlistId);
    if (queue.length > 0) {
      state.playlistId = playlistId;
      state.queue = queue;
      state.videoId = queue[0];
      state.isPlaying = true;
      state.currentTime = 0;
      state.lastSyncTime = Date.now();
      io.emit('queueUpdated', { ...state, currentTime: 0 });
    }
  });

  socket.on('playNext', () => {
    const idx = state.queue.indexOf(state.videoId);
    if (idx >= 0 && idx < state.queue.length - 1) {
      state.videoId = state.queue[idx + 1];
      state.currentTime = 0;
      state.isPlaying = true;
      state.lastSyncTime = Date.now();
      io.emit('videoChanged', { ...state, currentTime: 0 });
    }
  });

  socket.on('syncState', (clientState) => {
    state.isPlaying = clientState.isPlaying;
    state.currentTime = clientState.currentTime;
    state.lastSyncTime = Date.now();
    io.emit('sync', { ...state, currentTime: clientState.currentTime });
  });

  socket.on('disconnect', () => {
    users.delete(socket.id);
    io.emit('updateUsers', Array.from(users.values()));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 SyncTube running on port ${PORT}`));