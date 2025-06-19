    Welcome to folConnect! 
Hey there! Thanks for checking out folConnect, a fun and easy-to-use video conferencing app that brings people together for real-time collaboration. Whether you’re catching up with friends, brainstorming with your team, or sharing ideas, folConnect has got you covered with video calls, a shared whiteboard, file sharing, and more. Built with love using Node.js, Express, Socket.IO, and WebRTC, it’s a lightweight yet powerful tool to connect folks seamlessly.
What’s folConnect All About? 🌟
folConnect is your go-to platform for creating and joining virtual rooms where you can:

Video & Audio Chat: See and hear each other with smooth, real-time video and audio.
Create & Share Rooms: Generate unique room IDs and share links (like yourapp.com/room/abc123) to invite others.
Collaborate on a Whiteboard: Sketch ideas together in a shared canvas.
Share Files: Upload and share files with everyone in the room.
Screen Sharing: Show your screen to present or demo something cool.
Secure Sign-In: Sign up and log in with email and password, protected by JWT authentication.

It’s perfect for casual hangouts, remote work, or creative sessions, and it’s super easy to get started!
Getting Started Locally 🖥️
Want to run folConnect on your machine? Here’s how to set it up in a few simple steps.
Prerequisites

Node.js (v16 or higher): Download here.
Git: To clone the repo.
A terminal (macOS/Linux Terminal or Windows Command Prompt).
A modern browser (Chrome, Firefox, etc.).

    Installation

Clone the Repository:
git clone https://github.com/yourusername/folconnect.git
cd folconnect


Install Dependencies:
npm install


Set Up Environment Variables:Create a .env file in the root directory:
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env
echo "PORT=8080" >> .env


Create Uploads Directory (for file sharing):
mkdir -p server/Uploads
chmod 755 server/Uploads


Generate SSL Certificates (for local HTTPS):
mkdir -p server/cert
cd server/cert
openssl req -x509 -newkey rsa:4096 -keyout server.key -out server.cert -days 365 -nodes -subj "/CN=localhost"
cd ../..


Start the App:
npm run dev

You’ll see: Server running on https://localhost:8080.

Open in Browser:Visit https://localhost:8080 (accept the self-signed certificate warning). Sign up, log in, create a room, and invite someone to join!


Folder Structure

client/: Frontend files (index.html, style.css, app.js).
server/: Backend files (server.js, auth.js, Uploads/ for files).
.env: Environment variables (don’t commit this!).
package.json: Dependencies and scripts.

Deploying to Render ☁️
Ready to share folConnect with the world? Here’s how to deploy it on Render so anyone can join your rooms via a public URL.

Push to GitHub:

Initialize a Git repo:git init
echo "node_modules/" > .gitignore
echo ".env" >> .gitignore
echo "server/cert/" >> .gitignore
echo "server/Uploads/" >> .gitignore
git add .
git commit -m "Ready for deployment"


Create a GitHub repo named folconnect and push:git remote add origin https://github.com/yourusername/folconnect.git
git branch -M main
git push -u origin main




Set Up Render:

Sign in at render.com.
Click “New” > “Web Service” and connect your folconnect GitHub repo.
Configure:
Name: folconnect (e.g., folconnect.onrender.com).
Environment: Node.
Branch: main.
Build Command: npm install
Start Command: npm start


Add environment variable:
JWT_SECRET: Run openssl rand -hex 32 and paste the output.


Click “Create Web Service”.


Test It Out:

Once deployed, visit https://folconnect.onrender.com.
Create a room and share the link (e.g., https://folconnect.onrender.com/room/room-abc12345).
Test video calls, whiteboard, and file sharing across devices.



Note: Render’s free tier may sleep after inactivity, causing a brief delay on first load. For production, consider a paid plan.
Tips for Production 🌍

Add a TURN Server: Improve WebRTC connectivity by adding a TURN server in client/app.js:iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:your-turn-server.com', username: 'user', credential: 'pass' }
]


Rate Limiting: Install express-rate-limit to prevent abuse:npm install express-rate-limit

Update server/server.js:const rateLimit = require('express-rate-limit');
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));


Persistent Storage: Currently, user data resets on server restart. Want to add PostgreSQL? Let me know!

    Contributing 
Love folConnect and want to make it even better? Contributions are super welcome! Here’s how to get involved:

Fork the repo on GitHub.
Create a branch: git checkout -b your-feature.
Make your changes and commit: git commit -m "Add cool feature".
Push: git push origin your-feature.
Open a Pull Request on GitHub.

    Ideas for contributions:

Add chat messaging.
Improve UI with animations.
Support more file types for sharing.

    Troubleshooting 🛠

Local Server Errors: Check npm run dev logs and ensure .env is set.
WebRTC Issues: Ensure camera/mic permissions are granted and test with a TURN server.
Render Deployment Fails: Check Render logs and verify package.json scripts.
Need help? Open an issue on GitHub or share logs from:npm start



    Why folConnect? 
folConnect is all about making connections simple and fun. Whether you’re hosting a virtual game night or a work meeting, it’s designed to bring people together with tools that spark creativity and collaboration. I built this app to learn and share, and I hope you enjoy using it as much as I enjoyed creating it!
Happy connecting! 

Author: Victor Oluwatimileyin AJAO
