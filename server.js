const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
  cors: { origin: '*' }
});

app.use(express.static('public'));

// ============================================
// DATA STRUCTURES
// ============================================

const users = new Map();
const waitingQueues = {
  all: [],
  male: [],
  female: []
};
const friendships = new Map();
const blockedUsers = new Map();
const reports = [];

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
  { code: '🇪🇬', name: 'Ägypten', region: 'africa' },
  { code: '🇨🇭', name: 'Schweiz', region: 'europe' },
  { code: '🇦🇹', name: 'Österreich', region: 'europe' },
  { code: '🇧🇪', name: 'Belgien', region: 'europe' },
  { code: '🇸🇪', name: 'Schweden', region: 'europe' },
  { code: '🇳🇴', name: 'Norwegen', region: 'europe' }
];

const adjectives = ['Happy', 'Cool', 'Smart', 'Funny', 'Nice', 'Chill', 'Wild', 'Sweet', 'Brave', 'Lucky', 'Swift', 'Clever', 'Bright', 'Kind', 'Free', 'Bold', 'Calm', 'Epic', 'Fresh', 'Grand'];
const nouns = ['Panda', 'Tiger', 'Eagle', 'Wolf', 'Fox', 'Bear', 'Lion', 'Hawk', 'Shark', 'Dragon', 'Phoenix', 'Dolphin', 'Panther', 'Owl', 'Cobra', 'Falcon', 'Jaguar', 'Raven', 'Viper', 'Lynx'];

const gifts = [
  { id: 'heart', emoji: '❤️', name: 'Herz', coins: 10 },
  { id: 'rose', emoji: '🌹', name: 'Rose', coins: 20 },
  { id: 'diamond', emoji: '💎', name: 'Diamant', coins: 50 },
  { id: 'crown', emoji: '👑', name: 'Krone', coins: 100 },
  { id: 'fire', emoji: '🔥', name: 'Feuer', coins: 15 },
  { id: 'star', emoji: '⭐', name: 'Stern', coins: 25 },
  { id: 'kiss', emoji: '💋', name: 'Kuss', coins: 30 },
  { id: 'ring', emoji: '💍', name: 'Ring', coins: 200 },
  { id: 'teddy', emoji: '🧸', name: 'Teddy', coins: 40 },
  { id: 'rocket', emoji: '🚀', name: 'Rakete', coins: 75 },
  { id: 'rainbow', emoji: '🌈', name: 'Regenbogen', coins: 35 },
  { id: 'cake', emoji: '🎂', name: 'Kuchen', coins: 45 }
];

// ============================================
// HELPER FUNCTIONS
// ============================================

function randomName() {
  return adjectives[Math.floor(Math.random() * adjectives.length)] + 
         nouns[Math.floor(Math.random() * nouns.length)] + 
         Math.floor(Math.random() * 1000);
}

function randomCountry() {
  return countries[Math.floor(Math.random() * countries.length)];
}

function broadcastStats() {
  const online = users.size;
  const searching = waitingQueues.all.length + waitingQueues.male.length + waitingQueues.female.length;
  const inCall = [...users.values()].filter(u => u.inCall).length;
  
  io.emit('stats', { 
    online, 
    searching,
    inCall: Math.floor(inCall / 2)
  });
}

function removeFromQueues(socketId) {
  for (const queue of Object.values(waitingQueues)) {
    const idx = queue.indexOf(socketId);
    if (idx > -1) queue.splice(idx, 1);
  }
}

function findMatch(socketId) {
  const user = users.get(socketId);
  if (!user) return null;

  // Determine which queue to search based on user's preference
  let searchQueue = waitingQueues.all;
  
  if (user.lookingFor === 'male') {
    searchQueue = waitingQueues.male;
  } else if (user.lookingFor === 'female') {
    searchQueue = waitingQueues.female;
  }

  // Search for a match
  for (let i = 0; i < searchQueue.length; i++) {
    const matchId = searchQueue[i];
    if (matchId === socketId) continue;
    
    const match = users.get(matchId);
    if (!match || match.inCall) continue;
    
    // Check if blocked
    if (blockedUsers.get(socketId)?.includes(matchId) || 
        blockedUsers.get(matchId)?.includes(socketId)) continue;
    
    // Check region filter
    if (user.regionFilter && match.country.region !== user.regionFilter) continue;
    if (match.regionFilter && user.country.region !== match.regionFilter) continue;
    
    // Check gender compatibility
    if (match.lookingFor && match.lookingFor !== 'all' && match.lookingFor !== user.gender) continue;
    
    // Found a match!
    searchQueue.splice(i, 1);
    return matchId;
  }
  
  // Also search in 'all' queue if not already
  if (searchQueue !== waitingQueues.all) {
    for (let i = 0; i < waitingQueues.all.length; i++) {
      const matchId = waitingQueues.all[i];
      if (matchId === socketId) continue;
      
      const match = users.get(matchId);
      if (!match || match.inCall) continue;
      
      if (blockedUsers.get(socketId)?.includes(matchId) || 
          blockedUsers.get(matchId)?.includes(socketId)) continue;
      
      if (user.regionFilter && match.country.region !== user.regionFilter) continue;
      if (match.regionFilter && user.country.region !== match.regionFilter) continue;
      
      waitingQueues.all.splice(i, 1);
      return matchId;
    }
  }
  
  return null;
}

function createMatch(id1, id2) {
  const u1 = users.get(id1);
  const u2 = users.get(id2);
  
  if (!u1 || !u2) return false;
  
  u1.inCall = true;
  u1.partnerId = id2;
  u1.searching = false;
  u1.callStartTime = Date.now();
  
  u2.inCall = true;
  u2.partnerId = id1;
  u2.searching = false;
  u2.callStartTime = Date.now();
  
  removeFromQueues(id1);
  removeFromQueues(id2);
  
  console.log(`Match: ${u1.name} <-> ${u2.name}`);
  return true;
}

function endCall(socketId) {
  const user = users.get(socketId);
  if (!user) return null;
  
  const partnerId = user.partnerId;
  const callDuration = user.callStartTime ? Date.now() - user.callStartTime : 0;
  
  user.inCall = false;
  user.partnerId = null;
  user.callStartTime = null;
  user.totalCallTime = (user.totalCallTime || 0) + callDuration;
  
  if (partnerId) {
    const partner = users.get(partnerId);
    if (partner) {
      partner.inCall = false;
      partner.partnerId = null;
      partner.callStartTime = null;
      partner.totalCallTime = (partner.totalCallTime || 0) + callDuration;
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
    lookingFor: 'all',
    regionFilter: null,
    inCall: false,
    partnerId: null,
    searching: false,
    callStartTime: null,
    totalCallTime: 0,
    coins: 100, // Starting coins
    receivedGifts: [],
    likes: 0,
    friends: []
  };
  users.set(socket.id, user);
  
  socket.emit('init', { 
    user, 
    gifts,
    countries
  });
  broadcastStats();
  
  // Update profile
  socket.on('update-profile', (data) => {
    const u = users.get(socket.id);
    if (!u) return;
    
    if (data.name) u.name = String(data.name).slice(0, 20).trim() || u.name;
    if (data.gender) u.gender = ['male', 'female'].includes(data.gender) ? data.gender : null;
    if (data.lookingFor !== undefined) u.lookingFor = ['all', 'male', 'female'].includes(data.lookingFor) ? data.lookingFor : 'all';
    if (data.regionFilter !== undefined) u.regionFilter = data.regionFilter || null;
    
    socket.emit('profile-updated', { user: u });
  });
  
  // Find match
  socket.on('find-match', () => {
    const u = users.get(socket.id);
    if (!u || u.searching || u.inCall) return;
    
    u.searching = true;
    removeFromQueues(socket.id);
    
    const matchId = findMatch(socket.id);
    
    if (matchId) {
      const match = users.get(matchId);
      if (createMatch(socket.id, matchId)) {
        // Notify both users
        socket.emit('match-found', {
          oderId: matchId,
          partner: {
            id: matchId,
            name: match.name,
            country: match.country,
            gender: match.gender
          },
          isInitiator: true
        });
        
        io.to(matchId).emit('match-found', {
          partnerId: socket.id,
          partner: {
            id: socket.id,
            name: u.name,
            country: u.country,
            gender: u.gender
          },
          isInitiator: false
        });
        
        broadcastStats();
      }
    } else {
      // Add to appropriate queue
      if (u.gender === 'male') {
        waitingQueues.male.push(socket.id);
      } else if (u.gender === 'female') {
        waitingQueues.female.push(socket.id);
      } else {
        waitingQueues.all.push(socket.id);
      }
      
      socket.emit('searching', { 
        position: waitingQueues.all.length + waitingQueues.male.length + waitingQueues.female.length 
      });
      broadcastStats();
    }
  });
  
  // Cancel search
  socket.on('cancel-search', () => {
    const u = users.get(socket.id);
    if (u) {
      u.searching = false;
      removeFromQueues(socket.id);
      socket.emit('search-cancelled');
      broadcastStats();
    }
  });
  
  // Next partner
  socket.on('next-partner', () => {
    const partnerId = endCall(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('partner-left', { reason: 'skipped' });
    }
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
  
  // Chat message
  socket.on('chat-message', (data) => {
    const u = users.get(socket.id);
    if (u?.partnerId) {
      const msg = String(data.message || '').slice(0, 500).trim();
      if (msg) {
        io.to(u.partnerId).emit('chat-message', {
          message: msg,
          from: u.name,
          timestamp: Date.now()
        });
      }
    }
  });
  
  // Typing indicator
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
        io.to(u.partnerId).emit('received-like', { 
          from: u.name,
          totalLikes: partner.likes 
        });
        socket.emit('like-sent');
      }
    }
  });
  
  // Send gift
  socket.on('send-gift', (data) => {
    const u = users.get(socket.id);
    if (!u?.partnerId) return;
    
    const gift = gifts.find(g => g.id === data.giftId);
    if (!gift) return;
    
    if (u.coins < gift.coins) {
      socket.emit('insufficient-coins', { needed: gift.coins, have: u.coins });
      return;
    }
    
    u.coins -= gift.coins;
    
    const partner = users.get(u.partnerId);
    if (partner) {
      partner.receivedGifts.push({
        gift: gift,
        from: u.name,
        timestamp: Date.now()
      });
      partner.coins += Math.floor(gift.coins * 0.5); // Partner gets 50% as coins
      
      io.to(u.partnerId).emit('received-gift', { 
        gift,
        from: u.name,
        newCoins: partner.coins
      });
    }
    
    socket.emit('gift-sent', { 
      gift,
      newCoins: u.coins 
    });
  });
  
  // Add friend
  socket.on('send-friend-request', () => {
    const u = users.get(socket.id);
    if (u?.partnerId) {
      io.to(u.partnerId).emit('friend-request', { 
        from: u.name, 
        fromId: socket.id 
      });
      socket.emit('friend-request-sent');
    }
  });
  
  socket.on('accept-friend-request', (data) => {
    const u = users.get(socket.id);
    const friend = users.get(data.fromId);
    
    if (u && friend) {
      if (!u.friends.includes(data.fromId)) {
        u.friends.push(data.fromId);
      }
      if (!friend.friends.includes(socket.id)) {
        friend.friends.push(socket.id);
      }
      
      io.to(data.fromId).emit('friend-request-accepted', { 
        by: u.name,
        oderId: socket.id 
      });
      socket.emit('friend-added', { friend: friend.name });
    }
  });
  
  socket.on('decline-friend-request', (data) => {
    io.to(data.fromId).emit('friend-request-declined');
  });
  
  // Block user
  socket.on('block-user', () => {
    const u = users.get(socket.id);
    if (u?.partnerId) {
      if (!blockedUsers.has(socket.id)) {
        blockedUsers.set(socket.id, []);
      }
      blockedUsers.get(socket.id).push(u.partnerId);
      
      // End the call
      const partnerId = endCall(socket.id);
      if (partnerId) {
        io.to(partnerId).emit('partner-left', { reason: 'blocked' });
      }
      socket.emit('user-blocked');
      broadcastStats();
    }
  });
  
  // Report user
  socket.on('report-user', (data) => {
    const u = users.get(socket.id);
    if (u?.partnerId) {
      reports.push({
        reporter: socket.id,
        reported: u.partnerId,
        reason: data.reason || 'other',
        details: data.details || '',
        timestamp: Date.now()
      });
      
      // Block and skip
      if (!blockedUsers.has(socket.id)) {
        blockedUsers.set(socket.id, []);
      }
      blockedUsers.get(socket.id).push(u.partnerId);
      
      const partnerId = endCall(socket.id);
      if (partnerId) {
        io.to(partnerId).emit('partner-left', { reason: 'reported' });
      }
      
      socket.emit('report-submitted');
      broadcastStats();
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
    
    removeFromQueues(socket.id);
    users.delete(socket.id);
    broadcastStats();
  });
});

// Broadcast stats every 3 seconds
setInterval(broadcastStats, 3000);

// Cleanup stale connections every minute
setInterval(() => {
  const now = Date.now();
  for (const [id, user] of users) {
    if (user.searching && !user.inCall) {
      // Check if user is still connected
      const socket = io.sockets.sockets.get(id);
      if (!socket?.connected) {
        removeFromQueues(id);
        users.delete(id);
      }
    }
  }
}, 60000);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    users: users.size,
    searching: waitingQueues.all.length + waitingQueues.male.length + waitingQueues.female.length
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`📺 BrownTV running on port ${PORT}`);
});
