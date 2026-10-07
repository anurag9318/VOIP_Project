import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import { io } from 'socket.io-client';
import {
  Phone, Video, MessageCircle, Users, LogOut, Moon, Sun, Send, Mic, MicOff,
  Camera, CameraOff, PhoneOff, Plus, Search, Settings, X, Check, DoorOpen,
  Bell, ArrowLeft, Lock, Save, RefreshCw
} from 'lucide-react';
import './styles.css';

const DEFAULT_BASE = window.location.origin;
const API = (import.meta.env.VITE_API_URL || DEFAULT_BASE).replace(/\/$/, '');
const SOCKET = (import.meta.env.VITE_SOCKET_URL || API).replace(/\/$/, '');
const api = axios.create({ baseURL: API });
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const notifyBrowser = (title, body) => {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') new Notification(title, { body });
};
const requestBrowserNotifications = async () => {
  if ('Notification' in window && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch {}
  }
};
const displayName = sender => sender?.fullName || sender?.username || 'Someone';
const entityId = value => String(value?._id || value?.id || value || '');

function Auth({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const url = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = mode === 'login'
        ? { identifier: form.identifier, password: form.password } : form;
      const r = await api.post(url, body);
      localStorage.setItem('token', r.data.token);
      onLogin(r.data.user);
    } catch (e) {
      setErr(e.response?.data?.message || 'Something went wrong');
    } finally { setBusy(false); }
  };
  return <div className="auth">
    <div className="auth-card">
      <div className="brand">VO<span>IP</span></div>
      <h1>{mode === 'login' ? 'Welcome back' : 'Create account'}</h1>
      <p className="muted">Messages, private rooms, voice and video calls.</p>
      <form onSubmit={submit}>
        {mode === 'register' && <>
          <input required placeholder="Full name" onChange={e => setForm({ ...form, fullName: e.target.value })}/>
          <input required placeholder="Username" onChange={e => setForm({ ...form, username: e.target.value })}/>
          <input required type="email" placeholder="Email" onChange={e => setForm({ ...form, email: e.target.value })}/>
        </>}
        {mode === 'login' && <input required placeholder="Username or email" onChange={e => setForm({ ...form, identifier: e.target.value })}/>}
        <input required minLength={8} placeholder="Password (8+ characters)" type="password" onChange={e => setForm({ ...form, password: e.target.value })}/>
        <button disabled={busy} className="primary">{busy ? 'Please wait…' : mode === 'login' ? 'Login' : 'Register'}</button>
        {err && <div className="error">{err}</div>}
      </form>
      <button className="link" onClick={() => { setErr(''); setMode(mode === 'login' ? 'register' : 'login'); }}>
        {mode === 'login' ? 'Create an account' : 'Already have an account?'}
      </button>
    </div>
  </div>;
}

function MediaCall({ socket, call, onClose }) {
  const localRef = useRef(null), remoteRef = useRef(null), pcRef = useRef(null);
  const streamRef = useRef(null), pendingIce = useRef([]);
  const [muted, setMuted] = useState(false);
  const [camera, setCamera] = useState(call.type === 'video');
  const [status, setStatus] = useState(call.incoming ? 'Connecting…' : 'Waiting for answer…');

  useEffect(() => {
    let alive = true;
    let pc;
    let resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });

    const mediaError = e => {
      console.error('WebRTC media error:', e);
      if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
        setStatus('Microphone/camera requires HTTPS on this device');
        return;
      }
      if (!navigator.mediaDevices) {
        setStatus('Camera/microphone API unavailable. Use HTTPS or localhost.');
        return;
      }
      if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
        setStatus('Microphone/camera permission denied');
      } else if (e?.name === 'NotFoundError' || e?.name === 'DevicesNotFoundError') {
        setStatus(call.type === 'video' ? 'Camera or microphone not found' : 'Microphone not found');
      } else if (e?.name === 'NotReadableError' || e?.name === 'TrackStartError') {
        setStatus('Camera/microphone is already in use');
      } else if (e?.name === 'SecurityError') {
        setStatus('Browser security blocked microphone/camera access');
      } else {
        setStatus(`Media error: ${e?.message || 'Unable to access microphone/camera'}`);
      }
    };

    const setup = async () => {
      try {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
          mediaError(new Error('getUserMedia is unavailable'));
          return;
        }

        pc = new RTCPeerConnection({
          iceServers: [
            { urls: import.meta.env.VITE_STUN_SERVER || 'stun:stun.l.google.com:19302' },
            ...(import.meta.env.VITE_TURN_SERVER ? [{
              urls: import.meta.env.VITE_TURN_SERVER,
              username: import.meta.env.VITE_TURN_USERNAME,
              credential: import.meta.env.VITE_TURN_PASSWORD
            }] : [])
          ]
        });
        pcRef.current = pc;

        pc.onicecandidate = e => {
          if (e.candidate && socket.connected) {
            socket.emit('call:signal', { to: call.target, data: { candidate: e.candidate } });
          }
        };
        pc.ontrack = e => {
          if (remoteRef.current && e.streams[0]) {
            remoteRef.current.srcObject = e.streams[0];
            remoteRef.current.play?.().catch(() => {});
          }
        };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'connected') setStatus('Connected');
          if (pc.connectionState === 'connecting') setStatus('Connecting…');
          if (['failed', 'disconnected'].includes(pc.connectionState)) {
            setStatus('Connection lost — check network/TURN settings');
          }
          if (pc.connectionState === 'closed') setStatus('Call ended');
        };

        const constraints = {
          audio: true,
          video: call.type === 'video' ? { facingMode: 'user' } : false
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!alive) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;
        if (localRef.current) {
          localRef.current.srcObject = stream;
          localRef.current.play?.().catch(() => {});
        }
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
        resolveReady();
      } catch (e) {
        mediaError(e);
        pc?.close();
        pcRef.current = null;
        resolveReady();
      }
    };

    const accepted = async ({ from }) => {
      if (call.incoming || String(from) !== String(call.target)) return;
      await ready;
      if (!pcRef.current) return;
      try {
        const offer = await pcRef.current.createOffer();
        await pcRef.current.setLocalDescription(offer);
        socket.emit('call:signal', {
          to: call.target,
          data: { description: pcRef.current.localDescription }
        });
        setStatus('Calling…');
      } catch (e) {
        console.error('WebRTC offer error:', e);
        setStatus('Could not start call');
      }
    };

    const signal = async ({ from, data }) => {
      if (String(from) !== String(call.target)) return;
      await ready;
      if (!pcRef.current) return;
      const p = pcRef.current;
      try {
        if (data?.description) {
          const description = data.description;

          if (description.type === 'offer') {
            await p.setRemoteDescription(description);
            const answer = await p.createAnswer();
            await p.setLocalDescription(answer);
            socket.emit('call:signal', {
              to: call.target,
              data: { description: p.localDescription }
            });
          } else if (description.type === 'answer') {
            await p.setRemoteDescription(description);
          }

          if (p.remoteDescription) {
            for (const c of pendingIce.current.splice(0)) {
              try { await p.addIceCandidate(c); } catch (e) { console.warn('Queued ICE error:', e); }
            }
          }
        }

        if (data?.candidate) {
          if (p.remoteDescription) await p.addIceCandidate(data.candidate);
          else pendingIce.current.push(data.candidate);
        }
      } catch (e) {
        console.error('WebRTC signaling error:', e);
        setStatus('Call connection failed');
      }
    };

    const ended = d => {
      if (String(d.from) === String(call.target)) onClose(false);
    };

    socket.on('call:accepted', accepted);
    socket.on('call:signal', signal);
    socket.on('call:ended', ended);
    setup();

    return () => {
      alive = false;
      socket.off('call:accepted', accepted);
      socket.off('call:signal', signal);
      socket.off('call:ended', ended);
      pendingIce.current = [];
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      pcRef.current?.close();
      pcRef.current = null;
    };
  }, [socket, call.target, call.type, call.incoming, onClose]);

  const end = () => {
    socket.emit('call:end', { callId: call.callId, to: call.target });
    onClose(true);
  };

  const toggle = kind => {
    const tracks = kind === 'audio'
      ? streamRef.current?.getAudioTracks()
      : streamRef.current?.getVideoTracks();
    tracks?.forEach(t => { t.enabled = !t.enabled; });
    if (kind === 'audio') setMuted(v => !v);
    else setCamera(v => !v);
  };

  return <div className="call">
    <div className="videos">
      <video ref={remoteRef} autoPlay playsInline className="remote"/>
      <video ref={localRef} autoPlay muted playsInline className="local"/>
      <div className="callstate">{status}</div>
    </div>
    <div className="callbar">
      <button onClick={() => toggle('audio')}>{muted ? <MicOff/> : <Mic/>}</button>
      {call.type === 'video' && <button onClick={() => toggle('video')}>{camera ? <Camera/> : <CameraOff/>}</button>}
      <button className="danger" onClick={end}><PhoneOff/></button>
    </div>
  </div>;
}

function RoomCall({ socket, roomId, type, userId, initiator, peerTarget, onClose }) {
  const local = useRef(null), pcs = useRef(new Map()), stream = useRef(null), streamReady = useRef(Promise.resolve());
  const [status, setStatus] = useState(initiator ? 'Starting room call…' : 'Joining room call…');

  const createPeer = async (peerId, makeOffer) => {
    if (String(peerId) === String(userId)) return;
    if (pcs.current.has(String(peerId))) return pcs.current.get(String(peerId));

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: import.meta.env.VITE_STUN_SERVER || 'stun:stun.l.google.com:19302' },
        ...(import.meta.env.VITE_TURN_SERVER ? [{
          urls: import.meta.env.VITE_TURN_SERVER,
          username: import.meta.env.VITE_TURN_USERNAME,
          credential: import.meta.env.VITE_TURN_PASSWORD
        }] : [])
      ]
    });

    pcs.current.set(String(peerId), pc);
    stream.current?.getTracks().forEach(t => pc.addTrack(t, stream.current));
    pc.onicecandidate = e => {
      if (e.candidate && socket.connected) {
        socket.emit('room:call-signal', { roomId, to: peerId, data: { candidate: e.candidate } });
      }
    };
    pc.ontrack = e => {
      let el = document.getElementById(`peer-${peerId}`);
      if (!el) {
        el = document.createElement(type === 'video' ? 'video' : 'audio');
        el.id = `peer-${peerId}`;
        el.autoplay = true;
        el.playsInline = true;
        el.className = 'peer-media';
        document.querySelector('.peer-grid')?.appendChild(el);
      }
      el.srcObject = e.streams[0];
      el.play?.().catch(() => {});
    };

    if (makeOffer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('room:call-signal', {
        roomId,
        to: peerId,
        data: { description: pc.localDescription }
      });
    }
    return pc;
  };

  useEffect(() => {
    let active = true;
    let resolveReady;
    streamReady.current = new Promise(resolve => { resolveReady = resolve; });

    const setup = async () => {
      try {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
          setStatus(
            !window.isSecureContext && !['localhost', '127.0.0.1'].includes(window.location.hostname)
              ? 'Room calls require HTTPS on this device'
              : 'Camera/microphone API unavailable'
          );
          resolveReady();
          return;
        }

        stream.current = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: type === 'video'
        });
        if (!active) {
          stream.current?.getTracks().forEach(t => t.stop());
          return;
        }

        if (local.current) local.current.srcObject = stream.current;
        setStatus(initiator ? 'In room call — waiting for members' : 'Connected to room call');

        if (initiator) socket.emit('room:call-start', { roomId, type });
        else if (peerTarget) socket.emit('room:call-ready', { roomId, to: peerTarget });
      } catch (e) {
        console.error('Room media error:', e);
        setStatus(
          e.name === 'NotAllowedError'
            ? 'Microphone/camera permission denied'
            : e.name === 'NotFoundError'
              ? 'Camera or microphone not found'
              : `Media error: ${e.message || 'Unable to access microphone/camera'}`
        );
      } finally {
        resolveReady();
      }
    };

    const ready = async ({ roomId: r, from }) => {
      if (String(r) === String(roomId) && initiator) {
        await streamReady.current;
        if (stream.current) await createPeer(from, true);
      }
    };

    const signal = async ({ roomId: r, from, data }) => {
      if (String(r) !== String(roomId) || String(from) === String(userId)) return;
      await streamReady.current;
      if (!stream.current) return;

      const pc = await createPeer(from, false);
      try {
        if (data?.description) {
          if (data.description.type === 'offer') {
            await pc.setRemoteDescription(data.description);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('room:call-signal', {
              roomId,
              to: from,
              data: { description: pc.localDescription }
            });
          } else {
            await pc.setRemoteDescription(data.description);
          }
        }
        if (data?.candidate) {
          if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
        }
      } catch (e) {
        console.error('Room WebRTC error', e);
      }
    };

    const ended = d => {
      if (String(d.roomId) === String(roomId)) onClose(false);
    };

    socket.on('room:call-ready', ready);
    socket.on('room:call-signal', signal);
    socket.on('room:call-end', ended);
    setup();

    return () => {
      active = false;
      socket.off('room:call-ready', ready);
      socket.off('room:call-signal', signal);
      socket.off('room:call-end', ended);
      stream.current?.getTracks().forEach(t => t.stop());
      pcs.current.forEach(p => p.close());
      pcs.current.clear();
    };
  }, [roomId, type, userId, initiator, peerTarget, socket]);

  return <div className="call">
    <div className="videos room-videos">
      <div className="peer-grid"></div>
      <video ref={local} muted autoPlay playsInline className="local"/>
      <div className="callstate">{status}</div>
    </div>
    <div className="callbar">
      <button className="danger" onClick={() => { socket.emit('room:call-end', { roomId }); onClose(true); }}><PhoneOff/></button>
    </div>
  </div>;
}

function NavButton({ icon, label, active, badge, onClick }) {
  return <button className={`nav ${active ? 'active' : ''}`} onClick={onClick}>
    {icon}<span>{label}</span>{badge > 0 && <em>{badge > 99 ? '99+' : badge}</em>}
  </button>;
}

function App() {
  const [user, setUser] = useState(null);
  const [dark, setDark] = useState(() => localStorage.getItem('dark') === '1');
  const [view, setView] = useState('messages');
  const [users, setUsers] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [calls, setCalls] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [selected, setSelected] = useState(null);
  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [socket, setSocket] = useState(null);
  const [call, setCall] = useState(null);
  const [q, setQ] = useState('');
  const [typing, setTyping] = useState(false);
  const [incoming, setIncoming] = useState(null);
  const [roomIncoming, setRoomIncoming] = useState(null);
  const [createRoom, setCreateRoom] = useState(false);
  const [newRoom, setNewRoom] = useState('');
  const [addMember, setAddMember] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [mobileChat, setMobileChat] = useState(false);
  const selectedRef = useRef(null), roomRef = useRef(null), viewRef = useRef(view);
  const toastTimer = useRef(null);

  useEffect(() => { selectedRef.current = selected; roomRef.current = room; viewRef.current = view; }, [selected, room, view]);
  const showToast = (message, kind = 'info') => {
    setToast({ message, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };
  const loadUsers = async (query = '') => {
    try { setUsers((await api.get('/api/users', { params: { q: query } })).data); }
    catch (e) { if (e.response?.status === 401) logout(); }
  };
  const loadRooms = async () => {
    try { setRooms((await api.get('/api/rooms')).data); }
    catch (e) { if (e.response?.status === 401) logout(); }
  };
  const loadCalls = async () => { try { setCalls((await api.get('/api/calls')).data); } catch {} };
  const loadNotifications = async () => { try { setNotifications((await api.get('/api/notifications')).data); } catch {} };
  const logout = async () => {
    try { await api.post('/api/auth/logout'); } catch {}
    localStorage.removeItem('token'); socket?.disconnect(); setSocket(null); setUser(null);
  };

  useEffect(() => {
    if (!localStorage.getItem('token')) return;
    api.get('/api/auth/me').then(r => setUser(r.data.user)).catch(() => {
      localStorage.removeItem('token'); setUser(null);
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    loadUsers(); loadRooms(); loadCalls(); loadNotifications(); requestBrowserNotifications();
    const s = io(SOCKET, {
      auth: { token: localStorage.getItem('token') },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000
    });
    setSocket(s);
    s.on('connect_error', e => showToast(`Realtime connection error: ${e.message}`, 'error'));
    s.on('user:online', ({ userId }) => setUsers(x => x.map(u => String(u.id) === String(userId) ? { ...u, status: 'online' } : u)));
    s.on('user:offline', ({ userId }) => setUsers(x => x.map(u => String(u.id) === String(userId) ? { ...u, status: 'offline' } : u)));

    s.on('message:receive', m => {
      const senderId = entityId(m.sender);
      const receiverId = entityId(m.receiver);
      const currentUserId = String(user.id);
      const other = senderId === currentUserId ? receiverId : senderId;

      if (selectedRef.current && !roomRef.current && String(selectedRef.current.id) === String(other)) {
        setMessages(x => [...x.filter(a => String(a._id) !== String(m._id)), m]);
        if (receiverId === currentUserId && senderId) {
          api.post(`/api/messages/${senderId}/read`).catch(() => {});
        }
      }

      if (receiverId === currentUserId && senderId !== currentUserId) {
        const senderName = displayName(m.sender);
        setNotifications(x => [{
          _id: `message-${m._id}`,
          type: 'message',
          message: `${senderName} sent you a message`,
          sender: m.sender,
          data: { messageId: String(m._id), userId: senderId, senderName },
          read: false,
          createdAt: m.createdAt
        }, ...x.filter(n => String(n._id) !== `message-${m._id}`)].slice(0, 100));
      }
    });
    s.on('room:message', m => {
      if (roomRef.current && String(m.room) === String(roomRef.current._id)) {
        setMessages(x => [...x.filter(a => String(a._id) !== String(m._id)), m]);
      }
    });
    s.on('typing:start', ({ from }) => { if (selectedRef.current && String(from) === String(selectedRef.current.id)) setTyping(true); });
    s.on('typing:stop', ({ from }) => { if (selectedRef.current && String(from) === String(selectedRef.current.id)) setTyping(false); });

    s.on('notification:new', n => {
      setNotifications(x => [n, ...x.filter(a => String(a._id) !== String(n._id))].slice(0, 100));
      if (n.type === 'message') {
        const senderName = displayName(n.sender) !== 'Someone' ? displayName(n.sender) : n.data?.senderName || 'Someone';
        const messageText = n.message || `${senderName} sent you a message`;
        showToast(messageText, 'message');
        notifyBrowser(`New message from ${senderName}`, messageText);
      } else if (n.type === 'room-message') {
        showToast(n.message, 'room'); notifyBrowser('Room message', n.message);
      } else if (n.type === 'call') {
        showToast(n.message, 'call'); notifyBrowser('Incoming call', n.message);
      } else if (n.type === 'room-invite') {
        showToast(n.message, 'room'); notifyBrowser('Room invitation', n.message);
      } else if (n.type === 'room-call') {
        showToast(n.message, 'call'); notifyBrowser('Room call', n.message);
      }
    });
    s.on('room:added', r => { setRooms(x => [r, ...x.filter(a => String(a._id) !== String(r._id))]); showToast(`Added to room "${r.name}"`, 'room'); });
    s.on('room:updated', r => setRooms(x => x.map(a => String(a._id) === String(r._id) ? r : a)));
    s.on('room:removed', ({ roomId }) => {
      setRooms(x => x.filter(a => String(a._id) !== String(roomId)));
      if (roomRef.current && String(roomRef.current._id) === String(roomId)) { setRoom(null); setMobileChat(false); }
    });

    s.on('call:incoming', d => { setIncoming(d); notifyBrowser('Incoming call', `Incoming ${d.type} call`); });
    s.on('call:created', ({ callId }) => setCall(c => c ? { ...c, callId } : c));
    s.on('call:rejected', () => { showToast('Call rejected', 'error'); setCall(null); loadCalls(); });
    s.on('call:ended', () => { setCall(null); loadCalls(); });
    s.on('room:call-incoming', d => { setRoomIncoming(d); notifyBrowser('Room call', `Incoming ${d.type} call`); });
    s.on('room:call-end', () => setCall(null));
    return () => s.disconnect();
  }, [user]);

  useEffect(() => {
    if (!socket || !selected || room) return;
    setMessages([]);
    api.get('/api/messages/' + selected.id).then(r => setMessages(r.data)).catch(() => {});
    api.post('/api/messages/' + selected.id + '/read').catch(() => {});
  }, [selected, room, socket]);

  useEffect(() => {
    if (!socket || !room) return;
    setMessages([]);
    api.get('/api/rooms/' + room._id + '/messages').then(r => setMessages(r.data)).catch(() => {});
    socket.emit('room:join', { roomId: room._id });
    return () => socket.emit('room:leave', { roomId: room._id });
  }, [room, socket]);

  useEffect(() => {
    localStorage.setItem('dark', dark ? '1' : '0');
  }, [dark]);

  if (!user) return <Auth onLogin={setUser}/>;

  const selectUser = u => {
    setView('messages'); setSelected(u); setRoom(null); setTyping(false); setMobileChat(true);
  };
  const selectRoom = r => {
    setView('rooms'); setRoom(r); setSelected(null); setMobileChat(true);
  };
  const send = () => {
    const clean = text.trim(); if (!clean || !socket) return;
    if (room) socket.emit('room:message', { roomId: room._id, text: clean });
    else if (selected) socket.emit('message:send', { receiver: selected.id, text: clean });
    setText('');
    if (selected) socket.emit('typing:stop', { to: selected.id });
  };
  const beginCall = type => {
    if (!selected || !socket) return;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      showToast(
        window.isSecureContext
          ? 'This browser does not provide microphone/camera access.'
          : 'Microphone/camera calls require HTTPS on this device. Use localhost or an HTTPS URL.',
        'error'
      );
      return;
    }
    setCall({ target: selected.id, type, incoming: false, callId: null });
    setTimeout(() => socket.emit('call:invite', { to: selected.id, type }), 50);
  };
  const acceptCall = () => {
    if (!incoming) return;
    socket.emit('call:accept', { callId: incoming.callId, to: incoming.from });
    setCall({ target: incoming.from, type: incoming.type, incoming: true, accepted: true, callId: incoming.callId });
    setIncoming(null);
  };
  const acceptRoomCall = () => {
    if (!roomIncoming) return;
    const hostId = roomIncoming.from;
    const r = rooms.find(x => String(x._id) === String(roomIncoming.roomId));
    if (r) selectRoom(r);
    setCall({ roomId: roomIncoming.roomId, type: roomIncoming.type, roomCall: true, initiator: false, peerTarget: hostId });
    setRoomIncoming(null);
  };
  const addUserToRoom = async userId => {
    if (!room) return;
    try {
      const r = await api.post('/api/rooms/' + room._id + '/members', { userId });
      setRooms(x => x.map(a => String(a._id) === String(r.data._id) ? r.data : a));
      setRoom(r.data); setAddMember(false); setMemberQuery('');
      showToast('Member added successfully', 'room');
    } catch (e) { showToast(e.response?.data?.message || 'Could not add member', 'error'); }
  };
  const memberCandidates = users.filter(u =>
    !(room?.members || []).some(m => String(m._id || m.id) === String(u.id)) &&
    (memberQuery.trim() === '' || `${u.fullName} ${u.username}`.toLowerCase().includes(memberQuery.toLowerCase()))
  );
  const create = async () => {
    if (!newRoom.trim()) return;
    try {
      const r = await api.post('/api/rooms', { name: newRoom.trim(), isPrivate: true });
      setRooms(x => [r.data, ...x]); setRoom(r.data); setSelected(null); setNewRoom('');
      setCreateRoom(false); setView('rooms'); setMobileChat(true);
    } catch (e) { showToast(e.response?.data?.message || 'Could not create room', 'error'); }
  };
  const unread = notifications.filter(n => !n.read).length;
  const goBack = () => { setMobileChat(false); setSelected(null); setRoom(null); };

  return <div className={dark ? 'app dark' : 'app'}>
    <aside>
      <div className="brand">VO<span>IP</span></div>
      <nav>
        <NavButton icon={<MessageCircle/>} label="Messages" active={view === 'messages'} onClick={() => { setView('messages'); setMobileChat(false); }}/>
        <NavButton icon={<Users/>} label="Contacts" active={view === 'contacts'} onClick={() => { setView('contacts'); setMobileChat(false); loadUsers(q); }}/>
        <NavButton icon={<Phone/>} label="Calls" active={view === 'calls'} badge={calls.filter(c => c.status === 'ringing').length} onClick={() => { setView('calls'); setMobileChat(false); loadCalls(); }}/>
        <NavButton icon={<DoorOpen/>} label="Rooms" active={view === 'rooms'} onClick={() => { setView('rooms'); setMobileChat(false); loadRooms(); }}/>
        <NavButton icon={<Settings/>} label="Settings" active={view === 'settings'} onClick={() => { setView('settings'); setMobileChat(false); }}/>
      </nav>
      <div className="side-section">
        <div className="side-title">Rooms <button title="Create room" onClick={() => setCreateRoom(true)}><Plus size={15}/></button></div>
        {rooms.map(r => <button key={r._id} className={'room-link ' + (room?._id === r._id ? 'selected' : '')} onClick={() => selectRoom(r)}><DoorOpen size={17}/>{r.name}</button>)}
        {!rooms.length && <small className="muted">No rooms yet</small>}
      </div>
      <div className="profile">
        <div className="avatar">{user.fullName?.[0]?.toUpperCase()}</div>
        <div><b>{user.fullName}</b><small>@{user.username}</small></div>
        <button title="Logout" onClick={logout}><LogOut/></button>
      </div>
    </aside>

    <section className={`users ${mobileChat ? 'mobile-hide-list' : ''}`}>
      <div className="head">
        <h2>{view === 'messages' ? 'Messages' : view === 'contacts' ? 'Contacts' : view === 'rooms' ? 'Rooms' : view === 'calls' ? 'Calls' : 'Settings'}</h2>
        <div className="head-actions">
          <button className="icon-btn" title="Notifications" onClick={() => setNoticeOpen(v => !v)}><Bell/>{unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}</button>
          {(view === 'messages' || view === 'contacts' || view === 'rooms') && <button className="icon-btn" title="Create room" onClick={() => setCreateRoom(true)}><Plus/></button>}
        </div>
      </div>

      {(view === 'messages' || view === 'contacts') && <>
        <div className="search"><Search/><input placeholder="Search users…" value={q} onChange={async e => { const v = e.target.value; setQ(v); await loadUsers(v); }}/></div>
        {users.map(u => <button key={u.id} className={'user ' + (selected?.id === u.id && !room ? 'selected' : '')} onClick={() => selectUser(u)}>
          <div className="avatar">{u.fullName?.[0]?.toUpperCase()}</div><div className="usertext"><b>{u.fullName}</b><small>@{u.username}</small></div><i className={u.status === 'online' ? 'online' : ''}/>
        </button>)}
      </>}

      {view === 'rooms' && <div className="room-list-mobile">
        {rooms.map(r => <button key={r._id} className="room-card" onClick={() => selectRoom(r)}><DoorOpen/><div><b>{r.name}</b><small>{r.members?.length || 1} members</small></div></button>)}
        {!rooms.length && <div className="empty-list">No private rooms. Create one and add members.</div>}
      </div>}

      {view === 'calls' && <CallHistory calls={calls}/>}
      {view === 'settings' && <SettingsPanel user={user} setUser={setUser} dark={dark} setDark={setDark} showToast={showToast}/>}
    </section>

    <main className={mobileChat ? 'mobile-show-chat' : ''}>
      {view === 'settings' || view === 'calls' || (view === 'contacts' && !selected) ? (
        <div className="empty"><button className="mobile-back" onClick={goBack}><ArrowLeft/> Back</button><MessageCircle size={56}/><h2>{view === 'settings' ? 'Account settings' : view === 'calls' ? 'Call history' : 'Select a contact'}</h2><p>{view === 'settings' ? 'Use the Settings panel to update your account.' : 'Select an item from the left panel.'}</p></div>
      ) : room ? (
        <RoomChat room={room} user={user} messages={messages} text={text} setText={setText} send={send} setAddMember={setAddMember} setCall={setCall} goBack={goBack}/>
      ) : selected ? (
        <DirectChat selected={selected} user={user} messages={messages} text={text} setText={setText} send={send} typing={typing} onTyping={v => selected && socket?.emit(v ? 'typing:start' : 'typing:stop', { to: selected.id })} beginCall={beginCall} goBack={goBack}/>
      ) : <div className="empty"><MessageCircle size={56}/><h2>Your conversations</h2><p>Select a user or room to start.</p></div>}
    </main>

    <div className="mobile-nav">
      <NavButton icon={<MessageCircle/>} label="Messages" active={view === 'messages'} onClick={() => { setView('messages'); goBack(); }}/>
      <NavButton icon={<Users/>} label="Contacts" active={view === 'contacts'} onClick={() => { setView('contacts'); goBack(); loadUsers(q); }}/>
      <NavButton icon={<Phone/>} label="Calls" active={view === 'calls'} onClick={() => { setView('calls'); goBack(); loadCalls(); }}/>
      <NavButton icon={<DoorOpen/>} label="Rooms" active={view === 'rooms'} onClick={() => { setView('rooms'); goBack(); loadRooms(); }}/>
      <NavButton icon={<Settings/>} label="Settings" active={view === 'settings'} onClick={() => { setView('settings'); goBack(); }}/>
    </div>
    <div className="theme"><button title="Toggle theme" onClick={() => setDark(v => !v)}>{dark ? <Sun/> : <Moon/>}</button></div>

    {noticeOpen && <NotificationPanel
      notifications={notifications}
      onClose={() => setNoticeOpen(false)}
      onOpenMessage={n => {
        const senderId = entityId(n.sender) || String(n.data?.userId || '');
        const found = users.find(u => String(u.id) === senderId);
        if (found) {
          selectUser(found);
        } else if (senderId) {
          showToast('Sender is not available in the contact list. Search for the user to open the chat.', 'error');
        }
        setNotifications(x => x.map(a => String(a._id) === String(n._id) ? { ...a, read: true } : a));
        setNoticeOpen(false);
      }}
      onRead={async () => {
        await api.post('/api/notifications/read');
        setNotifications(x => x.map(n => ({ ...n, read: true })));
      }}
    />}
    {incoming && <div className="modal"><div className="modal-card"><h3>Incoming {incoming.type} call</h3><p>Someone is calling you.</p><div className="modal-actions"><button className="danger-btn" onClick={() => { socket.emit('call:reject', { callId: incoming.callId, to: incoming.from }); setIncoming(null); }}><X/> Reject</button><button className="primary" onClick={acceptCall}><Check/> Accept</button></div></div></div>}
    {roomIncoming && <div className="modal"><div className="modal-card"><h3>Incoming room {roomIncoming.type} call</h3><p>A room member started a call.</p><div className="modal-actions"><button onClick={() => setRoomIncoming(null)}>Dismiss</button><button className="primary" onClick={acceptRoomCall}><Check/> Join call</button></div></div></div>}
    {addMember && <div className="modal"><div className="modal-card"><h3>Add member to {room?.name}</h3><input autoFocus placeholder="Search user" value={memberQuery} onChange={async e => { const v = e.target.value; setMemberQuery(v); if (v) await loadUsers(v); }}/><div className="member-list">{memberCandidates.map(u => <button key={u.id} onClick={() => addUserToRoom(u.id)}><div className="avatar">{u.fullName?.[0]?.toUpperCase()}</div><div><b>{u.fullName}</b><small>@{u.username}</small></div><Plus/></button>)}</div><div className="modal-actions"><button onClick={() => setAddMember(false)}>Close</button></div></div></div>}
    {createRoom && <div className="modal"><div className="modal-card"><h3>Create private room</h3><p className="muted">Only the owner/admin can add participants.</p><input autoFocus placeholder="Room name" value={newRoom} onChange={e => setNewRoom(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()}/><div className="modal-actions"><button onClick={() => setCreateRoom(false)}>Cancel</button><button className="primary" onClick={create}>Create</button></div></div></div>}
    {call && (call.roomCall
      ? <RoomCall socket={socket} roomId={call.roomId} type={call.type} userId={user.id} initiator={call.initiator} peerTarget={call.peerTarget} onClose={() => setCall(null)}/>
      : <MediaCall socket={socket} call={call} onClose={() => setCall(null)}/>)}
    {toast && <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>{toast.message}</div>}
  </div>;
}

function DirectChat({ selected, user, messages, text, setText, send, typing, onTyping, beginCall, goBack }) {
  return <><header><div className="usertext"><button className="mobile-back" onClick={goBack}><ArrowLeft/></button><b>{selected.fullName}</b><small>{typing ? 'typing…' : selected.status}</small></div><div className="actions"><button title="Voice call" onClick={() => beginCall('voice')}><Phone/></button><button title="Video call" onClick={() => beginCall('video')}><Video/></button></div></header><Chat messages={messages} user={user} text={text} setText={setText} send={send} typing={typing} onTyping={onTyping}/></>;
}
function RoomChat({ room, user, messages, text, setText, send, setAddMember, setCall, goBack }) {
  const isAdmin = (room.admins || []).some(a => String(a._id || a) === String(user.id)) || String(room.owner?._id || room.owner) === String(user.id);
  return <><header><div><button className="mobile-back" onClick={goBack}><ArrowLeft/></button><b>{room.name}</b><small className="block-muted">{room.members?.length || 1} members</small></div><div className="actions">{isAdmin && <button title="Add members" onClick={() => setAddMember(true)}><Users/></button>}<button title="Room voice call" onClick={() => setCall({ roomId: room._id, type: 'voice', roomCall: true, initiator: true })}><Phone/></button><button title="Room video call" onClick={() => setCall({ roomId: room._id, type: 'video', roomCall: true, initiator: true })}><Video/></button></div></header><Chat messages={messages} user={user} text={text} setText={setText} send={send}/></>;
}
function Chat({ messages, user, text, setText, send, typing, onTyping }) {
  return <><div className="chat">{messages.map(m => {
    const senderId = m.sender?._id || m.sender;
    return <div key={m._id} className={`bubble ${String(senderId) === String(user.id) ? 'mine' : ''}`}>
      {m.room && String(senderId) !== String(user.id) && <small>{displayName(m.sender)}</small>}
      {m.message}
    </div>;
  })}{typing && <div className="typing">Typing…</div>}</div>
  <div className="composer"><input value={text} onChange={e => { setText(e.target.value); onTyping?.(e.target.value); }} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Write a message…"/><button onClick={send}><Send/></button></div></>;
}
function CallHistory({ calls }) {
  return <div className="call-history">{calls.map(c => <div className="history-item" key={c._id}><div className="avatar">{c.caller?.fullName?.[0]?.toUpperCase() || 'C'}</div><div><b>{c.caller?.fullName || 'Call'}</b><small>{c.callType} · {c.status} · {new Date(c.createdAt).toLocaleString()}</small></div><span>{c.status === 'accepted' ? '✓' : c.status}</span></div>)}{!calls.length && <div className="empty-list">No calls yet.</div>}</div>;
}
function NotificationPanel({ notifications, onClose, onRead, onOpenMessage }) {
  return <div className="notification-panel">
    <div className="panel-head"><b>Notifications</b><button onClick={onClose}><X/></button></div>
    {notifications.slice(0, 30).map(n => {
      const senderName = displayName(n.sender) !== 'Someone'
        ? displayName(n.sender)
        : n.data?.senderName || 'Someone';
      const isMessage = n.type === 'message';
      return <div
        key={n._id}
        className={`notification ${n.read ? '' : 'unread'}`}
        role={isMessage ? 'button' : undefined}
        tabIndex={isMessage ? 0 : undefined}
        onClick={() => isMessage && onOpenMessage?.(n)}
        onKeyDown={e => isMessage && e.key === 'Enter' && onOpenMessage?.(n)}
      >
        <b>{isMessage ? `Message from ${senderName}` : n.type.replaceAll('-', ' ')}</b>
        <span>{n.message}</span>
        <small>{new Date(n.createdAt).toLocaleString()}</small>
      </div>;
    })}
    {!notifications.length && <div className="empty-list">No notifications.</div>}
    <button className="read-all" onClick={onRead}>Mark all as read</button>
  </div>;
}
function SettingsPanel({ user, setUser, dark, setDark, showToast }) {
  const [name, setName] = useState(user.fullName);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const saveProfile = async e => {
    e.preventDefault(); setBusy(true);
    try { const r = await api.put('/api/users/profile', { fullName: name }); setUser(r.data.user); showToast('Profile updated', 'message'); }
    catch (e) { showToast(e.response?.data?.message || 'Could not update profile', 'error'); }
    finally { setBusy(false); }
  };
  const changePassword = async e => {
    e.preventDefault(); setBusy(true);
    try { await api.put('/api/users/change-password', { currentPassword, newPassword }); setCurrentPassword(''); setNewPassword(''); showToast('Password changed successfully', 'message'); }
    catch (e) { showToast(e.response?.data?.message || 'Could not change password', 'error'); }
    finally { setBusy(false); }
  };
  return <div className="settings-panel">
    <div className="settings-card"><h3>Profile</h3><form onSubmit={saveProfile}><label>Full name<input value={name} onChange={e => setName(e.target.value)}/></label><label>Username<input value={user.username} disabled/></label><label>Email<input value={user.email} disabled/></label><button className="primary" disabled={busy}><Save/> Save profile</button></form></div>
    <div className="settings-card"><h3>Security</h3><form onSubmit={changePassword}><label>Current password<input type="password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}/></label><label>New password<input type="password" minLength="8" required value={newPassword} onChange={e => setNewPassword(e.target.value)}/></label><button className="primary" disabled={busy}><Lock/> Change password</button></form></div>
    <div className="settings-card"><h3>Appearance</h3><button className="secondary" onClick={() => setDark(v => !v)}>{dark ? <Sun/> : <Moon/>} {dark ? 'Light mode' : 'Dark mode'}</button></div>
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
