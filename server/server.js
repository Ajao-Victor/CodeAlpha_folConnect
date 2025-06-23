const express = require('express');
const https = require('https');
const fs = require('fs');
const socketIO = require('socket.io');
const multer = require('multer');
const path = require('path');
const { authRoutes, authenticateToken } = require('./auth');
const cors = require('cors');

const app = express();
const serverOptions = {
  key: fs.readFileSync(path.join(__dirname, 'cert/server.key')),
  cert: fs.readFileSync(path.join(__dirname, 'cert/server.cert')),
};
const server = https.createServer(serverOptions, app);
const io = socketIO(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, '../client')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


app.use('/auth', authRoutes);
app.get('/room/:roomId', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// File Upload Setup
const storage = multer.diskStorage({
  destination: './Uploads/',
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage });

// Socket.IO Logic path in the server
const rooms = new Map();
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', ({ roomId, userId }, callback) => {
    try {
      if (!roomId || !userId || typeof roomId !== 'string' || roomId.length > 50) {
        return callback({ error: 'Invalid room ID or user ID' });
      }
      socket.join(roomId);
      if (!rooms.has(roomId)) rooms.set(roomId, new Set());
      rooms.get(roomId).add(userId);
      socket.to(roomId).emit('user-joined', { userId, socketId: socket.id });
      callback({ users: Array.from(rooms.get(roomId)) });
      console.log(`${userId} joined room ${roomId}`);
    } catch (err) {
      console.error('Join room error:', err);
      callback({ error: 'Failed to join room' });
    }
  });

  socket.on('offer', ({ offer, to, from, roomId }) => {
    socket.to(to).emit('offer', { offer, from, roomId });
  });

  socket.on('answer', ({ answer, to, from }) => {
    socket.to(to).emit('answer', { answer, from });
  });

  socket.on('ice-candidate', ({ candidate, to }) => {
    socket.to(to).emit('ice-candidate', { candidate });
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
    socket.to(roomId).emit('whiteboard-update', data);
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
    console.log('User disconnected:', socket.id);
  });
});

// File Upload Route
app.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ fileUrl, fileName: req.file.originalname });
  } catch (err) {
    console.error('File upload error:', err);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Start Server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server running on https://localhost:${PORT}`);
});



// const express = require('express');
// const https = require('https');
// const fs = require('fs');
// const socketIO = require('socket.io');
// const multer = require('multer');
// const path = require('path');
// const { authRoutes, authenticateToken } = require('./auth');
// const cors = require('cors');

// const app = express();
// const serverOptions = {
//   key: fs.readFileSync(path.join(__dirname, 'cert/server.key')),
//   cert: fs.readFileSync(path.join(__dirname, 'cert/server.cert')),
// };
// const server = https.createServer(serverOptions, app);
// const io = socketIO(server, {cors: { origin: '*' }});


// app.use(express.json());
// app.use(cors());
// app.use(express.static(path.join(__dirname, '../client')));
// app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


// app.use('/auth', authRoutes);


// const storage = multer.diskStorage({
//   destination: './uploads/',
//   filename: (req, file, cb) => {
//     cb(null, `${Date.now()}-${file.originalname}`);
//   },
// });
// const upload = multer({ storage });


// const rooms = new Map(); // Store room participants
// io.on('connection', (socket) => {
//   console.log('User connected:', socket.id);

//   socket.on('join-room', ({ roomId, userId }, callback) => {
//     try {
//       socket.join(roomId);
//       if (!rooms.has(roomId)) rooms.set(roomId, new Set());
//       rooms.get(roomId).add(userId);
//       socket.to(roomId).emit('user-joined', { userId, socketId: socket.id });
//       callback({ users: Array.from(rooms.get(roomId)) });
//       console.log(`${userId} joined room ${roomId}`);
//     } catch (err) {
//       console.error('Join room error:', err);
//       callback({ error: 'Failed to join room' });
//     }
//   });

//   socket.on('offer', ({ offer, to, from, roomId }) => {
//     socket.to(to).emit('offer', { offer, from, roomId });
//   });

//   socket.on('answer', ({ answer, to, from }) => {
//     socket.to(to).emit('answer', { answer, from });
//   });

//   socket.on('ice-candidate', ({ candidate, to }) => {
//     socket.to(to).emit('ice-candidate', { candidate });
//   });

//   socket.on('toggle-video', ({ userId, enabled, roomId }) => {
//     socket.to(roomId).emit('toggle-video', { userId, enabled });
//   });

//   socket.on('toggle-audio', ({ userId, enabled, roomId }) => {
//     socket.to(roomId).emit('toggle-audio', { userId, enabled });
//   });

//   socket.on('screen-share', ({ userId, enabled, roomId }) => {
//     socket.to(roomId).emit('screen-share', { userId, enabled });
//   });

//   socket.on('whiteboard-update', ({ data, roomId }) => {
//     socket.to(roomId).emit('whiteboard-update', data);
//   });

//   socket.on('file-shared', ({ fileName, fileUrl, userId, roomId }) => {
//     socket.to(roomId).emit('file-shared', { fileName, fileUrl, userId });
//   });

//   socket.on('disconnect', () => {
//     rooms.forEach((users, roomId) => {
//       if (users.has(socket.id)) {
//         users.delete(socket.id);
//         socket.to(roomId).emit('user-left', { userId: socket.id });
//         if (users.size === 0) rooms.delete(roomId);
//       }
//     });
//     console.log('User disconnected:', socket.id);
//   });
// });


// app.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
//   try {
//     const fileUrl = `/uploads/${req.file.filename}`;
//     res.json({ fileUrl, fileName: req.file.originalname });
//   } catch (err) {
//     console.error('File upload error:', err);
//     res.status(500).json({ error: 'Failed to upload file' });
//   }
// });


// const PORT = process.env.PORT || 8080;
// server.listen(PORT, () => {
//   console.log(`Server running on https://localhost:${PORT}`);
// });