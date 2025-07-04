const express = require('express');
const http = require('http');
const fs = require('fs');
const socketIO = require('socket.io');
const multer = require('multer');
const path = require('path');
const { authRoutes, authenticateToken } = require('./auth');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: process.env.CLIENT_URL || '*' },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Ensure Uploads folder exists in the code setup
const uploadDir = path.join(__dirname, 'Uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

//Application of appropriate middlewares
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, '../client')));
app.use('/Uploads', express.static(uploadDir));

app.use('/auth', authRoutes);
app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// File Upload Setup
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage });

// Socket.IO backend Logic
const rooms = new Map();
const usernames = new Map(); // Store username by socket.id
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', ({ roomId, userId, username }, callback) => {
    try {
      if (!roomId || !userId || typeof roomId !== 'string' || roomId.length > 50) {
        console.error(`Invalid join-room attempt: roomId=${roomId}, userId=${userId}`);
        return callback({ error: 'Invalid room ID or user ID' });
      }
      socket.join(roomId);
      if (!rooms.has(roomId)) rooms.set(roomId, new Set());
      rooms.get(roomId).add(userId);
      usernames.set(socket.id, username); // Store username
      socket.to(roomId).emit('user-joined', { userId, socketId: socket.id, username });
      socket.to(roomId).emit('new-user-joined', { userId: socket.id, username, roomId });
      callback({ users: Array.from(rooms.get(roomId)) });
      console.log(`${userId} (${username}) joined room ${roomId}`);
    } catch (err) {
      console.error('Join room error:', err);
      callback({ error: 'Failed to join room' });
    }
  });

  socket.on('offer', ({ offer, to, from, roomId }) => {
    socket.to(to).emit('offer', { offer, from, roomId });
    console.log(`Forwarded offer from ${from} to ${to} in room ${roomId}`);
  });

  socket.on('answer', ({ answer, to, from }) => {
    socket.to(to).emit('answer', { answer, from });
    console.log(`Forwarded answer from ${from} to ${to}`);
  });

  socket.on('ice-candidate', ({ candidate, to }) => {
    socket.to(to).emit('ice-candidate', { candidate, from: socket.id });
    console.log(`Forwarded ICE candidate from ${socket.id} to ${to}`);
  });

  socket.on('toggle-video', ({ userId, enabled, roomId }) => {
    socket.to(roomId).emit('toggle-video', { userId, enabled });
  });

  socket.on('toggle-audio', ({ userId, enabled, roomId }) => {
    socket.to(roomId).emit('toggle-audio', { userId, enabled });
  });

  socket.on('screen-share', ({ userId, enabled, roomId }) => {
    socket.to(roomId).emit('screen-share', { userId, enabled });
  });

  socket.on('whiteboard-update', ({ data, roomId }) => {
    socket.to(roomId).emit('whiteboard-update', { data, roomId });
  });

  socket.on('file-shared', ({ fileName, fileUrl, userId, roomId }) => {
    socket.to(roomId).emit('file-shared', { fileName, fileUrl, userId });
  });

  socket.on('disconnect', () => {
    rooms.forEach((users, roomId) => {
      if (users.has(socket.id)) {
        users.delete(socket.id);
        socket.to(roomId).emit('user-left', { userId: socket.id });
        if (users.size === 0) rooms.delete(roomId);
      }
    });
    usernames.delete(socket.id); // Clean up username
    console.log('User disconnected:', socket.id);
  });
});

// File Upload Route
app.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const fileUrl = `${req.protocol}://${req.get('host')}/Uploads/${req.file.filename}`;
    res.json({ fileUrl, fileName: req.file.originalname });
  } catch (err) {
    console.error('File upload error:', err);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Health Check
app.get('/health', (req, res) => res.send('Server is up perfectly!'));

// Start Server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});