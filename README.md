# VOIP Platform — repaired and deployment-ready

A real-time communication web application built with React + Vite, Node.js + Express, Socket.IO, MongoDB/Mongoose and WebRTC.

## What was repaired

### 1. Direct messages
- Real-time one-to-one messages.
- MongoDB message history.
- Read state.
- New-message in-app toast.
- Browser notification when permission is granted.
- Reconnects automatically after a network interruption.

### 2. Voice and video calls
- One-to-one voice calls.
- One-to-one video calls.
- Accept/reject/end.
- Microphone mute.
- Camera toggle.
- WebRTC signaling through Socket.IO.
- STUN support and optional TURN support.
- Call history.
- Fixed call-start race conditions that could cause the first SDP message to be missed.

### 2A. Media access and LAN testing
- Direct and room calls check `navigator.mediaDevices.getUserMedia` before use.
- The UI reports when the browser is not in a secure context.
- Local signaling waits for media/peer initialization so early SDP/ICE messages are not dropped.
- For phone testing over a LAN IP, run Vite with `VITE_HTTPS=true` and use the HTTPS address.
- A TURN server is recommended when direct peer-to-peer connectivity is unavailable.

### 2B. Direct-message sender identity
- Real-time direct-message payloads include populated sender and receiver information.
- Message notifications identify the sender by full name/username.
- Clicking an in-app message notification opens that sender's conversation when the user is in the loaded contact list.

### 3. Private rooms
- A room is private by default.
- The room owner is the first admin.
- Only room admins can add members.
- Every added member receives the room immediately in their own portal.
- Room membership changes are synchronized to connected members.
- Removed members lose room access immediately.
- Room message history is stored in MongoDB.
- Room messages display the sender's name.
- Room voice/video calls use WebRTC mesh signaling for small rooms.

### 4. Notifications
The server now stores notifications in MongoDB and sends them over Socket.IO.

Notifications are generated for:
- Direct message.
- Direct voice/video call.
- Room message.
- Room invitation.
- Room voice/video call.

Users get:
- Bell notification panel.
- Unread badge.
- In-app toast.
- Browser notification when the browser allows notifications.

### 5. Menus
The following menus are functional:
- Messages
- Contacts
- Calls
- Rooms
- Settings

Settings includes:
- Change display name.
- View username/email.
- Change password.
- Dark/light mode.

### 6. Multi-device / multi-user socket handling
A user can have more than one active Socket.IO connection. The backend no longer assumes one socket per user.

For larger multi-instance deployments, set `REDIS_URL` so Socket.IO can use the Redis adapter for cross-instance fan-out.

## Requirements

- Node.js 20+ recommended.
- MongoDB local or MongoDB Atlas.
- Modern Chrome/Edge/Firefox.
- Microphone/camera permissions for calling.
- A TURN server is recommended for calls across difficult networks.

## Local PC setup

### Terminal 1 — backend

```powershell
cd server
npm install
copy .env.example .env
```

Edit `server/.env`:

```env
MONGO_URI=mongodb://127.0.0.1:27017/voip_platform
JWT_SECRET=put_a_long_random_secret_here
PORT=5000
CLIENT_URL=http://localhost:5173,http://127.0.0.1:5173
ALLOW_LAN=true
ALLOW_VERCEL_PREVIEWS=true
REDIS_URL=
```

Start:

```powershell
npm start
```

### Terminal 2 — frontend

```powershell
cd client
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

Create two accounts in two different browser profiles/incognito windows.

## Test from another phone on the same Wi-Fi

The application is configured so Vite proxies `/api` and `/socket.io` to the Node server.

### Messaging/presence test

On the PC:

```powershell
cd client
npm run dev -- --host 0.0.0.0
```

Find the PC's LAN IP, for example:

```text
192.168.1.10
```

On the phone open:

```text
http://192.168.1.10:5173
```

Windows Firewall must allow Node.js/Vite on the private network.

### Voice/video test

Browsers generally require a secure context for microphone/camera access when the page is opened from another device.

For a simple local test, enable Vite's generated HTTPS certificate:

Create `client/.env`:

```env
VITE_HTTPS=true
```

Then:

```powershell
cd client
npm run dev -- --host 0.0.0.0
```

Open the HTTPS LAN address printed by Vite on the phone. The browser may show a certificate warning because the development certificate is self-signed. Only use this development certificate on your own trusted LAN.

For reliable real-world calls, deploy the application over HTTPS and configure a TURN server.

## Vercel deployment

This project includes a root `vercel.json` using Vercel Services.

The current Vercel platform supports Vite frontends, Express backends and WebSocket connections, and Vercel Services can deploy multiple frontend/backend services together. See the official Vercel documentation/changelog for the current Services and WebSocket behavior.

### 1. Push the project to GitHub

From the `voip-platform` directory:

```powershell
git init
git add .
git commit -m "repair voip platform"
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY
git push -u origin main
```

### 2. Import the repository into Vercel

Import the repository as **one Vercel project**.

Do not set the Vercel root directory to `client`. Keep the repository root selected because the root `vercel.json` defines both services.

### 3. Required backend environment variables

Set:

```text
MONGO_URI=your MongoDB Atlas connection string
JWT_SECRET=your long random secret
CLIENT_URL=https://YOUR-VERCEL-DOMAIN
ALLOW_VERCEL_PREVIEWS=true
ALLOW_LAN=false
REDIS_URL=your Redis connection string (recommended for multi-instance realtime)
```

### 4. Frontend environment variables

Normally no `VITE_API_URL` or `VITE_SOCKET_URL` is required.

The client automatically uses the current Vercel origin:

```text
https://your-app.vercel.app/api
https://your-app.vercel.app/socket.io
```

The root `vercel.json` routes:
- `/api/*` → backend service
- `/socket.io/*` → backend service
- everything else → Vite frontend

### 5. MongoDB Atlas

If using MongoDB Atlas, add the Vercel deployment's network access as required by your Atlas configuration.

For a simple student/demo deployment, Atlas can be configured to allow access from the deployment environment. For production, use an appropriate restricted network/security setup.

### 6. Redis for many simultaneous users

For one backend instance, the in-memory socket map is enough for development and small deployments.

For multiple Vercel instances, configure `REDIS_URL`. The project includes the Socket.IO Redis adapter so socket events can be distributed between backend instances.

## TURN server

STUN is not enough for every network.

Set:

```env
VITE_STUN_SERVER=stun:stun.l.google.com:19302
VITE_TURN_SERVER=turn:your-domain.example:3478
VITE_TURN_USERNAME=your_username
VITE_TURN_PASSWORD=your_password
```

For production, use a properly secured TURN service.

## Important production note

WebRTC carries the actual audio/video directly between peers. The Node/Socket.IO backend carries signaling only.

For one-to-one calls this architecture is appropriate.

For large group video calls, a mesh connection becomes expensive because every participant maintains a peer connection with the other participants. For a large classroom/group-call product, use an SFU such as LiveKit or mediasoup.

## Useful health check

After deployment:

```text
https://YOUR-DOMAIN/api/health
```

Expected response:

```json
{
  "ok": true,
  "service": "voip-server"
}
```

## Troubleshooting

### CORS error

Make sure the backend `CLIENT_URL` contains the exact frontend origin.

For example:

```env
CLIENT_URL=https://my-voip-app.vercel.app
```

Do not add a trailing slash.

For LAN testing:

```env
ALLOW_LAN=true
```

### Socket.IO connection error

Check:
- `/socket.io` is reachable.
- Backend is running.
- JWT token is valid.
- Vercel project is using the root `vercel.json`.
- Redis is configured when multiple backend instances need shared realtime state.

### Phone can login but voice/video does not start

Check:
- HTTPS is being used on the phone.
- Microphone/camera permission is granted.
- A TURN server is configured if STUN cannot establish a direct path.
- The browser is not blocking the development certificate.

### Messages work but notifications do not appear

The message is still stored in MongoDB. Check:
- Socket.IO is connected.
- Browser notification permission is granted.
- The bell icon shows the notification.
- `/api/notifications` is reachable.

## Project structure

```text
voip-platform/
├── client/
│   ├── src/
│   │   ├── main.jsx
│   │   └── styles.css
│   ├── package.json
│   ├── vite.config.js
│   └── vercel.json
├── server/
│   ├── models/
│   │   ├── User.js
│   │   ├── Message.js
│   │   ├── Room.js
│   │   ├── Call.js
│   │   └── Notification.js
│   ├── config/
│   │   └── db.js
│   ├── server.js
│   └── package.json
├── vercel.json
├── render.yaml
└── README.md
```
