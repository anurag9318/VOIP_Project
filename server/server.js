import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { connectDB } from './config/db.js';
import User from './models/User.js';
import Message from './models/Message.js';
import Room from './models/Room.js';
import Call from './models/Call.js';
import Notification from './models/Notification.js';

const PORT = Number(process.env.PORT || 5000);
const CLIENT_URLS = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');
if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');

const app = express();
const server = http.createServer(app);
const corsOptions = {
  origin: (origin, cb) => {
    if (!origin || CLIENT_URLS.includes('*') || CLIENT_URLS.includes(origin)) return cb(null, true);
    // Allow Vercel preview deployments when explicitly enabled.
    if (origin && process.env.ALLOW_VERCEL_PREVIEWS === 'true' && /\.vercel\.app$/.test(new URL(origin).hostname)) return cb(null, true);
    if (origin && process.env.ALLOW_LAN === 'true') {
      try {
        const host = new URL(origin).hostname;
        if (/^(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return cb(null, true);
      } catch {}
    }
    cb(new Error('CORS origin not allowed'));
  },
  credentials: true
};
const io = new Server(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 20000
});
if (process.env.REDIS_URL) {
  const pubClient = createClient({ url: process.env.REDIS_URL });
  const subClient = pubClient.duplicate();
  Promise.all([pubClient.connect(), subClient.connect()])
    .then(() => io.adapter(createAdapter(pubClient, subClient)))
    .catch(err => console.error('Redis adapter unavailable:', err.message));
}

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 2000, standardHeaders: true }));

const dbReady = connectDB();
app.use(async (_req, res, next) => {
  try { await dbReady; next(); }
  catch { res.status(503).json({ message: 'Database unavailable' }); }
});

const publicUser = u => ({
  id: String(u._id),
  fullName: u.fullName,
  username: u.username,
  email: u.email,
  status: u.status,
  lastSeen: u.lastSeen,
  profilePicture: u.profilePicture
});
const signToken = u => jwt.sign(
  { id: String(u._id), username: u.username },
  process.env.JWT_SECRET,
  { expiresIn: '7d' }
);
const auth = (req, res, next) => {
  try {
    const token = (req.headers.authorization || '').startsWith('Bearer ')
      ? req.headers.authorization.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Authentication required' });
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const onlineSockets = new Map(); // userId -> Set(socketId)
const socketUser = new Map();     // socketId -> userId

const emitToUser = (userId, event, data) => {
  const ids = onlineSockets.get(String(userId));
  if (!ids) return;
  for (const sid of ids) io.to(sid).emit(event, data);
};
const emitToUsers = (userIds, event, data, exceptUserId = null) => {
  for (const id of userIds) if (String(id) !== String(exceptUserId)) emitToUser(id, event, data);
};
const createNotification = async ({ recipient, sender, type, message, data = {} }) => {
  const n = await Notification.create({ recipient, sender, type, message, data });
  const populated = await Notification.findById(n._id)
    .populate('sender', 'fullName username');
  const payload = populated ? populated.toObject() : n.toObject();

  emitToUser(recipient, 'notification:new', {
    ...payload,
    _id: String(n._id),
    recipient: String(recipient),
    sender: payload.sender || (sender ? String(sender) : undefined),
    data
  });
  return populated || n;
};

app.get('/api/health', (_, res) => res.json({ ok: true, service: 'voip-server', time: new Date().toISOString() }));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const { fullName, username, email, password } = req.body;
  if (!fullName || !username || !email || !password) return res.status(400).json({ message: 'All fields are required' });
  if (String(password).length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });
  const normalizedUsername = String(username).trim().toLowerCase();
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,30}$/.test(normalizedUsername)) return res.status(400).json({ message: 'Username must be 3-30 characters and use letters, numbers, dot, dash or underscore' });
  if (await User.findOne({ $or: [{ email: normalizedEmail }, { username: normalizedUsername }] })) {
    return res.status(409).json({ message: 'Username or email already exists' });
  }
  const u = await User.create({
    fullName: String(fullName).trim(),
    username: normalizedUsername,
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(String(password), 12),
    status: 'online'
  });
  res.status(201).json({ token: signToken(u), user: publicUser(u) });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const identifier = String(req.body.identifier || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const u = await User.findOne({ $or: [{ email: identifier }, { username: identifier }] });
  if (!u || !(await bcrypt.compare(password, u.passwordHash))) return res.status(401).json({ message: 'Invalid credentials' });
  u.status = 'online';
  await u.save();
  res.json({ token: signToken(u), user: publicUser(u) });
}));

app.get('/api/auth/me', auth, asyncRoute(async (req, res) => {
  const u = await User.findById(req.user.id);
  if (!u) return res.status(401).json({ message: 'Account not found' });
  res.json({ user: publicUser(u) });
}));

app.post('/api/auth/logout', auth, asyncRoute(async (req, res) => {
  await User.findByIdAndUpdate(req.user.id, { status: 'offline', lastSeen: new Date() });
  res.json({ ok: true });
}));

app.get('/api/users', auth, asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const filter = { _id: { $ne: req.user.id } };
  if (q) filter.$or = [
    { username: { $regex: q, $options: 'i' } },
    { fullName: { $regex: q, $options: 'i' } },
    { email: { $regex: q, $options: 'i' } }
  ];
  const users = await User.find(filter).select('-passwordHash').sort({ status: -1, fullName: 1 }).limit(100);
  res.json(users.map(publicUser));
}));

app.put('/api/users/profile', auth, asyncRoute(async (req, res) => {
  const fullName = String(req.body.fullName || '').trim();
  if (!fullName) return res.status(400).json({ message: 'Name is required' });
  const u = await User.findByIdAndUpdate(req.user.id, { fullName }, { new: true });
  res.json({ user: publicUser(u) });
}));

app.put('/api/users/change-password', auth, asyncRoute(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || String(newPassword).length < 8) return res.status(400).json({ message: 'New password must be at least 8 characters' });
  const u = await User.findById(req.user.id);
  if (!u || !(await bcrypt.compare(String(currentPassword || ''), u.passwordHash))) return res.status(400).json({ message: 'Current password is incorrect' });
  u.passwordHash = await bcrypt.hash(String(newPassword), 12);
  await u.save();
  res.json({ message: 'Password changed successfully' });
}));

app.get('/api/messages/:userId', auth, asyncRoute(async (req, res) => {
  const msgs = await Message.find({
    $or: [
      { sender: req.user.id, receiver: req.params.userId },
      { sender: req.params.userId, receiver: req.user.id }
    ]
  }).sort({ createdAt: 1 }).limit(500).populate('sender', 'fullName username');
  res.json(msgs);
}));

app.post('/api/messages/:userId/read', auth, asyncRoute(async (req, res) => {
  await Message.updateMany(
    { sender: req.params.userId, receiver: req.user.id, read: false },
    { $set: { read: true } }
  );
  res.json({ ok: true });
}));

app.get('/api/rooms', auth, asyncRoute(async (req, res) => {
  const rooms = await Room.find({ members: req.user.id })
    .populate('members', 'fullName username status')
    .populate('owner', 'fullName username')
    .sort({ updatedAt: -1 });
  res.json(rooms);
}));

app.post('/api/rooms', auth, asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ message: 'Room name is required' });
  const r = await Room.create({
    name,
    description: String(req.body.description || ''),
    owner: req.user.id,
    admins: [req.user.id],
    members: [req.user.id],
    isPrivate: true
  });
  res.status(201).json(await Room.findById(r._id)
    .populate('members', 'fullName username status')
    .populate('owner', 'fullName username'));
}));

app.post('/api/rooms/:roomId/members', auth, asyncRoute(async (req, res) => {
  const room = await Room.findById(req.params.roomId);
  if (!room) return res.status(404).json({ message: 'Room not found' });
  const isAdmin = room.admins.some(x => String(x) === String(req.user.id));
  if (!isAdmin) return res.status(403).json({ message: 'Only room admins can add members' });
  const user = await User.findById(req.body.userId);
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (!room.members.some(x => String(x) === String(user._id))) room.members.push(user._id);
  await room.save();
  const populated = await Room.findById(room._id)
    .populate('members', 'fullName username status')
    .populate('owner', 'fullName username');

  if (String(user._id) !== String(req.user.id)) {
    await createNotification({
      recipient: user._id,
      sender: req.user.id,
      type: 'room-invite',
      message: `You were added to room "${room.name}"`,
      data: { roomId: String(room._id), roomName: room.name }
    });
    emitToUser(user._id, 'room:added', populated);
  }
  // Refresh every current member's room card when membership changes.
  emitToUsers(room.members, 'room:updated', populated);
  res.json(populated);
}));

app.delete('/api/rooms/:roomId/members/:userId', auth, asyncRoute(async (req, res) => {
  const room = await Room.findById(req.params.roomId);
  if (!room) return res.status(404).json({ message: 'Room not found' });
  const isAdmin = room.admins.some(x => String(x) === String(req.user.id));
  if (!isAdmin) return res.status(403).json({ message: 'Only room admins can remove members' });
  if (String(req.params.userId) === String(room.owner)) return res.status(400).json({ message: 'Room owner cannot be removed' });
  room.members = room.members.filter(x => String(x) !== String(req.params.userId));
  room.admins = room.admins.filter(x => String(x) !== String(req.params.userId));
  await room.save();
  emitToUser(req.params.userId, 'room:removed', { roomId: String(room._id) });
  const populated = await Room.findById(room._id).populate('members', 'fullName username status').populate('owner', 'fullName username');
  emitToUsers(room.members, 'room:updated', populated);
  res.json(populated);
}));

app.get('/api/rooms/:roomId/messages', auth, asyncRoute(async (req, res) => {
  const room = await Room.findOne({ _id: req.params.roomId, members: req.user.id });
  if (!room) return res.status(403).json({ message: 'Room access denied' });
  res.json(await Message.find({ room: room._id }).sort({ createdAt: 1 }).limit(500).populate('sender', 'fullName username'));
}));

app.get('/api/calls', auth, asyncRoute(async (req, res) => {
  res.json(await Call.find({ participants: req.user.id })
    .sort({ createdAt: -1 }).limit(100)
    .populate('caller', 'fullName username')
    .populate('participants', 'fullName username'));
}));

app.get('/api/notifications', auth, asyncRoute(async (req, res) => {
  const items = await Notification.find({ recipient: req.user.id })
    .sort({ createdAt: -1 }).limit(100)
    .populate('sender', 'fullName username');
  res.json(items);
}));

app.post('/api/notifications/read', auth, asyncRoute(async (req, res) => {
  await Notification.updateMany({ recipient: req.user.id, read: false }, { $set: { read: true } });
  res.json({ ok: true });
}));

const onlineSet = userId => onlineSockets.get(String(userId)) || new Set();

io.use((socket, next) => {
  try {
    socket.user = jwt.verify(socket.handshake.auth?.token || '', process.env.JWT_SECRET);
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', async socket => {
  const userId = String(socket.user.id);
  if (!onlineSockets.has(userId)) onlineSockets.set(userId, new Set());
  onlineSockets.get(userId).add(socket.id);
  socketUser.set(socket.id, userId);
  await User.findByIdAndUpdate(userId, { status: 'online' });
  socket.broadcast.emit('user:online', { userId });

  socket.on('message:send', async ({ receiver, text }) => {
    try {
      const clean = String(text || '').trim();
      if (!clean || !receiver || String(receiver) === userId) return;
      const recipient = await User.findById(receiver);
      if (!recipient) return socket.emit('message:error', { message: 'User not found' });
      const m = await Message.create({ sender: userId, receiver, message: clean });
      const payload = (await Message.findById(m._id)
        .populate('sender', 'fullName username')
        .populate('receiver', 'fullName username')).toObject();

      emitToUser(receiver, 'message:receive', payload);
      socket.emit('message:receive', payload);

      const senderName = payload.sender?.fullName || payload.sender?.username || 'Someone';
      await createNotification({
        recipient: receiver,
        sender: userId,
        type: 'message',
        message: `${senderName} sent you a message`,
        data: {
          messageId: String(m._id),
          userId: String(userId),
          senderName,
          receiverId: String(receiver)
        }
      });
    } catch (e) { console.error('message:send', e); }
  });

  socket.on('room:join', async ({ roomId }) => {
    const room = await Room.findOne({ _id: roomId, members: userId });
    if (!room) return socket.emit('room:error', { message: 'Room access denied' });
    for (const r of socket.rooms) if (r.startsWith('room:')) socket.leave(r);
    socket.join(`room:${roomId}`);
    socket.emit('room:joined', { roomId, userId });
  });
  socket.on('room:leave', ({ roomId }) => socket.leave(`room:${roomId}`));

  socket.on('room:message', async ({ roomId, text }) => {
    try {
      const clean = String(text || '').trim();
      if (!clean) return;
      const room = await Room.findOne({ _id: roomId, members: userId });
      if (!room) return socket.emit('room:error', { message: 'Room access denied' });
      const m = await Message.create({ sender: userId, room: roomId, message: clean });
      const payload = (await Message.findById(m._id).populate('sender', 'fullName username')).toObject();
      io.to(`room:${roomId}`).emit('room:message', payload);
      const recipients = room.members.filter(id => String(id) !== userId);
      await Promise.all(recipients.map(recipient => createNotification({
        recipient,
        sender: userId,
        type: 'room-message',
        message: `New message in ${room.name}`,
        data: { roomId: String(room._id), roomName: room.name, messageId: String(m._id) }
      })));
    } catch (e) { console.error('room:message', e); }
  });

  socket.on('typing:start', ({ to }) => emitToUser(to, 'typing:start', { from: userId }));
  socket.on('typing:stop', ({ to }) => emitToUser(to, 'typing:stop', { from: userId }));

  socket.on('call:invite', async ({ to, type }) => {
    try {
      if (!to || !['voice', 'video'].includes(type)) return;
      const recipient = await User.findById(to);
      if (!recipient) return;
      const call = await Call.create({
        caller: userId, participants: [userId, to], callType: type, status: 'ringing'
      });
      emitToUser(to, 'call:incoming', { callId: String(call._id), from: userId, type });
      await createNotification({
        recipient: to,
        sender: userId,
        type: 'call',
        message: `Incoming ${type} call`,
        data: { callId: String(call._id), type, from: userId }
      });
      socket.emit('call:created', { callId: String(call._id), to });
    } catch (e) { console.error('call:invite', e); }
  });

  socket.on('call:accept', async ({ callId, to }) => {
    if (callId) await Call.findByIdAndUpdate(callId, { status: 'accepted', startedAt: new Date() });
    emitToUser(to, 'call:accepted', { callId, from: userId });
  });
  socket.on('call:reject', async ({ callId, to }) => {
    if (callId) await Call.findByIdAndUpdate(callId, { status: 'rejected', endedAt: new Date() });
    emitToUser(to, 'call:rejected', { callId, from: userId });
  });
  socket.on('call:end', async ({ callId, to }) => {
    if (callId) await Call.findByIdAndUpdate(callId, { status: 'ended', endedAt: new Date() });
    emitToUser(to, 'call:ended', { callId, from: userId });
  });
  socket.on('call:signal', ({ to, data }) => emitToUser(to, 'call:signal', { from: userId, data }));

  socket.on('room:call-start', async ({ roomId, type }) => {
    if (!roomId || !['voice', 'video'].includes(type)) return;
    const room = await Room.findOne({ _id: roomId, members: userId });
    if (!room) return;
    // Only tell members currently connected to the room; they can accept/join.
    socket.to(`room:${roomId}`).emit('room:call-incoming', { roomId, from: userId, type });
    const offlineOrNotJoined = room.members.filter(id => String(id) !== userId);
    await Promise.all(offlineOrNotJoined.map(recipient => createNotification({
      recipient,
      sender: userId,
      type: 'room-call',
      message: `Incoming ${type} call in ${room.name}`,
      data: { roomId: String(room._id), roomName: room.name, type, from: userId }
    })));
  });
  socket.on('room:call-ready', ({ roomId, to }) => emitToUser(to, 'room:call-ready', { roomId, from: userId }));
  socket.on('room:call-signal', ({ roomId, to, data }) => emitToUser(to, 'room:call-signal', { roomId, from: userId, data }));
  socket.on('room:call-end', ({ roomId }) => socket.to(`room:${roomId}`).emit('room:call-end', { roomId, from: userId }));

  socket.on('disconnect', async () => {
    const set = onlineSockets.get(userId);
    if (set) {
      set.delete(socket.id);
      if (!set.size) {
        onlineSockets.delete(userId);
        await User.findByIdAndUpdate(userId, { status: 'offline', lastSeen: new Date() });
        socket.broadcast.emit('user:offline', { userId });
      }
    }
    socketUser.delete(socket.id);
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  const message = err?.message === 'CORS origin not allowed' ? err.message : 'Server error';
  res.status(err?.message === 'CORS origin not allowed' ? 403 : 500).json({ message });
});

export { app, server, io };

const boot = dbReady.then(() => {
  if (process.env.VERCEL !== '1') {
    server.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://0.0.0.0:${PORT}`));
  }
}).catch(err => {
  console.error(err);
  if (process.env.VERCEL !== '1') process.exit(1);
});

export default server;
export { boot };
