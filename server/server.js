
const socket = io();
let localStream;
let peers = {};
let userId = null;
let username = null;
let token = null;
let isWhiteboardActive = false;
let isDrawing = false;

// Generate a random room ID
function generateRoomId() {
  return 'room-' + Math.random().toString(36).substr(2, 8);
}

// Handle room creation
document.getElementById('create-room').addEventListener('click', () => {
  const roomId = generateRoomId();
  document.getElementById('room-id').value = roomId;
  const shareLink = `${window.location.origin}/room/${roomId}`;
  document.getElementById('generated-room-id').textContent = roomId;
  document.getElementById('room-id-display').style.display = 'block';
});

// Copy shareable room link
document.getElementById('copy-room-link').addEventListener('click', () => {
  const roomId = document.getElementById('generated-room-id').textContent;
  const shareLink = `${window.location.origin}/room/${roomId}`;
  navigator.clipboard.writeText(shareLink).then(() => {
    alert('Room link copied to clipboard!');
  }).catch(err => {
    console.error('Failed to copy room link:', err);
    alert('Failed to copy room link');
  });
});

// Auto-fill room ID from URL
window.addEventListener('load', () => {
  const path = window.location.pathname;
  if (path.startsWith('/room/')) {
    const roomId = path.split('/room/')[1];
    document.getElementById('room-id').value = roomId;
    document.getElementById('generated-room-id').textContent = roomId;
    document.getElementById('room-id-display').style.display = 'block';
  }
});

function toggleAuth() {
  const title = document.getElementById('auth-title');
  const toggle = document.getElementById('auth-toggle');
  const isSignIn = title.textContent === 'Sign In';
  title.textContent = isSignIn ? 'Sign Up' : 'Sign In';
  document.getElementById('username').style.display = isSignIn ? 'block' : 'none';
  toggle.innerHTML = isSignIn
    ? 'Already have an account? <a href="#" onclick="toggleAuth()">Sign In</a>'
    : 'Don\'t have an account? <a href="#" onclick="toggleAuth()">Sign Up</a>';
  document.getElementById('auth-error').textContent = '';
}

async function handleAuth() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const usernameInput = document.getElementById('username').value;
  const isSignIn = document.getElementById('auth-title').textContent === 'Sign In';
  const endpoint = isSignIn ? '/auth/signin' : '/auth/signup';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, username: isSignIn ? undefined : usernameInput }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    if (isSignIn) {
      token = data.token;
      userId = data.userId;
      username = data.username;
      document.getElementById('auth-container').style.display = 'none';
      document.getElementById('room-container').style.display = 'block';
      document.getElementById('user-info').textContent = `Welcome, ${username}`;
      document.getElementById('file-upload-btn').disabled = false; // Enable file upload
    } else {
      document.getElementById('auth-error').textContent = 'Account created! Please sign in.';
      toggleAuth();
    }
  } catch (err) {
    document.getElementById('auth-error').textContent = err.message;
  }
}

function logout() {
  token = null;
  userId = null;
  username = null;
  document.getElementById('room-container').style.display = 'none';
  document.getElementById('auth-container').style.display = 'flex';
  document.getElementById('file-upload-btn').disabled = true; // Disable file upload
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  Object.values(peers).forEach(pc => pc.close());
  peers = {};
  socket.disconnect();
  socket.connect();
}

async function joinRoom() {
  const roomId = document.getElementById('room-id').value.trim();
  if (!roomId) return alert('Please enter a room ID');
  if (!token) return alert('Please sign in to join a room');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    addVideoStream(socket.id, username, localStream, true);
    socket.emit('join-room', { roomId, userId: socket.id }, ({ users, error }) => {
      if (error) return alert(error);
      users.forEach(peerId => {
        if (peerId !== socket.id) createPeerConnection(peerId, roomId);
      });
    });
  } catch (err) {
    console.error('Error accessing media devices:', err);
    alert('Failed to access camera/microphone');
  }
}

function addVideoStream(peerId, peerName, stream, isLocal = false) {
  const videoContainer = document.getElementById('video-container');
  const wrapper = document.createElement('div');
  wrapper.className = 'video-wrapper';
  wrapper.id = `video-${peerId}`;
  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.playsinline = true;
  if (isLocal) video.muted = true;
  const label = document.createElement('div');
  label.className = 'video-label';
  label.textContent = peerName;
  wrapper.appendChild(video);
  wrapper.appendChild(label);
  videoContainer.appendChild(wrapper);
}

function createPeerConnection(peerId, roomId) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });
  peers[peerId] = pc;

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.ontrack = (event) => {
    if (!document.getElementById(`video-${peerId}`)) {
      addVideoStream(peerId, peerId, event.streams[0]);
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { candidate: event.candidate, to: peerId });
    }
  };

  pc.onnegotiationneeded = async () => {
    try {
      await pc.setLocalDescription(await pc.createOffer());
      socket.emit('offer', { offer: pc.localDescription, to: peerId, from: socket.id, roomId });
    } catch (err) {
      console.error('Negotiation error:', err);
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      removeVideoStream(peerId);
      delete peers[peerId];
    }
  };

  return pc;
}

function removeVideoStream(peerId) {
  const wrapper = document.getElementById(`video-${peerId}`);
  if (wrapper) wrapper.remove();
}

socket.on('user-joined', ({ userId: peerId, socketId }) => {
  if (socketId !== socket.id) createPeerConnection(socketId, document.getElementById('room-id').value);
});

socket.on('offer', async ({ offer, from, roomId }) => {
  const pc = peers[from] || createPeerConnection(from, roomId);
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { answer, to: from, from: socket.id });
  } catch (err) {
    console.error('Offer handling error:', err);
  }
});

socket.on('answer', async ({ answer, from }) => {
  const pc = peers[from];
  if (pc) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      console.error('Answer handling error:', err);
    }
  }
});

socket.on('ice-candidate', async ({ candidate, from }) => {
  const pc = peers[from];
  if (pc && pc.remoteDescription) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('ICE candidate error:', err);
    }
  }
});

socket.on('user-left', ({ userId: peerId }) => {
  removeVideoStream(peerId);
  if (peers[peerId]) {
    peers[peerId].close();
    delete peers[peerId];
  }
});

socket.on('toggle-video', ({ userId: peerId, enabled }) => {
  const video = document.querySelector(`#video-${peerId} video`);
  if (video) video.style.display = enabled ? 'block' : 'none';
});

socket.on('toggle-audio', ({ userId: peerId, enabled }) => {
  const video = document.querySelector(`#video-${peerId} video`);
  if (video) video.muted = !enabled;
});

socket.on('screen-share', async ({ userId: peerId, enabled, roomId }) => {
  if (enabled) {
    const video = document.querySelector(`#video-${peerId} video`);
    if (video) {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      video.srcObject = stream;
      stream.getVideoTracks()[0].onended = () => {
        video.srcObject = null;
      };
    }
  } else {
    const video = document.querySelector(`#video-${peerId} video`);
    if (video) video.srcObject = null;
  }
});

document.getElementById('video-toggle').addEventListener('click', () => {
  if (!localStream) return;
  const enabled = localStream.getVideoTracks()[0].enabled;
  localStream.getVideoTracks()[0].enabled = !enabled;
  document.getElementById('video-toggle').classList.toggle('disabled');
  socket.emit('toggle-video', { userId: socket.id, enabled: !enabled, roomId: document.getElementById('room-id').value });
});

document.getElementById('audio-toggle').addEventListener('click', () => {
  if (!localStream) return;
  const enabled = localStream.getAudioTracks()[0].enabled;
  localStream.getAudioTracks()[0].enabled = !enabled;
  document.getElementById('audio-toggle').classList.toggle('disabled');
  socket.emit('toggle-audio', { userId: socket.id, enabled: !enabled, roomId: document.getElementById('room-id').value });
});

document.getElementById('screen-share').addEventListener('click', async () => {
  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const videoTrack = screenStream.getVideoTracks()[0];
    Object.values(peers).forEach(pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(videoTrack);
    });
    document.querySelector(`#video-${socket.id} video`).srcObject = screenStream;
    socket.emit('screen-share', { userId: socket.id, enabled: true, roomId: document.getElementById('room-id').value });
    videoTrack.onended = () => {
      Object.values(peers).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender && localStream) sender.replaceTrack(localStream.getVideoTracks()[0]);
      });
      document.querySelector(`#video-${socket.id} video`).srcObject = localStream;
      socket.emit('screen-share', { userId: socket.id, enabled: false, roomId: document.getElementById('room-id').value });
    };
  } catch (err) {
    console.error('Screen share error:', err);
  }
});

const whiteboard = document.getElementById('whiteboard');
const ctx = whiteboard.getContext('2d');
ctx.strokeStyle = 'black';
ctx.lineWidth = 2;

document.getElementById('whiteboard-toggle').addEventListener('click', () => {
  isWhiteboardActive = !isWhiteboardActive;
  whiteboard.style.display = isWhiteboardActive ? 'block' : 'none';
  if (isWhiteboardActive) {
    whiteboard.width = whiteboard.offsetWidth;
    whiteboard.height = whiteboard.offsetHeight;
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 2;
  }
});

whiteboard.addEventListener('mousedown', (e) => {
  isDrawing = true;
  ctx.beginPath();
  ctx.moveTo(e.offsetX, e.offsetY);
  socket.emit('whiteboard-update', {
    data: { x: e.offsetX, y: e.offsetY, type: 'start' },
    roomId: document.getElementById('room-id').value,
  });
});

whiteboard.addEventListener('mousemove', (e) => {
  if (isDrawing) {
    ctx.lineTo(e.offsetX, e.offsetY);
    ctx.stroke();
    socket.emit('whiteboard-update', {
      data: { x: e.offsetX, y: e.offsetY, prevX: ctx.currentX || e.offsetX, prevY: ctx.currentY || e.offsetY, type: 'draw' },
      roomId: document.getElementById('room-id').value,
    });
    ctx.currentX = e.offsetX;
    ctx.currentY = e.offsetY;
  }
});

whiteboard.addEventListener('mouseup', () => {
  isDrawing = false;
  ctx.currentX = null;
  ctx.currentY = null;
  socket.emit('whiteboard-update', {
    data: { type: 'end' },
    roomId: document.getElementById('room-id').value,
  });
});

socket.on('whiteboard-update', ({ data, roomId }) => {
  if (!isWhiteboardActive) return;
  if (data.type === 'start') {
    ctx.beginPath();
    ctx.moveTo(data.x, data.y);
  } else if (data.type === 'draw') {
    ctx.beginPath();
    ctx.moveTo(data.prevX, data.prevY);
    ctx.lineTo(data.x, data.y);
    ctx.stroke();
  } else if (data.type === 'end') {
    isDrawing = false;
  }
});

document.getElementById('file-input').addEventListener('change', async (e) => {
  if (!token) {
    alert('Please sign in to upload files');
    return;
  }
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);
  try {
    const response = await fetch('/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!response.ok) throw new Error((await response.json()).error || 'Upload failed');
    const { fileUrl, fileName } = await response.json();
    socket.emit('file-shared', { fileName, fileUrl, userId: socket.id, roomId: document.getElementById('room-id').value });
    addFile(fileName, fileUrl, username);
  } catch (err) {
    console.error('File upload error:', err);
    alert('Failed to upload file: ' + err.message);
  }
});

socket.on('file-shared', ({ fileName, fileUrl, userId: peerId }) => {
  addFile(fileName, fileUrl, peerId);
});

function addFile(fileName, fileUrl, userName) {
  const filesContainer = document.getElementById('files-container');
  const fileItem = document.createElement('div');
  fileItem.className = 'file-item';
  fileItem.innerHTML = `
    <a href="${fileUrl}" target="_blank">${fileName}</a>
    <span>Shared by ${userName}</span>
  `;
  filesContainer.appendChild(fileItem);
}

// const express = require('express');
// const http = require('http');
// const fs = require('fs');
// const socketIO = require('socket.io');
// const multer = require('multer');
// const path = require('path');
// const { authRoutes, authenticateToken } = require('./auth');
// const cors = require('cors');

// const app = express();
// const server = http.createServer(app);
// const io = socketIO(server, { cors: { origin: process.env.CLIENT_URL || '*' } });

// // Ensure Uploads folder exists
// const uploadDir = path.join(__dirname, 'Uploads');
// if (!fs.existsSync(uploadDir)) {
//   fs.mkdirSync(uploadDir, { recursive: true });
// }

// app.use(express.json());
// app.use(cors());
// app.use(express.static(path.join(__dirname, '../client')));
// app.use('/uploads', express.static(uploadDir));

// app.use('/auth', authRoutes);
// app.get('/room/:roomId', (req, res) => {
//   res.sendFile(path.join(__dirname, '../client/index.html'));
// });

// // File Upload Setup
// const storage = multer.diskStorage({
//   destination: uploadDir,
//   filename: (req, file, cb) => {
//     cb(null, `${Date.now()}-${file.originalname}`);
//   },
// });
// const upload = multer({ storage });

// // Socket.IO Logic
// const rooms = new Map();
// io.on('connection', (socket) => {
//   console.log('User connected:', socket.id);

//   socket.on('join-room', ({ roomId, userId }, callback) => {
//     try {
//       if (!roomId || !userId || typeof roomId !== 'string' || roomId.length > 50) {
//         return callback({ error: 'Invalid room ID or user ID' });
//       }
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
//     socket.to(to).emit('ice-candidate', { candidate, from: socket.id });
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
//     socket.to(roomId).emit('whiteboard-update', { data, roomId });
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

// // File Upload Route
// app.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
//   try {
//     const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
//     res.json({ fileUrl, fileName: req.file.originalname });
//   } catch (err) {
//     console.error('File upload error:', err);
//     res.status(500).json({ error: 'Failed to upload file' });
//   }
// });

// // Start Server
// const PORT = process.env.PORT || 8080;
// server.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
// });

