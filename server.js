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
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
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

// Reliable playlist fetcher with fallback instance
async function fetchPlaylistVideos(playlistId) {
  const instances = [
    'https://pipedapi.kavin.rocks',
    'https://api.piped.yt',
    'https://pipedapi.in.projectsegfau.lt'
  ];
  
  for (const base of instances) {
    try {
      const res = await fetch(`${base}/playlists/${playlistId}`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data.relatedStreams?.length) continue;
      
      return data.relatedStreams
        .filter(v => v?.url)
        .map(v => {
          // Piped returns "/watch?v=VIDEO_ID"
          const match = v.url.match(/[?&]v=([^&]+)/);
          return match ? match[1] : null;
        })
        .filter(Boolean);
    } catch (err) {
      console.warn(`Instance ${base} failed, trying next...`);
    }
  }
  return [];
}

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);
  socket.emit('promptUsername');

  socket.on('setUsername', (rawName) => {
    const name = rawName.trim().slice(0, 20) || `User${Math.floor(Math.random() * 900) + 100}`;
    users.set(socket.id, name);
    io.emit('updateUsers', Array.from(users.values()));

    // Send full state immediately after auth
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
      state.playlistId = null;
      state.queue = [];
      state.isPlaying = true;
      state.currentTime = 0;
      state.lastSyncTime = Date.now();
      io.emit('videoChanged', { ...state, currentTime: 0 });
    }
  });

  socket.on('loadPlaylist', async (url) => {
    const playlistId = extractPlaylistId(url.trim());
    if (!playlistId) return;

    socket.emit('status', { type: 'loading', message: 'Fetching playlist...' });
    const queue = await fetchPlaylistVideos(playlistId);

    if (queue.length > 0) {
      state.playlistId = playlistId;
      state.queue = queue;
      state.videoId = queue[0];
      state.isPlaying = true;
      state.currentTime = 0;
      state.lastSyncTime = Date.now();
      io.emit('queueUpdated', { ...state, currentTime: 0 });
    } else {
      socket.emit('status', { type: 'error', message: 'Failed to fetch playlist. Try another link or use YouTube Data API.' });
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