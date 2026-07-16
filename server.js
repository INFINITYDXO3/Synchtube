const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));

const state = { videoId: null, isPlaying: false, currentTime: 0, lastSync: Date.now() };

function getCurrentTime() {
  if (state.isPlaying && state.videoId) {
    return state.currentTime + (Date.now() - state.lastSync) / 1000;
  }
  return state.currentTime;
}

io.on('connection', socket => {
  socket.emit('sync', { ...state, currentTime: getCurrentTime() });

  socket.on('load', url => {
    const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
    if (match) {
      state.videoId = match[1]; state.isPlaying = true;
      state.currentTime = 0; state.lastSync = Date.now();
      io.emit('sync', { ...state, currentTime: 0 });
    }
  });

  socket.on('playerState', data => {
    state.isPlaying = data.isPlaying;
    state.currentTime = data.currentTime;
    state.lastSync = Date.now();
    socket.broadcast.emit('sync', { ...state, currentTime: data.currentTime });
  });

  socket.on('disconnect', () => console.log('left'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));