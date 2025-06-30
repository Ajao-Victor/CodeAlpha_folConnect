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
      document.getElementById('file-upload-btn').disabled = false;
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
  document.getElementById('file-upload-btn').disabled = true;
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
    console.log('Local stream tracks:', localStream.getTracks());
    addVideoStream(socket.id, username, localStream, true);
    socket.emit('join-room', { roomId, userId: socket.id, username }, ({ users, error }) => {
      if (error) return alert(error);
      console.log('Joined room, users:', users);
      users.forEach(peerId => {
        if (peerId !== socket.id) createPeerConnection(peerId, roomId);
      });
    });
  } catch (err) {
    console.error('Error accessing media devices:', err);
    alert('Failed to access camera/microphone. Please check permissions.');
  }
}

function addVideoStream(peerId, peerName, stream, isLocal = false) {
  const videoContainer = document.getElementById('video-container');
  let wrapper = document.getElementById(`video-${peerId}`);
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = 'video-wrapper';
    wrapper.id = `video-${peerId}`;
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsinline = true;
    if (isLocal) video.muted = true;
    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = peerName || 'Unknown';
    wrapper.appendChild(video);
    wrapper.appendChild(label);
    videoContainer.appendChild(wrapper);
  }
  const video = wrapper.querySelector('video');
  video.srcObject = stream;
  console.log(`Added video stream for ${peerName} (${peerId}), isLocal: ${isLocal}, stream active: ${stream?.active}, tracks:`, stream?.getTracks());
}

function createPeerConnection(peerId, roomId) {
  console.log(`Creating peer connection for ${peerId} in room ${roomId}`);
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  });
  pc.peerId = peerId; // Store peerId for re-negotiation
  peers[peerId] = pc;

  // Buffer ICE candidates
  const iceCandidates = [];
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      if (pc.remoteDescription) {
        socket.emit('ice-candidate', { candidate: event.candidate, to: peerId });
        console.log(`Sent ICE candidate to ${peerId}`);
      } else {
        iceCandidates.push(event.candidate);
        console.log(`Buffered ICE candidate for ${peerId}`);
      }
    }
  };

  // Add tracks
  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
      console.log(`Added track: ${track.kind} for ${peerId}`);
    });
  } else {
    console.error(`No local stream for ${peerId}`);
  }

  pc.ontrack = (event) => {
    console.log(`Received track for ${peerId}:`, event.streams);
    const stream = event.streams[0];
    if (stream) {
      const peerName = usernames.get(peerId) || peerId;
      addVideoStream(peerId, peerName, stream);
    }
  };

  pc.onnegotiationneeded = async () => {
    if (pc.signalingState === 'stable') {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log(`Sending offer to ${peerId}, signalingState: ${pc.signalingState}`);
        socket.emit('offer', { offer: pc.localDescription, to: peerId, from: socket.id, roomId });
      } catch (err) {
        console.error('Negotiation error:', err);
      }
    } else {
      console.log(`Skipping offer for ${peerId}, signalingState: ${pc.signalingState}`);
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`ICE connection state for ${peerId}: ${pc.iceConnectionState}`);
    if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
      removeVideoStream(peerId);
      delete peers[peerId];
    }
    if (pc.iceConnectionState === 'connected') {
      iceCandidates.forEach(candidate => {
        socket.emit('ice-candidate', { candidate, to: peerId });
        console.log(`Sent buffered ICE candidate to ${peerId}`);
      });
      iceCandidates.length = 0;
    }
  };

  return pc;
}

function removeVideoStream(peerId) {
  const wrapper = document.getElementById(`video-${peerId}`);
  if (wrapper) wrapper.remove();
  console.log(`Removed video stream for ${peerId}`);
}

// Store usernames and buffered offers
const usernames = new Map();
const bufferedOffers = new Map();
socket.on('user-joined', ({ userId: peerId, socketId, username: peerName }) => {
  if (socketId !== socket.id) {
    usernames.set(socketId, peerName);
    createPeerConnection(socketId, document.getElementById('room-id').value);
    console.log(`User ${peerName} (${socketId}) joined`);
  }
});

socket.on('offer', async ({ offer, from, roomId }) => {
  console.log(`Received offer from ${from}, signalingState: ${peers[from]?.signalingState}`);
  const pc = peers[from] || createPeerConnection(from, roomId);
  if (pc.signalingState === 'stable') {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log(`Sending answer to ${from}, signalingState: ${pc.signalingState}`);
      socket.emit('answer', { answer, to: from, from: socket.id });
    } catch (err) {
      console.error('Offer handling error:', err);
    }
  } else if (pc.signalingState === 'have-local-offer') {
    console.log(`Offer collision from ${from}, buffering offer`);
    bufferedOffers.set(from, { offer, roomId });
    // Prioritize based on socket.id
    if (socket.id < from) {
      console.log(`Rolling back offer for ${from} as ${socket.id} has priority`);
      try {
        await pc.setLocalDescription(new RTCSessionDescription({ type: 'rollback' }));
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log(`Sending answer to ${from} after rollback, signalingState: ${pc.signalingState}`);
        socket.emit('answer', { answer, to: from, from: socket.id });
      } catch (err) {
        console.error('Rollback error:', err);
      }
    }
  } else {
    console.log(`Ignoring offer from ${from}, invalid signalingState: ${pc.signalingState}`);
  }
});

socket.on('answer', async ({ answer, from }) => {
  const pc = peers[from];
  if (pc && pc.signalingState === 'have-local-offer') {
    try {
      console.log(`Received answer from ${from}, signalingState: ${pc.signalingState}`);
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      // Retry buffered offer if exists
      if (bufferedOffers.has(from)) {
        const { offer, roomId } = bufferedOffers.get(from);
        console.log(`Retrying buffered offer from ${from}`);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const newAnswer = await pc.createAnswer();
        await pc.setLocalDescription(newAnswer);
        socket.emit('answer', { answer: newAnswer, to: from, from: socket.id });
        bufferedOffers.delete(from);
      }
    } catch (err) {
      console.error('Answer handling error:', err);
    }
  } else {
    console.log(`Ignoring answer from ${from}, invalid signalingState: ${pc?.signalingState}`);
  }
});

socket.on('ice-candidate', async ({ candidate, from }) => {
  const pc = peers[from];
  if (pc && pc.remoteDescription) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
      console.log(`Added ICE candidate from ${from}`);
    } catch (err) {
      console.error('ICE candidate error:', err);
    }
  } else {
    console.log(`Ignoring ICE candidate from ${from}, no remote description`);
  }
});

socket.on('user-left', ({ userId: peerId }) => {
  removeVideoStream(peerId);
  if (peers[peerId]) {
    peers[peerId].close();
    delete peers[peerId];
  }
  usernames.delete(peerId);
  bufferedOffers.delete(peerId);
  console.log(`User ${peerId} left`);
});

socket.on('toggle-video', ({ userId: peerId, enabled }) => {
  const video = document.querySelector(`#video-${peerId} video`);
  if (video) {
    video.style.display = enabled ? 'block' : 'none';
    console.log(`Toggle video for ${peerId}: ${enabled}`);
  }
});

socket.on('toggle-audio', ({ userId: peerId, enabled }) => {
  const video = document.querySelector(`#video-${peerId} video`);
  if (video) {
    video.muted = !enabled;
    console.log(`Toggle audio for ${peerId}: ${enabled}`);
  }
});

socket.on('screen-share', async ({ userId: peerId, enabled }) => {
  const video = document.querySelector(`#video-${peerId} video`);
  if (video) {
    if (enabled) {
      console.log(`Screen share started for ${peerId}`);
    } else {
      video.srcObject = null;
      console.log(`Screen share stopped for ${peerId}`);
    }
  }
});

document.getElementById('video-toggle').addEventListener('click', () => {
  if (!localStream) return;
  const enabled = localStream.getVideoTracks()[0].enabled;
  localStream.getVideoTracks()[0].enabled = !enabled;
  document.getElementById('video-toggle').classList.toggle('disabled');
  socket.emit('toggle-video', { userId: socket.id, enabled: !enabled, roomId: document.getElementById('room-id').value });
  console.log(`Video toggle: ${!enabled}`);
  // Re-add tracks and trigger re-negotiation
  Object.values(peers).forEach(pc => {
    if (localStream && pc.signalingState === 'stable') {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
        console.log(`Re-added track: ${track.kind} for ${pc.peerId}`);
      });
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
          socket.emit('offer', { offer: pc.localDescription, to: pc.peerId, from: socket.id, roomId: document.getElementById('room-id').value });
          console.log(`Sent re-negotiation offer for ${pc.peerId}`);
        })
        .catch(err => console.error('Re-negotiation error:', err));
    }
  });
});

document.getElementById('audio-toggle').addEventListener('click', () => {
  if (!localStream) return;
  const enabled = localStream.getAudioTracks()[0].enabled;
  localStream.getAudioTracks()[0].enabled = !enabled;
  document.getElementById('audio-toggle').classList.toggle('disabled');
  socket.emit('toggle-audio', { userId: socket.id, enabled: !enabled, roomId: document.getElementById('room-id').value });
  console.log(`Audio toggle: ${!enabled}`);
});

document.getElementById('screen-share').addEventListener('click', async () => {
  if (!localStream) return;
  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const videoTrack = screenStream.getVideoTracks()[0];
    Object.values(peers).forEach(pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        sender.replaceTrack(videoTrack);
        console.log(`Replaced video track for peer ${pc.peerId}`);
      }
    });
    document.querySelector(`#video-${socket.id} video`).srcObject = screenStream;
    socket.emit('screen-share', { userId: socket.id, enabled: true, roomId: document.getElementById('room-id').value });
    console.log('Screen share started');
    videoTrack.onended = () => {
      Object.values(peers).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender && localStream) {
          sender.replaceTrack(localStream.getVideoTracks()[0]);
          console.log(`Restored camera track for peer ${pc.peerId}`);
        }
      });
      document.querySelector(`#video-${socket.id} video`).srcObject = localStream;
      socket.emit('screen-share', { userId: socket.id, enabled: false, roomId: document.getElementById('room-id').value });
      console.log('Screen share ended');
    };
  } catch (err) {
    console.error('Screen share error:', err);
    alert('Failed to share screen: ' + err.message);
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
  const peerName = usernames.get(peerId) || peerId;
  addFile(fileName, fileUrl, peerName);
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

// Debug Socket.IO connection
socket.on('connect', () => console.log('Socket.IO connected'));
socket.on('connect_error', (err) => console.error('Socket.IO error:', err));



// const socket = io();
// let localStream;
// let peers = {};
// let userId = null;
// let username = null;
// let token = null;
// let isWhiteboardActive = false;
// let isDrawing = false;

// // Generate a random room ID
// function generateRoomId() {
//   return 'room-' + Math.random().toString(36).substr(2, 8);
// }

// // Handle room creation
// document.getElementById('create-room').addEventListener('click', () => {
//   const roomId = generateRoomId();
//   document.getElementById('room-id').value = roomId;
//   const shareLink = `${window.location.origin}/room/${roomId}`;
//   document.getElementById('generated-room-id').textContent = roomId;
//   document.getElementById('room-id-display').style.display = 'block';
// });

// // Copy shareable room link
// document.getElementById('copy-room-link').addEventListener('click', () => {
//   const roomId = document.getElementById('generated-room-id').textContent;
//   const shareLink = `${window.location.origin}/room/${roomId}`;
//   navigator.clipboard.writeText(shareLink).then(() => {
//     alert('Room link copied to clipboard!');
//   }).catch(err => {
//     console.error('Failed to copy room link:', err);
//     alert('Failed to copy room link');
//   });
// });

// // Auto-fill room ID from URL
// window.addEventListener('load', () => {
//   const path = window.location.pathname;
//   if (path.startsWith('/room/')) {
//     const roomId = path.split('/room/')[1];
//     document.getElementById('room-id').value = roomId;
//     document.getElementById('generated-room-id').textContent = roomId;
//     document.getElementById('room-id-display').style.display = 'block';
//   }
// });

// function toggleAuth() {
//   const title = document.getElementById('auth-title');
//   const toggle = document.getElementById('auth-toggle');
//   const isSignIn = title.textContent === 'Sign In';
//   title.textContent = isSignIn ? 'Sign Up' : 'Sign In';
//   document.getElementById('username').style.display = isSignIn ? 'block' : 'none';
//   toggle.innerHTML = isSignIn
//     ? 'Already have an account? <a href="#" onclick="toggleAuth()">Sign In</a>'
//     : 'Don\'t have an account? <a href="#" onclick="toggleAuth()">Sign Up</a>';
//   document.getElementById('auth-error').textContent = '';
// }

// async function handleAuth() {
//   const email = document.getElementById('email').value;
//   const password = document.getElementById('password').value;
//   const usernameInput = document.getElementById('username').value;
//   const isSignIn = document.getElementById('auth-title').textContent === 'Sign In';
//   const endpoint = isSignIn ? '/auth/signin' : '/auth/signup';
//   try {
//     const response = await fetch(endpoint, {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ email, password, username: isSignIn ? undefined : usernameInput }),
//     });
//     const data = await response.json();
//     if (!response.ok) throw new Error(data.error);
//     if (isSignIn) {
//       token = data.token;
//       userId = data.userId;
//       username = data.username;
//       document.getElementById('auth-container').style.display = 'none';
//       document.getElementById('room-container').style.display = 'block';
//       document.getElementById('user-info').textContent = `Welcome, ${username}`;
//       document.getElementById('file-upload-btn').disabled = false;
//     } else {
//       document.getElementById('auth-error').textContent = 'Account created! Please sign in.';
//       toggleAuth();
//     }
//   } catch (err) {
//     document.getElementById('auth-error').textContent = err.message;
//   }
// }

// function logout() {
//   token = null;
//   userId = null;
//   username = null;
//   document.getElementById('room-container').style.display = 'none';
//   document.getElementById('auth-container').style.display = 'flex';
//   document.getElementById('file-upload-btn').disabled = true;
//   if (localStream) {
//     localStream.getTracks().forEach(track => track.stop());
//     localStream = null;
//   }
//   Object.values(peers).forEach(pc => pc.close());
//   peers = {};
//   socket.disconnect();
//   socket.connect();
// }

// async function joinRoom() {
//   const roomId = document.getElementById('room-id').value.trim();
//   if (!roomId) return alert('Please enter a room ID');
//   if (!token) return alert('Please sign in to join a room');
//   try {
//     localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
//     addVideoStream(socket.id, username, localStream, true);
//     socket.emit('join-room', { roomId, userId: socket.id, username }, ({ users, error }) => {
//       if (error) return alert(error);
//       console.log('Joined room, users:', users);
//       users.forEach(peerId => {
//         if (peerId !== socket.id) createPeerConnection(peerId, roomId);
//       });
//     });
//   } catch (err) {
//     console.error('Error accessing media devices:', err);
//     alert('Failed to access camera/microphone. Please check permissions.');
//   }
// }

// function addVideoStream(peerId, peerName, stream, isLocal = false) {
//   const videoContainer = document.getElementById('video-container');
//   let wrapper = document.getElementById(`video-${peerId}`);
//   if (!wrapper) {
//     wrapper = document.createElement('div');
//     wrapper.className = 'video-wrapper';
//     wrapper.id = `video-${peerId}`;
//     const video = document.createElement('video');
//     video.autoplay = true;
//     video.playsinline = true;
//     if (isLocal) video.muted = true;
//     const label = document.createElement('div');
//     label.className = 'video-label';
//     label.textContent = peerName || 'Unknown';
//     wrapper.appendChild(video);
//     wrapper.appendChild(label);
//     videoContainer.appendChild(wrapper);
//   }
//   const video = wrapper.querySelector('video');
//   video.srcObject = stream;
//   console.log(`Added video stream for ${peerName} (${peerId}), isLocal: ${isLocal}, stream:`, stream);
// }

// function createPeerConnection(peerId, roomId) {
//   console.log(`Creating peer connection for ${peerId} in room ${roomId}`);
//   const pc = new RTCPeerConnection({
//     iceServers: [
//       { urls: 'stun:stun.l.google.com:19302' },
//       { urls: 'stun:stun1.l.google.com:19302' },
//     ],
//   });
//   peers[peerId] = pc;

//   // Buffer ICE candidates until remote description is set
//   const iceCandidates = [];
//   pc.onicecandidate = (event) => {
//     if (event.candidate) {
//       if (pc.remoteDescription) {
//         socket.emit('ice-candidate', { candidate: event.candidate, to: peerId });
//         console.log(`Sent ICE candidate to ${peerId}`);
//       } else {
//         iceCandidates.push(event.candidate);
//         console.log(`Buffered ICE candidate for ${peerId}`);
//       }
//     }
//   };

//   // Add tracks
//   if (localStream) {
//     localStream.getTracks().forEach(track => {
//       pc.addTrack(track, localStream);
//       console.log(`Added track: ${track.kind} for ${peerId}`);
//     });
//   } else {
//     console.error(`No local stream for ${peerId}`);
//   }

//   pc.ontrack = (event) => {
//     console.log(`Received track for ${peerId}:`, event.streams);
//     const stream = event.streams[0];
//     if (stream) {
//       const peerName = usernames.get(peerId) || peerId;
//       addVideoStream(peerId, peerName, stream);
//     }
//   };

//   pc.onnegotiationneeded = async () => {
//     try {
//       const offer = await pc.createOffer();
//       await pc.setLocalDescription(offer);
//       console.log(`Sending offer to ${peerId}`);
//       socket.emit('offer', { offer: pc.localDescription, to: peerId, from: socket.id, roomId });
//     } catch (err) {
//       console.error('Negotiation error:', err);
//     }
//   };

//   pc.oniceconnectionstatechange = () => {
//     console.log(`ICE connection state for ${peerId}: ${pc.iceConnectionState}`);
//     if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
//       removeVideoStream(peerId);
//       delete peers[peerId];
//     }
//   };

//   // Apply buffered ICE candidates after setting remote description
//   pc.onremotedescription = () => {
//     iceCandidates.forEach(candidate => {
//       socket.emit('ice-candidate', { candidate, to: peerId });
//       console.log(`Sent buffered ICE candidate to ${peerId}`);
//     });
//     iceCandidates.length = 0;
//   };

//   return pc;
// }

// function removeVideoStream(peerId) {
//   const wrapper = document.getElementById(`video-${peerId}`);
//   if (wrapper) wrapper.remove();
//   console.log(`Removed video stream for ${peerId}`);
// }

// // Store usernames from user-joined event
// const usernames = new Map();
// socket.on('user-joined', ({ userId: peerId, socketId, username: peerName }) => {
//   if (socketId !== socket.id) {
//     usernames.set(socketId, peerName);
//     createPeerConnection(socketId, document.getElementById('room-id').value);
//     console.log(`User ${peerName} (${socketId}) joined`);
//   }
// });

// socket.on('offer', async ({ offer, from, roomId }) => {
//   console.log(`Received offer from ${from}`);
//   const pc = peers[from] || createPeerConnection(from, roomId);
//   try {
//     await pc.setRemoteDescription(new RTCSessionDescription(offer));
//     const answer = await pc.createAnswer();
//     await pc.setLocalDescription(answer);
//     console.log(`Sending answer to ${from}`);
//     socket.emit('answer', { answer, to: from, from: socket.id });
//   } catch (err) {
//     console.error('Offer handling error:', err);
//   }
// });

// socket.on('answer', async ({ answer, from }) => {
//   const pc = peers[from];
//   if (pc) {
//     try {
//       console.log(`Received answer from ${from}`);
//       await pc.setRemoteDescription(new RTCSessionDescription(answer));
//     } catch (err) {
//       console.error('Answer handling error:', err);
//     }
//   }
// });

// socket.on('ice-candidate', async ({ candidate, from }) => {
//   const pc = peers[from];
//   if (pc) {
//     try {
//       await pc.addIceCandidate(new RTCIceCandidate(candidate));
//       console.log(`Added ICE candidate from ${from}`);
//     } catch (err) {
//       console.error('ICE candidate error:', err);
//     }
//   }
// });

// socket.on('user-left', ({ userId: peerId }) => {
//   removeVideoStream(peerId);
//   if (peers[peerId]) {
//     peers[peerId].close();
//     delete peers[peerId];
//   }
//   usernames.delete(peerId);
//   console.log(`User ${peerId} left`);
// });

// socket.on('toggle-video', ({ userId: peerId, enabled }) => {
//   const video = document.querySelector(`#video-${peerId} video`);
//   if (video) video.style.display = enabled ? 'block' : 'none';
//   console.log(`Toggle video for ${peerId}: ${enabled}`);
// });

// socket.on('toggle-audio', ({ userId: peerId, enabled }) => {
//   const video = document.querySelector(`#video-${peerId} video`);
//   if (video) video.muted = !enabled;
//   console.log(`Toggle audio for ${peerId}: ${enabled}`);
// });

// socket.on('screen-share', async ({ userId: peerId, enabled }) => {
//   const video = document.querySelector(`#video-${peerId} video`);
//   if (video) {
//     if (enabled) {
//       video.srcObject = null; // Clear until new stream arrives via WebRTC
//       console.log(`Screen share started for ${peerId}`);
//     } else {
//       video.srcObject = null;
//       console.log(`Screen share stopped for ${peerId}`);
//     }
//   }
// });

// document.getElementById('video-toggle').addEventListener('click', () => {
//   if (!localStream) return;
//   const enabled = localStream.getVideoTracks()[0].enabled;
//   localStream.getVideoTracks()[0].enabled = !enabled;
//   document.getElementById('video-toggle').classList.toggle('disabled');
//   socket.emit('toggle-video', { userId: socket.id, enabled: !enabled, roomId: document.getElementById('room-id').value });
//   console.log(`Video toggle: ${!enabled}`);
// });

// document.getElementById('audio-toggle').addEventListener('click', () => {
//   if (!localStream) return;
//   const enabled = localStream.getAudioTracks()[0].enabled;
//   localStream.getAudioTracks()[0].enabled = !enabled;
//   document.getElementById('audio-toggle').classList.toggle('disabled');
//   socket.emit('toggle-audio', { userId: socket.id, enabled: !enabled, roomId: document.getElementById('room-id').value });
//   console.log(`Audio toggle: ${!enabled}`);
// });

// document.getElementById('screen-share').addEventListener('click', async () => {
//   if (!localStream) return;
//   try {
//     const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
//     const videoTrack = screenStream.getVideoTracks()[0];
//     Object.values(peers).forEach(pc => {
//       const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
//       if (sender) {
//         sender.replaceTrack(videoTrack);
//         console.log(`Replaced video track for peer ${pc}`);
//       }
//     });
//     document.querySelector(`#video-${socket.id} video`).srcObject = screenStream;
//     socket.emit('screen-share', { userId: socket.id, enabled: true, roomId: document.getElementById('room-id').value });
//     console.log('Screen share started');
//     videoTrack.onended = () => {
//       Object.values(peers).forEach(pc => {
//         const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
//         if (sender && localStream) {
//           sender.replaceTrack(localStream.getVideoTracks()[0]);
//           console.log(`Restored camera track for peer ${pc}`);
//         }
//       });
//       document.querySelector(`#video-${socket.id} video`).srcObject = localStream;
//       socket.emit('screen-share', { userId: socket.id, enabled: false, roomId: document.getElementById('room-id').value });
//       console.log('Screen share ended');
//     };
//   } catch (err) {
//     console.error('Screen share error:', err);
//     alert('Failed to share screen: ' + err.message);
//   }
// });

// const whiteboard = document.getElementById('whiteboard');
// const ctx = whiteboard.getContext('2d');
// ctx.strokeStyle = 'black';
// ctx.lineWidth = 2;

// document.getElementById('whiteboard-toggle').addEventListener('click', () => {
//   isWhiteboardActive = !isWhiteboardActive;
//   whiteboard.style.display = isWhiteboardActive ? 'block' : 'none';
//   if (isWhiteboardActive) {
//     whiteboard.width = whiteboard.offsetWidth;
//     whiteboard.height = whiteboard.offsetHeight;
//     ctx.strokeStyle = 'black';
//     ctx.lineWidth = 2;
//   }
// });

// whiteboard.addEventListener('mousedown', (e) => {
//   isDrawing = true;
//   ctx.beginPath();
//   ctx.moveTo(e.offsetX, e.offsetY);
//   socket.emit('whiteboard-update', {
//     data: { x: e.offsetX, y: e.offsetY, type: 'start' },
//     roomId: document.getElementById('room-id').value,
//   });
// });

// whiteboard.addEventListener('mousemove', (e) => {
//   if (isDrawing) {
//     ctx.lineTo(e.offsetX, e.offsetY);
//     ctx.stroke();
//     socket.emit('whiteboard-update', {
//       data: { x: e.offsetX, y: e.offsetY, prevX: ctx.currentX || e.offsetX, prevY: ctx.currentY || e.offsetY, type: 'draw' },
//       roomId: document.getElementById('room-id').value,
//     });
//     ctx.currentX = e.offsetX;
//     ctx.currentY = e.offsetY;
//   }
// });

// whiteboard.addEventListener('mouseup', () => {
//   isDrawing = false;
//   ctx.currentX = null;
//   ctx.currentY = null;
//   socket.emit('whiteboard-update', {
//     data: { type: 'end' },
//     roomId: document.getElementById('room-id').value,
//   });
// });

// socket.on('whiteboard-update', ({ data, roomId }) => {
//   if (!isWhiteboardActive) return;
//   if (data.type === 'start') {
//     ctx.beginPath();
//     ctx.moveTo(data.x, data.y);
//   } else if (data.type === 'draw') {
//     ctx.beginPath();
//     ctx.moveTo(data.prevX, data.prevY);
//     ctx.lineTo(data.x, data.y);
//     ctx.stroke();
//   } else if (data.type === 'end') {
//     isDrawing = false;
//   }
// });

// document.getElementById('file-input').addEventListener('change', async (e) => {
//   if (!token) {
//     alert('Please sign in to upload files');
//     return;
//   }
//   const file = e.target.files[0];
//   if (!file) return;
//   const formData = new FormData();
//   formData.append('file', file);
//   try {
//     const response = await fetch('/upload', {
//       method: 'POST',
//       headers: { Authorization: `Bearer ${token}` },
//       body: formData,
//     });
//     if (!response.ok) throw new Error((await response.json()).error || 'Upload failed');
//     const { fileUrl, fileName } = await response.json();
//     socket.emit('file-shared', { fileName, fileUrl, userId: socket.id, roomId: document.getElementById('room-id').value });
//     addFile(fileName, fileUrl, username);
//   } catch (err) {
//     console.error('File upload error:', err);
//     alert('Failed to upload file: ' + err.message);
//   }
// });

// socket.on('file-shared', ({ fileName, fileUrl, userId: peerId }) => {
//   const peerName = usernames.get(peerId) || peerId;
//   addFile(fileName, fileUrl, peerName);
// });

// function addFile(fileName, fileUrl, userName) {
//   const filesContainer = document.getElementById('files-container');
//   const fileItem = document.createElement('div');
//   fileItem.className = 'file-item';
//   fileItem.innerHTML = `
//     <a href="${fileUrl}" target="_blank">${fileName}</a>
//     <span>Shared by ${userName}</span>
//   `;
//   filesContainer.appendChild(fileItem);
// }

// // Debug Socket.IO connection
// socket.on('connect', () => console.log('Socket.IO connected'));
// socket.on('connect_error', (err) => console.error('Socket.IO error:', err));


