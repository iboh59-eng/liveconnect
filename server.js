const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(express.static('public'));

// ============================================
// DATA STRUCTURES
// ============================================

const users = new Map();
let waitingQueue = [];
const reports = new Map();
const likes = new Map(); // oderId -> [userIds who liked]

const countries = [
  { code: '🇩🇪', name: 'Deutschland', region: 'europe' },
  { code: '🇺🇸', name: 'USA', region: 'americas' },
  { code: '🇬🇧', name: 'UK', region: 'europe' },
  { code: '🇫🇷', name: 'Frankreich', region: 'europe' },
  { code: '🇪🇸', name: 'Spanien', region: 'europe' },
  { code: '🇮🇹', name: 'Italien', region: 'europe' },
  { code: '🇯🇵', name: 'Japan', region: 'asia' },
  { code: '🇰🇷', name: 'Südkorea', region: 'asia' },
  { code: '🇧🇷', name: 'Brasilien', region: 'americas' },
  { code: '🇳🇱', name: 'Niederlande', region: 'europe' },
  { code: '🇵🇱', name: 'Polen', region: 'europe' },
  { code: '🇹🇷', name: 'Türkei', region: 'europe' },
  { code: '🇷🇺', name: 'Russland', region: 'europe' },
  { code: '🇮🇳', name: 'Indien', region: 'asia' },
  { code: '🇲🇽', name: 'Mexiko', region: 'americas' },
  { code: '🇦🇺', name: 'Australien', region: 'oceania' },
  { code: '🇨🇦', name: 'Kanada', region: 'americas' },
  { code: '🇦🇷', name: 'Argentinien', region: 'americas' },
  { code: '🇸🇦', name: 'Saudi-Arabien', region: 'asia' },
  { code: '🇪🇬', name: 'Ägypten', region: 'africa' }
];

const adjectives = ['Happy', 'Cool', 'Smart', 'Funny', 'Nice', 'Chill', 'Wild', 'Sweet', 'Brave', 'Lucky', 'Swift', 'Clever', 'Bright', 'Kind', 'Free'];
const nouns = ['Panda', 'Tiger', 'Eagle', 'Wolf', 'Fox', 'Bear', 'Lion', 'Hawk', 'Shark', 'Dragon', 'Phoenix', 'Dolphin', 'Panther', 'Owl', 'Cobra'];

const giftEmojis = ['❤️', '💎', '🌹', '🎁', '⭐', '🔥', '💫', '🦋', '🌸', '💝'];

// ============================================
// HELPER FUNCTIONS
// ============================================

function randomName() {
  return adjectives[Math.floor(Math.random() * adjectives.length)] + 
         nouns[Math.floor(Math.random() * nouns.length)] + 
         Math.floor(Math.random() * 100);
}

function randomCountry() {
  return countries[Math.floor(Math.random() * countries.length)];
}

function broadcastStats() {
  const online = users.size;
  const inCall = [...users.values()].filter(u => u.inCall).length;
  const searching = waitingQueue.length;
  
  io.emit('stats', { 
    online, 
    inCall: Math.floor(inCall / 2),
    searching,
    countries: new Set([...users.values()].map(u => u.country.code)).size
  });
}

function findMatch(socketId, filter = {}) {
  const user = users.get(socketId);
  if (!user) return null;

  for (let i = 0; i < waitingQueue.length; i++) {
    const matchId = waitingQueue[i];
    if (matchId === socketId) continue;
    
    const match = users.get(matchId);
    if (!match || match.inCall || !match.searching) continue;
    
    // Apply filters
    if (filter.region && match.country.region !== filter.region) continue;
    if (filter.gender && match.gender !== filter.gender) continue;
    
    waitingQueue.splice(i, 1);
    return matchId;
  }
  return null;
}

function createMatch(id1, id2) {
  const u1 = users.get(id1);
  const u2 = users.get(id2);
  
  if (!u1 || !u2) return;
  
  u1.inCall = true;
  u1.partnerId = id2;
  u1.searching = false;
  u1.callStartTime = Date.now();
  
  u2.inCall = true;
  u2.partnerId = id1;
  u2.searching = false;
  u2.callStartTime = Date.now();
  
  console.log(`Match: ${u1.name} <-> ${u2.name}`);
}

function endCall(socketId) {
  const user = users.get(socketId);
  if (!user) return;
  
  const partnerId = user.partnerId;
  
  user.inCall = false;
  user.partnerId = null;
  user.callStartTime = null;
  
  if (partnerId) {
    const partner = users.get(partnerId);
    if (partner) {
      partner.inCall = false;
      partner.partnerId = null;
      partner.callStartTime = null;
    }
  }
  
  return partnerId;
}

// ============================================
// SOCKET.IO
// ============================================

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);
  
  // Initialize user
  const user = {
    id: socket.id,
    name: randomName(),
    country: randomCountry(),
    gender: null,
    inCall: false,
    partnerId: null,
    searching: false,
    callStartTime: null,
    filter: {},
    likes: 0,
    gifts: []
  };
  users.set(socket.id, user);
  
  socket.emit('user-info', user);
  broadcastStats();
  
  // Set user preferences
  socket.on('set-preferences', (data) => {
    const u = users.get(socket.id);
    if (u) {
      if (data.gender) u.gender = data.gender;
      if (data.filter) u.filter = data.filter;
      if (data.name) u.name = String(data.name).slice(0, 20);
    }
  });
  
  // Find match with filters
  socket.on('find-match', (filter = {}) => {
    const u = users.get(socket.id);
    if (!u || u.searching || u.inCall) return;
    
    u.searching = true;
    u.filter = filter || {};
    
    const matchId = findMatch(socket.id, filter);
    
    if (matchId) {
      const match = users.get(matchId);
      createMatch(socket.id, matchId);
      
      socket.emit('match-found', {
        oderId: matchId,
        partnerName: match.name,
        partnerCountry: match.country,
        partnerGender: match.gender,
        isInitiator: true
      });
      
      io.to(matchId).emit('match-found', {
        partnerId: socket.id,
        partnerName: u.name,
        partnerCountry: u.country,
        partnerGender: u.gender,
        isInitiator: false
      });
      
      broadcastStats();
    } else {
      if (!waitingQueue.includes(socket.id)) {
        waitingQueue.push(socket.id);
      }
      socket.emit('searching', { position: waitingQueue.indexOf(socket.id) + 1 });
    }
  });
  
  // Cancel search
  socket.on('cancel-search', () => {
    const u = users.get(socket.id);
    if (u) {
      u.searching = false;
      waitingQueue = waitingQueue.filter(id => id !== socket.id);
    }
  });
  
  // Next partner
  socket.on('next-partner', () => {
    const partnerId = endCall(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('partner-left', { reason: 'skipped' });
    }
    waitingQueue = waitingQueue.filter(id => id !== socket.id);
    socket.emit('ready-for-next');
    broadcastStats();
  });
  
  // End call
  socket.on('end-call', () => {
    const partnerId = endCall(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('partner-left', { reason: 'ended' });
    }
    socket.emit('call-ended');
    broadcastStats();
  });
  
  // WebRTC Signaling
  socket.on('webrtc-offer', (data) => {
    const u = users.get(socket.id);
    if (u?.partnerId) {
      io.to(u.partnerId).emit('webrtc-offer', { offer: data.offer });
    }
  });
  
  socket.on('webrtc-answer', (data) => {
    const u = users.get(socket.id);
    if (u?.partnerId) {
      io.to(u.partnerId).emit('webrtc-answer', { answer: data.answer });
    }
  });
  
  socket.on('ice-candidate', (data) => {
    const u = users.get(socket.id);
    if (u?.partnerId) {
      io.to(u.partnerId).emit('ice-candidate', { candidate: data.candidate });
    }
  });
  
  // Chat
  socket.on('chat-message', (data) => {
    const u = users.get(socket.id);
    if (u?.partnerId) {
      const msg = String(data.message).slice(0, 500).trim();
      if (msg) {
        io.to(u.partnerId).emit('chat-message', {
          message: msg,
          from: u.name,
          timestamp: Date.now()
        });
      }
    }
  });
  
  socket.on('typing', () => {
    const u = users.get(socket.id);
    if (u?.partnerId) {
      io.to(u.partnerId).emit('partner-typing');
    }
  });
  
  // Like partner
  socket.on('like-partner', () => {
    const u = users.get(socket.id);
    if (u?.partnerId) {
      const partner = users.get(u.partnerId);
      if (partner) {
        partner.likes++;
        io.to(u.partnerId).emit('received-like', { from: u.name });
        socket.emit('like-sent');
      }
    }
  });
  
  // Send gift
  socket.on('send-gift', (data) => {
    const u = users.get(socket.id);
    if (u?.partnerId) {
      const gift = giftEmojis.includes(data.gift) ? data.gift : '❤️';
      io.to(u.partnerId).emit('received-gift', { 
        gift, 
        from: u.name 
      });
      socket.emit('gift-sent', { gift });
    }
  });
  
  // Report
  socket.on('report-user', (data) => {
    const u = users.get(socket.id);
    if (u?.partnerId) {
      reports.set(Date.now(), {
        reporter: socket.id,
        reported: u.partnerId,
        reason: data.reason || 'other',
        timestamp: Date.now()
      });
      socket.emit('report-received');
    }
  });
  
  // Add friend
  socket.on('add-friend', () => {
    const u = users.get(socket.id);
    if (u?.partnerId) {
      io.to(u.partnerId).emit('friend-request', { from: u.name, fromId: socket.id });
    }
  });
  
  socket.on('accept-friend', (data) => {
    if (data.fromId) {
      io.to(data.fromId).emit('friend-accepted', { by: users.get(socket.id)?.name });
    }
  });
  
  // Disconnect
  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    
    const u = users.get(socket.id);
    if (u?.partnerId) {
      const partner = users.get(u.partnerId);
      if (partner) {
        partner.inCall = false;
        partner.partnerId = null;
        io.to(u.partnerId).emit('partner-left', { reason: 'disconnected' });
      }
    }
    
    waitingQueue = waitingQueue.filter(id => id !== socket.id);
    users.delete(socket.id);
    broadcastStats();
  });
});

// Stats broadcast every 5 seconds
setInterval(broadcastStats, 5000);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', users: users.size });
});

// Start
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎥 LiveConnect running on port ${PORT}`);
});
