const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { debug } = require('console');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const apiKey = "AIzaSyAvtYp0cTlacd3TdWqOkPrGzMZSSQ2ZAEI";


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

async function fetchPlaylistVideos(playlistId, apiKey) {
  const videos = [];
  let pageToken = '';
  do {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${playlistId}&maxResults=50&pageToken=${pageToken}&key=${apiKey}`
    );
    const data = await res.json();
    videos.push(...(data.items?.map(i => i.contentDetails?.videoId).filter(Boolean) || []));
    pageToken = data.nextPageToken;
  } while (pageToken && videos.length < 50); // Limit to 50 for free tier
  return videos;
}

io.on('connection', (socket) => {
  console.log('🟢 Connected:', socket.id);
  socket.emit('promptUsername');

  socket.on('setUsername', (rawName) => {
    const name = rawName.trim().slice(0, 20) || `User${Math.floor(Math.random() * 900) + 100}`;
    users.set(socket.id, name);
    io.emit('updateUsers', Array.from(users.values()));
    socket.emit('sync', { ...state, currentTime: getCalculatedTime(), users: Array.from(users.values()) });
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
    } else {
      socket.emit('status', { type: 'error', message: 'Invalid YouTube URL' });
    }
  });

  socket.on('loadPlaylist', async (url) => {
    const playlistId = extractPlaylistId(url.trim());
    console.log(playlistId);
    if (!playlistId) {
      socket.emit('status', { type: 'error', message: '❌ Invalid playlist. Must contain ?list=...' });
      return;
    }

    socket.emit('status', { type: 'loading', message: '🔄 Fetching playlist...' });
    console.log(`[Playlist] Fetching: ${playlistId}`);

    try {
      const queue = await fetchPlaylistVideos(playlistId, apiKey);
      if (queue.length === 0) {
        socket.emit('status', { type: 'error', message: '⚠️ Empty playlist or all APIs blocked. Try another link.' });
        return;
      }

      state.playlistId = playlistId;
      state.queue = queue;
      state.videoId = queue[0];
      state.isPlaying = true;
      state.currentTime = 0;
      state.lastSyncTime = Date.now();

      io.emit('queueUpdated', { ...state, currentTime: 0 });
      console.log(`[Playlist] ✅ Loaded ${queue.length} videos`);
    } catch (err) {
      console.error('[Playlist] ❌ Server error:', err);
      socket.emit('status', { type: 'error', message: '⚠️ Server failed to fetch playlist.' });
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