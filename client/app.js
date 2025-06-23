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
    const endpoint = isSignIn ? '/auth/signin' : '/auth/signup'; // Use relative URLs
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, username: isSignIn ? undefined : usernameInput })
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
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        addVideoStream(userId, username, localStream, true);
        socket.emit('join-room', { roomId, userId }, ({ users, error }) => {
            if (error) return alert(error);
            users.forEach(peerId => {
                if (peerId !== userId) createPeerConnection(peerId, roomId);
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
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
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
            socket.emit('offer', { offer: pc.localDescription, to: peerId, from: userId, roomId });
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
    if (peerId !== userId) createPeerConnection(peerId, document.getElementById('room-id').value);
});

socket.on('offer', async ({ offer, from, roomId }) => {
    const pc = peers[from] || createPeerConnection(from, roomId);
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', { answer, to: from, from: userId });
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

socket.on('ice-candidate', async ({ candidate }) => {
    try {
        const pcs = Object.values(peers);
        for (const pc of pcs) {
            if (pc.remoteDescription) {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
        }
    } catch (err) {
        console.error('ICE candidate error:', err);
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

socket.on('screen-share', async ({ userId: peerId, enabled }) => {
    if (enabled) {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const video = document.querySelector(`#video-${peerId} video`);
        if (video) video.srcObject = stream;
    }
});

document.getElementById('video-toggle').addEventListener('click', () => {
    const enabled = localStream.getVideoTracks()[0].enabled;
    localStream.getVideoTracks()[0].enabled = !enabled;
    document.getElementById('video-toggle').classList.toggle('disabled');
    socket.emit('toggle-video', { userId, enabled: !enabled, roomId: document.getElementById('room-id').value });
});

document.getElementById('audio-toggle').addEventListener('click', () => {
    const enabled = localStream.getAudioTracks()[0].enabled;
    localStream.getAudioTracks()[0].enabled = !enabled;
    document.getElementById('audio-toggle').classList.toggle('disabled');
    socket.emit('toggle-audio', { userId, enabled: !enabled, roomId: document.getElementById('room-id').value });
});

document.getElementById('screen-share').addEventListener('click', async () => {
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const videoTrack = screenStream.getVideoTracks()[0];
        Object.values(peers).forEach(pc => {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) sender.replaceTrack(videoTrack);
        });
        document.querySelector(`#video-${userId} video`).srcObject = screenStream;
        socket.emit('screen-share', { userId, enabled: true, roomId: document.getElementById('room-id').value });
        videoTrack.onended = () => {
            Object.values(peers).forEach(pc => {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) sender.replaceTrack(localStream.getVideoTracks()[0]);
            });
            document.querySelector(`#video-${userId} video`).srcObject = localStream;
            socket.emit('screen-share', { userId, enabled: false, roomId: document.getElementById('room-id').value });
        };
    } catch (err) {
        console.error('Screen share error:', err);
    }
});

const whiteboard = document.getElementById('whiteboard');
const ctx = whiteboard.getContext('2d');

document.getElementById('whiteboard-toggle').addEventListener('click', () => {
    isWhiteboardActive = !isWhiteboardActive;
    whiteboard.style.display = isWhiteboardActive ? 'block' : 'none';
    if (isWhiteboardActive) {
        whiteboard.width = whiteboard.offsetWidth;
        whiteboard.height = whiteboard.offsetHeight;
    }
});

whiteboard.addEventListener('mousedown', (e) => {
    isDrawing = true;
    ctx.beginPath();
    ctx.moveTo(e.offsetX, e.offsetY);
});

whiteboard.addEventListener('mousemove', (e) => {
    if (isDrawing) {
        ctx.lineTo(e.offsetX, e.offsetY);
        ctx.stroke();
        socket.emit('whiteboard-update', {
            data: { x: e.offsetX, y: e.offsetY, type: 'draw' },
            roomId: document.getElementById('room-id').value
        });
    }
});

whiteboard.addEventListener('mouseup', () => {
    isDrawing = false;
});

socket.on('whiteboard-update', ({ x, y, type }) => {
    if (type === 'draw' && isWhiteboardActive) {
        ctx.lineTo(x, y);
        ctx.stroke();
    }
});

document.getElementById('file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
        const response = await fetch('/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        const { fileUrl, fileName } = await response.json();
        socket.emit('file-shared', { fileName, fileUrl, userId, roomId: document.getElementById('room-id').value });
        addFile(fileName, fileUrl, username);
    } catch (err) {
        console.error('File upload error:', err);
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





// const socket = io();
// let localStream;
// let peers = {};
// let userId = null; // Initialize to null
// let username = null; // Initialize to null
// let token = null; // Initialize to null
// let isWhiteboardActive = false;
// let isDrawing = false;

// function toggleAuth() {
//     const title = document.getElementById('auth-title');
//     const toggle = document.getElementById('auth-toggle');
//     const isSignIn = title.textContent === 'Sign In';
//     title.textContent = isSignIn ? 'Sign Up' : 'Sign In';
//     document.getElementById('username').style.display = isSignIn ? 'block' : 'none';
//     toggle.innerHTML = isSignIn 
//         ? 'Already have an account? <a href="#" onclick="toggleAuth()">Sign In</a>'
//         : 'Don\'t have an account? <a href="#" onclick="toggleAuth()">Sign Up</a>';
//     document.getElementById('auth-error').textContent = '';
// }
// async function handleAuth() {
//     const email = document.getElementById('email').value;
//     const password = document.getElementById('password').value;
//     const usernameInput = document.getElementById('username').value; // Renamed to avoid conflict
//     const isSignIn = document.getElementById('auth-title').textContent === 'Sign In';
//     const endpoint = isSignIn ? 'https://localhost:8080/auth/signin' : 'https://localhost:8080/auth/signup';
//     try {
//         const response = await fetch(endpoint, {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({ email, password, username: isSignIn ? undefined : usernameInput })
//         });
//         const data = await response.json();
//         if (!response.ok) throw new Error(data.error);
//         if (isSignIn) {
//             token = data.token;
//             userId = data.userId;
//             username = data.username;
//             document.getElementById('auth-container').style.display = 'none';
//             document.getElementById('room-container').style.display = 'block';
//             document.getElementById('user-info').textContent = `Welcome, ${username}`;
//         } else {
//             document.getElementById('auth-error').textContent = 'Account created! Please sign in.';
//             toggleAuth();
//         }
//     } catch (err) {
//         document.getElementById('auth-error').textContent = err.message;
//     }
// }

// function logout() {
//     token = null;
//     userId = null;
//     username = null;
//     document.getElementById('room-container').style.display = 'none';
//     document.getElementById('auth-container').style.display = 'flex';
//     if (localStream) {
//         localStream.getTracks().forEach(track => track.stop());
//         localStream = null;
//     }
//     Object.values(peers).forEach(pc => pc.close());
//     peers = {};
//     socket.disconnect();
//     socket.connect();
// }

// async function joinRoom() {
//     const roomId = document.getElementById('room-id').value.trim();
//     if (!roomId) return alert('Please enter a room ID');
//     try {
//         localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
//         addVideoStream(userId, username, localStream, true);
//         socket.emit('join-room', { roomId, userId }, ({ users, error }) => {
//             if (error) return alert(error);
//             users.forEach(peerId => {
//                 if (peerId !== userId) createPeerConnection(peerId, roomId);
//             });
//         });
//     } catch (err) {
//         console.error('Error accessing media devices:', err);
//         alert('Failed to access camera/microphone');
//     }
// }

// function addVideoStream(peerId, peerName, stream, isLocal = false) {
//     const videoContainer = document.getElementById('video-container');
//     const wrapper = document.createElement('div');
//     wrapper.className = 'video-wrapper';
//     wrapper.id = `video-${peerId}`;
//     const video = document.createElement('video');
//     video.srcObject = stream;
//     video.autoplay = true;
//     video.playsinline = true;
//     if (isLocal) video.muted = true;
//     const label = document.createElement('div');
//     label.className = 'video-label';
//     label.textContent = peerName;
//     wrapper.appendChild(video);
//     wrapper.appendChild(label);
//     videoContainer.appendChild(wrapper);
// }

// function createPeerConnection(peerId, roomId) {
//     const pc = new RTCPeerConnection({
//         iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
//     });
//     peers[peerId] = pc;

//     localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

//     pc.ontrack = (event) => {
//         if (!document.getElementById(`video-${peerId}`)) {
//             addVideoStream(peerId, peerId, event.streams[0]);
//         }
//     };

//     pc.onicecandidate = (event) => {
//         if (event.candidate) {
//             socket.emit('ice-candidate', { candidate: event.candidate, to: peerId });
//         }
//     };

//     pc.onnegotiationneeded = async () => {
//         try {
//             await pc.setLocalDescription(await pc.createOffer());
//             socket.emit('offer', { offer: pc.localDescription, to: peerId, from: userId, roomId });
//         } catch (err) {
//             console.error('Negotiation error:', err);
//         }
//     };

//     pc.onconnectionstatechange = () => {
//         if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
//             removeVideoStream(peerId);
//             delete peers[peerId];
//         }
//     };

//     return pc;
// }

// function removeVideoStream(peerId) {
//     const wrapper = document.getElementById(`video-${peerId}`);
//     if (wrapper) wrapper.remove();
// }

// socket.on('user-joined', ({ userId: peerId, socketId }) => {
//     if (peerId !== userId) createPeerConnection(peerId, document.getElementById('room-id').value);
// });

// socket.on('offer', async ({ offer, from, roomId }) => {
//     const pc = peers[from] || createPeerConnection(from, roomId);
//     try {
//         await pc.setRemoteDescription(new RTCSessionDescription(offer));
//         const answer = await pc.createAnswer();
//         await pc.setLocalDescription(answer);
//         socket.emit('answer', { answer, to: from, from: userId });
//     } catch (err) {
//         console.error('Offer handling error:', err);
//     }
// });

// socket.on('answer', async ({ answer, from }) => {
//     const pc = peers[from];
//     if (pc) {
//         try {
//             await pc.setRemoteDescription(new RTCSessionDescription(answer));
//         } catch (err) {
//             console.error('Answer handling error:', err);
//         }
//     }
// });

// socket.on('ice-candidate', async ({ candidate }) => {
//     try {
//         const pcs = Object.values(peers);
//         for (const pc of pcs) {
//             if (pc.remoteDescription) {
//                 await pc.addIceCandidate(new RTCIceCandidate(candidate));
//             }
//         }
//     } catch (err) {
//         console.error('ICE candidate error:', err);
//     }
// });

// socket.on('user-left', ({ userId: peerId }) => {
//     removeVideoStream(peerId);
//     if (peers[peerId]) {
//         peers[peerId].close();
//         delete peers[peerId];
//     }
// });

// socket.on('toggle-video', ({ userId: peerId, enabled }) => {
//     const video = document.querySelector(`#video-${peerId} video`);
//     if (video) video.style.display = enabled ? 'block' : 'none';
// });

// socket.on('toggle-audio', ({ userId: peerId, enabled }) => {
//     const video = document.querySelector(`#video-${peerId} video`);
//     if (video) video.muted = !enabled;
// });

// socket.on('screen-share', async ({ userId: peerId, enabled }) => {
//     if (enabled) {
//         const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
//         const video = document.querySelector(`#video-${peerId} video`);
//         if (video) video.srcObject = stream;
//     }
// });

// document.getElementById('video-toggle').addEventListener('click', () => {
//     const enabled = localStream.getVideoTracks()[0].enabled;
//     localStream.getVideoTracks()[0].enabled = !enabled;
//     document.getElementById('video-toggle').classList.toggle('disabled');
//     socket.emit('toggle-video', { userId, enabled: !enabled, roomId: document.getElementById('room-id').value });
// });

// document.getElementById('audio-toggle').addEventListener('click', () => {
//     const enabled = localStream.getAudioTracks()[0].enabled;
//     localStream.getAudioTracks()[0].enabled = !enabled;
//     document.getElementById('audio-toggle').classList.toggle('disabled');
//     socket.emit('toggle-audio', { userId, enabled: !enabled, roomId: document.getElementById('room-id').value });
// });

// document.getElementById('screen-share').addEventListener('click', async () => {
//     try {
//         const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
//         const videoTrack = screenStream.getVideoTracks()[0];
//         Object.values(peers).forEach(pc => {
//             const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
//             if (sender) sender.replaceTrack(videoTrack);
//         });
//         document.querySelector(`#video-${userId} video`).srcObject = screenStream;
//         socket.emit('screen-share', { userId, enabled: true, roomId: document.getElementById('room-id').value });
//         videoTrack.onended = () => {
//             Object.values(peers).forEach(pc => {
//                 const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
//                 if (sender) sender.replaceTrack(localStream.getVideoTracks()[0]);
//             });
//             document.querySelector(`#video-${userId} video`).srcObject = localStream;
//             socket.emit('screen-share', { userId, enabled: false, roomId: document.getElementById('room-id').value });
//         };
//     } catch (err) {
//         console.error('Screen share error:', err);
//     }
// });

// const whiteboard = document.getElementById('whiteboard');
// const ctx = whiteboard.getContext('2d');

// document.getElementById('whiteboard-toggle').addEventListener('click', () => {
//     isWhiteboardActive = !isWhiteboardActive;
//     whiteboard.style.display = isWhiteboardActive ? 'block' : 'none';
//     if (isWhiteboardActive) {
//         whiteboard.width = whiteboard.offsetWidth;
//         whiteboard.height = whiteboard.offsetHeight;
//     }
// });

// whiteboard.addEventListener('mousedown', (e) => {
//     isDrawing = true;
//     ctx.beginPath();
//     ctx.moveTo(e.offsetX, e.offsetY);
// });

// whiteboard.addEventListener('mousemove', (e) => {
//     if (isDrawing) {
//         ctx.lineTo(e.offsetX, e.offsetY);
//         ctx.stroke();
//         socket.emit('whiteboard-update', {
//             data: { x: e.offsetX, y: e.offsetY, type: 'draw' },
//             roomId: document.getElementById('room-id').value
//         });
//     }
// });

// whiteboard.addEventListener('mouseup', () => {
//     isDrawing = false;
// });

// socket.on('whiteboard-update', ({ x, y, type }) => {
//     if (type === 'draw' && isWhiteboardActive) {
//         ctx.lineTo(x, y);
//         ctx.stroke();
//     }
// });

// document.getElementById('file-input').addEventListener('change', async (e) => {
//     const file = e.target.files[0];
//     if (!file) return;
//     const formData = new FormData();
//     formData.append('file', file);
//     try {
//         const response = await fetch('/upload', {
//             method: 'POST',
//             headers: { 'Authorization': `Bearer ${token}` },
//             body: formData
//         });
//         const { fileUrl, fileName } = await response.json();
//         socket.emit('file-shared', { fileName, fileUrl, userId, roomId: document.getElementById('room-id').value });
//         addFile(fileName, fileUrl, username);
//     } catch (err) {
//         console.error('File upload error:', err);
//     }
// });

// socket.on('file-shared', ({ fileName, fileUrl, userId: peerId }) => {
//     addFile(fileName, fileUrl, peerId);
// });

// function addFile(fileName, fileUrl, userName) {
//     const filesContainer = document.getElementById('files-container');
//     const fileItem = document.createElement('div');
//     fileItem.className = 'file-item';
//     fileItem.innerHTML = `
//         <a href="${fileUrl}" target="_blank">${fileName}</a>
//         <span>Shared by ${userName}</span>
//     `;
//     filesContainer.appendChild(fileItem);
// }