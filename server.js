const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Shared playback state
const state = {
  videoId: null,
  isPlaying: false,
  currentTime: 0,
  lastSyncTime: Date.now()
};

// Extract YouTube video ID from various URL formats
function extractYouTubeId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Send current state to new user
  socket.emit('sync', { ...state, currentTime: calculateCurrentTime() });

  // Handle new video submission
  socket.on('changeVideo', (url) => {
    const videoId = extractYouTubeId(url.trim());
    if (videoId) {
      state.videoId = videoId;
      state.isPlaying = true;
      state.currentTime = 0;
      state.lastSyncTime = Date.now();
      io.emit('videoChanged', { ...state });
    }
  });

  // Handle play/pause/seek updates
  socket.on('syncState', (clientState) => {
    // Only accept updates from the user who triggered the action
    state.isPlaying = clientState.isPlaying;
    state.currentTime = clientState.currentTime;
    state.lastSyncTime = Date.now();
    socket.broadcast.emit('sync', { ...state, currentTime: clientState.currentTime });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Calculate real-time playback offset
function calculateCurrentTime() {
  if (state.isPlaying && state.videoId) {
    const elapsed = (Date.now() - state.lastSyncTime) / 1000;
    return Math.max(0, state.currentTime + elapsed);
  }
  return state.currentTime;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 SyncTube server running on http://localhost:${PORT}`);
});