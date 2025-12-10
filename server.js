const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const Redis = require('redis');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true
  }
});

// Redis für Skalierbarkeit (für Render.com)
const redisClient = Redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.connect();

app.use(express.json());
app.use(express.static('public'));

// ============================================
// AZAR-STYLE MATCHMAKING SYSTEM
// ============================================

class MatchmakingSystem {
  constructor() {
    this.waitingUsers = new Map(); // gender -> queue
    this.activeCalls = new Map();
    this.userSessions = new Map();
    this.userStats = new Map();
    
    this.waitingUsers.set('all', []);
    this.waitingUsers.set('male', []);
    this.waitingUsers.set('female', []);
    this.waitingUsers.set('random', []);
  }
  
  async addUserToQueue(socketId, userData) {
    const queueType = userData.lookingFor || 'all';
    const queue = this.waitingUsers.get(queueType) || this.waitingUsers.get('all');
    
    // Check if user is already in queue
    for (const [gender, q] of this.waitingUsers) {
      const index = q.indexOf(socketId);
      if (index > -1) {
        q.splice(index, 1);
      }
    }
    
    queue.push(socketId);
    await redisClient.hSet('user:' + socketId, {
      ...userData,
      joinedAt: Date.now(),
      queue: queueType
    });
    
    return queue.length;
  }
  
  async findMatch(socketId) {
    const userData = await redisClient.hGetAll('user:' + socketId);
    if (!userData) return null;
    
    const preferredGender = userData.lookingFor || 'all';
    const userGender = userData.gender || 'unknown';
    
    // Try exact match first
    let match = await this.findExactMatch(socketId, userData, preferredGender);
    if (match) return match;
    
    // Try reverse match (if user is looking for all, but someone is looking for their gender)
    if (preferredGender === 'all') {
      match = await this.findReverseMatch(socketId, userData);
      if (match) return match;
    }
    
    // Try random match
    return await this.findRandomMatch(socketId, userData);
  }
  
  async findExactMatch(socketId, userData, preferredGender) {
    const queue = this.waitingUsers.get(preferredGender) || [];
    
    for (let i = 0; i < queue.length; i++) {
      const candidateId = queue[i];
      if (candidateId === socketId) continue;
      
      const candidateData = await redisClient.hGetAll('user:' + candidateId);
      if (!candidateData || candidateData.inCall === 'true') continue;
      
      // Check if candidate is looking for user's gender or 'all'
      const candidatePref = candidateData.lookingFor || 'all';
      if (candidatePref === 'all' || candidatePref === userData.gender) {
        // Remove from queue
        queue.splice(i, 1);
        return candidateId;
      }
    }
    
    return null;
  }
  
  async findReverseMatch(socketId, userData) {
    const userGender = userData.gender;
    if (!userGender) return null;
    
    // Look for users who are specifically looking for user's gender
    const reverseQueue = this.waitingUsers.get(userGender) || [];
    
    for (let i = 0; i < reverseQueue.length; i++) {
      const candidateId = reverseQueue[i];
      if (candidateId === socketId) continue;
      
      const candidateData = await redisClient.hGetAll('user:' + candidateId);
      if (!candidateData || candidateData.inCall === 'true') continue;
      
      // Candidate is looking for user's gender specifically
      reverseQueue.splice(i, 1);
      return candidateId;
    }
    
    return null;
  }
  
  async findRandomMatch(socketId, userData) {
    // Try all queues in order
    const queues = ['all', 'male', 'female', 'random'];
    
    for (const queueType of queues) {
      const queue = this.waitingUsers.get(queueType) || [];
      
      for (let i = 0; i < queue.length; i++) {
        const candidateId = queue[i];
        if (candidateId === socketId) continue;
        
        const candidateData = await redisClient.hGetAll('user:' + candidateId);
        if (!candidateData || candidateData.inCall === 'true') continue;
        
        // Accept any available user
        queue.splice(i, 1);
        return candidateId;
      }
    }
    
    return null;
  }
  
  async removeUserFromAllQueues(socketId) {
    for (const [gender, queue] of this.waitingUsers) {
      const index = queue.indexOf(socketId);
      if (index > -1) {
        queue.splice(index, 1);
      }
    }
    await redisClient.del('user:' + socketId);
  }
  
  async createCall(user1Id, user2Id) {
    const callId = uuidv4();
    const callData = {
      id: callId,
      users: [user1Id, user2Id],
      startTime: Date.now(),
      status: 'active'
    };
    
    this.activeCalls.set(callId, callData);
    
    // Update user status
    await redisClient.hSet('user:' + user1Id, { inCall: 'true', partnerId: user2Id, callId });
    await redisClient.hSet('user:' + user2Id, { inCall: 'true', partnerId: user1Id, callId });
    
    return callId;
  }
  
  async endCall(callId) {
    const call = this.activeCalls.get(callId);
    if (!call) return;
    
    call.endTime = Date.now();
    call.duration = call.endTime - call.startTime;
    call.status = 'ended';
    
    // Update user stats
    for (const userId of call.users) {
      await redisClient.hSet('user:' + userId, { 
        inCall: 'false', 
        partnerId: '',
        callId: ''
      });
      
      // Update total call time
      const stats = this.userStats.get(userId) || { totalCalls: 0, totalTime: 0 };
      stats.totalCalls += 1;
      stats.totalTime += call.duration;
      this.userStats.set(userId, stats);
    }
    
    this.activeCalls.delete(callId);
  }
}

const matchmaker = new MatchmakingSystem();

// ============================================
// ENHANCED USER DATA
// ============================================

const userProfiles = new Map();
const gifts = [
  { id: 'heart', emoji: '❤️', name: 'Herz', coins: 10, effect: 'heartExplosion' },
  { id: 'rose', emoji: '🌹', name: 'Rose', coins: 20, effect: 'flowerRain' },
  { id: 'kiss', emoji: '💋', name: 'Kuss', coins: 30, effect: 'kissFlash' },
  { id: 'diamond', emoji: '💎', name: 'Diamant', coins: 50, effect: 'diamondShower' },
  { id: 'crown', emoji: '👑', name: 'Krone', coins: 100, effect: 'crownGlow' },
  { id: 'fire', emoji: '🔥', name: 'Feuer', coins: 15, effect: 'fireworks' },
  { id: 'star', emoji: '⭐', name: 'Stern', coins: 25, effect: 'starFall' },
  { id: 'teddy', emoji: '🧸', name: 'Teddy', coins: 40, effect: 'teddyBounce' },
  { id: 'rocket', emoji: '🚀', name: 'Rakete', coins: 75, effect: 'rocketLaunch' },
  { id: 'rainbow', emoji: '🌈', name: 'Regenbogen', coins: 35, effect: 'rainbowArc' },
  { id: 'money', emoji: '💰', name: 'Geld', coins: 80, effect: 'moneyRain' },
  { id: 'trophy', emoji: '🏆', name: 'Trophy', coins: 150, effect: 'trophyWin' }
];

const countries = [
  { code: '🌍', name: 'Global', flag: '🏳️' },
  { code: '🇩🇪', name: 'Germany', flag: '🇩🇪' },
  { code: '🇺🇸', name: 'USA', flag: '🇺🇸' },
  { code: '🇬🇧', name: 'UK', flag: '🇬🇧' },
  { code: '🇫🇷', name: 'France', flag: '🇫🇷' },
  { code: '🇪🇸', name: 'Spain', flag: '🇪🇸' },
  { code: '🇮🇹', name: 'Italy', flag: '🇮🇹' },
  { code: '🇯🇵', name: 'Japan', flag: '🇯🇵' },
  { code: '🇰🇷', name: 'South Korea', flag: '🇰🇷' },
  { code: '🇧🇷', name: 'Brazil', flag: '🇧🇷' },
  { code: '🇷🇺', name: 'Russia', flag: '🇷🇺' },
  { code: '🇨🇳', name: 'China', flag: '🇨🇳' },
  { code: '🇮🇳', name: 'India', flag: '🇮🇳' },
  { code: '🇹🇷', name: 'Turkey', flag: '🇹🇷' },
  { code: '🇵🇱', name: 'Poland', flag: '🇵🇱' },
  { code: '🇳🇱', name: 'Netherlands', flag: '🇳🇱' }
];

const interests = [
  'Music', 'Sports', 'Gaming', 'Movies', 'Travel', 'Food', 
  'Fashion', 'Art', 'Technology', 'Dance', 'Photography',
  'Fitness', 'Reading', 'Cooking', 'Animals', 'Nature'
];

// ============================================
// SOCKET.IO EVENT HANDLERS
// ============================================

io.on('connection', async (socket) => {
  console.log('New user connected:', socket.id);
  
  // Initialize user with Azar-like profile
  const userId = socket.id;
  const userProfile = {
    id: userId,
    name: `User${Math.floor(Math.random() * 10000)}`,
    gender: null,
    lookingFor: 'all',
    age: Math.floor(Math.random() * 30) + 18,
    country: countries[Math.floor(Math.random() * countries.length)],
    interests: [],
    coins: 1000,
    gems: 50,
    level: 1,
    experience: 0,
    totalCalls: 0,
    totalTime: 0,
    likes: 0,
    gifts: [],
    friends: [],
    blocked: [],
    isOnline: true,
    lastSeen: Date.now(),
    inCall: false,
    partnerId: null,
    videoEnabled: true,
    audioEnabled: true,
    filters: [],
    effects: [],
    theme: 'dark',
    language: 'en',
    notifications: true,
    createdAt: Date.now()
  };
  
  userProfiles.set(userId, userProfile);
  
  // Save to Redis
  await redisClient.hSet('user:' + userId, userProfile);
  
  // Send initial data
  socket.emit('init', {
    user: userProfile,
    gifts,
    countries,
    interests,
    onlineCount: await getOnlineCount()
  });
  
  // Broadcast updated stats
  broadcastStats();
  
  // ========== AZAR FEATURES ==========
  
  // 1. UPDATE PROFILE
  socket.on('update-profile', async (data) => {
    const profile = userProfiles.get(userId);
    if (!profile) return;
    
    Object.assign(profile, data);
    await redisClient.hSet('user:' + userId, profile);
    
    socket.emit('profile-updated', { user: profile });
  });
  
  // 2. FIND MATCH (Azar-style)
  socket.on('find-match', async (filters = {}) => {
    const profile = userProfiles.get(userId);
    if (!profile || profile.inCall) return;
    
    // Update preferences
    if (filters.gender) profile.lookingFor = filters.gender;
    if (filters.country) profile.country = filters.country;
    
    // Add to matchmaking queue
    const position = await matchmaker.addUserToQueue(userId, profile);
    
    socket.emit('searching', {
      position,
      estimatedTime: position * 2,
      searchingFor: profile.lookingFor
    });
    
    // Try to find immediate match
    setTimeout(async () => {
      if (!profile.inCall) {
        const matchId = await matchmaker.findMatch(userId);
        if (matchId) {
          await createMatch(userId, matchId);
        }
      }
    }, 1000);
  });
  
  // 3. INSTANT CONNECT (Azar Premium Feature)
  socket.on('instant-connect', async () => {
    const profile = userProfiles.get(userId);
    if (!profile || profile.gems < 10) {
      socket.emit('instant-failed', { reason: 'insufficient_gems' });
      return;
    }
    
    profile.gems -= 10;
    
    // Find any available user
    for (const [id, user] of userProfiles) {
      if (id !== userId && !user.inCall && user.isOnline) {
        await createMatch(userId, id);
        return;
      }
    }
    
    socket.emit('instant-failed', { reason: 'no_users_available' });
  });
  
  // 4. FILTERED SEARCH
  socket.on('filtered-search', async (filters) => {
    const profile = userProfiles.get(userId);
    if (!profile) return;
    
    // Apply filters
    profile.searchFilters = filters;
    await matchmaker.addUserToQueue(userId, profile);
    
    socket.emit('searching-filtered', { filters });
  });
  
  // 5. VIDEO CALL CONTROLS
  socket.on('toggle-video', (state) => {
    const profile = userProfiles.get(userId);
    if (profile && profile.partnerId) {
      io.to(profile.partnerId).emit('partner-video-toggle', { enabled: state });
    }
  });
  
  socket.on('toggle-audio', (state) => {
    const profile = userProfiles.get(userId);
    if (profile && profile.partnerId) {
      io.to(profile.partnerId).emit('partner-audio-toggle', { enabled: state });
    }
  });
  
  // 6. VIDEO FILTERS (Azar Feature)
  socket.on('apply-filter', (filter) => {
    const profile = userProfiles.get(userId);
    if (profile && profile.partnerId) {
      io.to(profile.partnerId).emit('partner-applied-filter', { filter });
    }
  });
  
  // 7. SCREEN SHARING (Azar Feature)
  socket.on('start-screen-share', () => {
    const profile = userProfiles.get(userId);
    if (profile && profile.partnerId) {
      io.to(profile.partnerId).emit('partner-screen-sharing', { started: true });
    }
  });
  
  socket.on('stop-screen-share', () => {
    const profile = userProfiles.get(userId);
    if (profile && profile.partnerId) {
      io.to(profile.partnerId).emit('partner-screen-sharing', { started: false });
    }
  });
  
  // 8. SEND GIFT WITH EFFECTS
  socket.on('send-gift', async (data) => {
    const profile = userProfiles.get(userId);
    if (!profile || !profile.partnerId) return;
    
    const gift = gifts.find(g => g.id === data.giftId);
    if (!gift) return;
    
    if (profile.coins < gift.coins) {
      socket.emit('insufficient-coins', { needed: gift.coins, have: profile.coins });
      return;
    }
    
    profile.coins -= gift.coins;
    
    const partner = userProfiles.get(profile.partnerId);
    if (partner) {
      partner.coins += Math.floor(gift.coins * 0.3);
      partner.gifts.push({
        gift,
        from: profile.name,
        fromId: userId,
        timestamp: Date.now()
      });
      
      // Send gift with effect
      io.to(profile.partnerId).emit('receive-gift', {
        gift,
        from: profile.name,
        effect: gift.effect,
        coins: partner.coins
      });
    }
    
    socket.emit('gift-sent', { gift, coins: profile.coins });
  });
  
  // 9. LIKE SYSTEM (Azar Feature)
  socket.on('send-like', () => {
    const profile = userProfiles.get(userId);
    if (!profile || !profile.partnerId) return;
    
    const partner = userProfiles.get(profile.partnerId);
    if (partner) {
      partner.likes += 1;
      io.to(profile.partnerId).emit('received-like', {
        from: profile.name,
        totalLikes: partner.likes
      });
    }
  });
  
  // 10. FRIEND SYSTEM
  socket.on('add-friend', async (targetId) => {
    const profile = userProfiles.get(userId);
    const target = userProfiles.get(targetId);
    
    if (profile && target) {
      if (!profile.friends.includes(targetId)) {
        profile.friends.push(targetId);
        
        // Send friend request
        io.to(targetId).emit('friend-request', {
          from: profile.name,
          fromId: userId
        });
      }
    }
  });
  
  socket.on('accept-friend', (fromId) => {
    const profile = userProfiles.get(userId);
    const fromUser = userProfiles.get(fromId);
    
    if (profile && fromUser) {
      if (!profile.friends.includes(fromId)) {
        profile.friends.push(fromId);
      }
      if (!fromUser.friends.includes(userId)) {
        fromUser.friends.push(userId);
      }
      
      socket.emit('friend-added', { friend: fromUser.name });
      io.to(fromId).emit('friend-accepted', { by: profile.name });
    }
  });
  
  // 11. CHAT TRANSLATION (Azar Feature)
  socket.on('translate-message', (data) => {
    if (data.message && data.targetLang) {
      // Simulate translation
      const translated = `${data.message} [${data.targetLang.toUpperCase()}]`;
      socket.emit('message-translated', {
        original: data.message,
        translated: translated,
        language: data.targetLang
      });
    }
  });
  
  // 12. BACKGROUND MUSIC (Azar Feature)
  socket.on('play-background-music', (track) => {
    const profile = userProfiles.get(userId);
    if (profile && profile.partnerId) {
      io.to(profile.partnerId).emit('partner-playing-music', { track });
    }
  });
  
  // 13. CALL RECORDING (Azar Feature - with consent)
  socket.on('request-recording-consent', () => {
    const profile = userProfiles.get(userId);
    if (profile && profile.partnerId) {
      io.to(profile.partnerId).emit('recording-consent-requested');
    }
  });
  
  socket.on('give-recording-consent', (consent) => {
    const profile = userProfiles.get(userId);
    if (profile && profile.partnerId) {
      io.to(profile.partnerId).emit('recording-consent-given', { consent });
    }
  });
  
  // 14. NEXT PARTNER (Azar Skip)
  socket.on('next-partner', async () => {
    const profile = userProfiles.get(userId);
    if (!profile || !profile.partnerId) return;
    
    const partnerId = profile.partnerId;
    
    // End current call
    profile.inCall = false;
    profile.partnerId = null;
    
    const partner = userProfiles.get(partnerId);
    if (partner) {
      partner.inCall = false;
      partner.partnerId = null;
      io.to(partnerId).emit('partner-skipped');
    }
    
    socket.emit('ready-for-next');
    
    // Auto-find next
    setTimeout(() => {
      socket.emit('find-match', {});
    }, 500);
  });
  
  // 15. END CALL
  socket.on('end-call', async () => {
    const profile = userProfiles.get(userId);
    if (!profile || !profile.partnerId) return;
    
    const partnerId = profile.partnerId;
    
    profile.inCall = false;
    profile.partnerId = null;
    
    const partner = userProfiles.get(partnerId);
    if (partner) {
      partner.inCall = false;
      partner.partnerId = null;
      io.to(partnerId).emit('call-ended');
    }
    
    socket.emit('call-ended');
  });
  
  // 16. WEBRTC SIGNALING
  socket.on('webrtc-offer', (data) => {
    const profile = userProfiles.get(userId);
    if (profile && profile.partnerId) {
      io.to(profile.partnerId).emit('webrtc-offer', data);
    }
  });
  
  socket.on('webrtc-answer', (data) => {
    const profile = userProfiles.get(userId);
    if (profile && profile.partnerId) {
      io.to(profile.partnerId).emit('webrtc-answer', data);
    }
  });
  
  socket.on('ice-candidate', (data) => {
    const profile = userProfiles.get(userId);
    if (profile && profile.partnerId) {
      io.to(profile.partnerId).emit('ice-candidate', data);
    }
  });
  
  // 17. CHAT MESSAGES
  socket.on('chat-message', (data) => {
    const profile = userProfiles.get(userId);
    if (profile && profile.partnerId) {
      io.to(profile.partnerId).emit('chat-message', {
        message: data.message,
        from: profile.name,
        timestamp: Date.now()
      });
    }
  });
  
  // 18. TYPING INDICATOR
  socket.on('typing', (isTyping) => {
    const profile = userProfiles.get(userId);
    if (profile && profile.partnerId) {
      io.to(profile.partnerId).emit('partner-typing', { isTyping });
    }
  });
  
  // 19. BLOCK USER
  socket.on('block-user', (targetId) => {
    const profile = userProfiles.get(userId);
    if (profile) {
      if (!profile.blocked.includes(targetId)) {
        profile.blocked.push(targetId);
      }
      socket.emit('user-blocked', { targetId });
    }
  });
  
  // 20. REPORT USER
  socket.on('report-user', (data) => {
    console.log('User reported:', data);
    socket.emit('report-received');
  });
  
  // 21. DISCONNECT HANDLER
  socket.on('disconnect', async () => {
    console.log('User disconnected:', userId);
    
    const profile = userProfiles.get(userId);
    if (profile) {
      profile.isOnline = false;
      profile.lastSeen = Date.now();
      
      // Notify partner if in call
      if (profile.partnerId) {
        const partner = userProfiles.get(profile.partnerId);
        if (partner) {
          partner.inCall = false;
          partner.partnerId = null;
          io.to(profile.partnerId).emit('partner-disconnected');
        }
      }
      
      // Remove from matchmaking
      await matchmaker.removeUserFromAllQueues(userId);
      
      // Remove from memory after delay
      setTimeout(() => {
        userProfiles.delete(userId);
      }, 60000);
    }
    
    broadcastStats();
  });
});

// ============================================
// HELPER FUNCTIONS
// ============================================

async function createMatch(user1Id, user2Id) {
  const user1 = userProfiles.get(user1Id);
  const user2 = userProfiles.get(user2Id);
  
  if (!user1 || !user2) return false;
  
  // Check if either is already in a call
  if (user1.inCall || user2.inCall) return false;
  
  // Check if blocked
  if (user1.blocked.includes(user2Id) || user2.blocked.includes(user1Id)) {
    return false;
  }
  
  // Create the match
  user1.inCall = true;
  user1.partnerId = user2Id;
  user1.totalCalls += 1;
  
  user2.inCall = true;
  user2.partnerId = user1Id;
  user2.totalCalls += 1;
  
  // Remove from queues
  await matchmaker.removeUserFromAllQueues(user1Id);
  await matchmaker.removeUserFromAllQueues(user2Id);
  
  // Create call record
  const callId = await matchmaker.createCall(user1Id, user2Id);
  
  // Notify both users
  io.to(user1Id).emit('match-found', {
    partner: {
      id: user2Id,
      name: user2.name,
      gender: user2.gender,
      age: user2.age,
      country: user2.country,
      interests: user2.interests,
      level: user2.level
    },
    isInitiator: true,
    callId
  });
  
  io.to(user2Id).emit('match-found', {
    partner: {
      id: user1Id,
      name: user1.name,
      gender: user1.gender,
      age: user1.age,
      country: user1.country,
      interests: user1.interests,
      level: user1.level
    },
    isInitiator: false,
    callId
  });
  
  console.log(`Match created: ${user1.name} <-> ${user2.name}`);
  broadcastStats();
  
  return true;
}

async function getOnlineCount() {
  return Array.from(userProfiles.values()).filter(u => u.isOnline).length;
}

async function broadcastStats() {
  const online = await getOnlineCount();
  const inCall = Array.from(userProfiles.values()).filter(u => u.inCall).length / 2;
  const searching = Array.from(userProfiles.values()).filter(u => !u.inCall && u.isOnline).length;
  
  io.emit('stats', {
    online,
    inCall,
    searching,
    timestamp: Date.now()
  });
}

// ============================================
// API ROUTES
// ============================================

app.get('/api/stats', (req, res) => {
  const online = Array.from(userProfiles.values()).filter(u => u.isOnline).length;
  res.json({
    online,
    totalUsers: userProfiles.size,
    activeCalls: Array.from(userProfiles.values()).filter(u => u.inCall).length / 2,
    version: '3.0.0'
  });
});

app.get('/api/users/online', (req, res) => {
  const onlineUsers = Array.from(userProfiles.values())
    .filter(u => u.isOnline && !u.inCall)
    .map(u => ({
      id: u.id,
      name: u.name,
      gender: u.gender,
      age: u.age,
      country: u.country,
      interests: u.interests
    }));
  
  res.json({ users: onlineUsers });
});

app.get('/api/user/:id', (req, res) => {
  const user = userProfiles.get(req.params.id);
  if (user) {
    res.json({
      id: user.id,
      name: user.name,
      gender: user.gender,
      age: user.age,
      country: user.country,
      level: user.level,
      totalCalls: user.totalCalls,
      likes: user.likes
    });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

// Health check for Render.com
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: Date.now(),
    users: userProfiles.size 
  });
});

// ============================================
// PERIODIC CLEANUP
// ============================================

setInterval(() => {
  const now = Date.now();
  for (const [id, user] of userProfiles) {
    if (!user.isOnline && now - user.lastSeen > 5 * 60 * 1000) {
      userProfiles.delete(id);
      matchmaker.removeUserFromAllQueues(id);
    }
  }
  broadcastStats();
}, 60000);

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║      BROWNTV 3.0 - AZAR STYLE        ║
  ║      🚀 Server running on port ${PORT}     ║
  ║      🌍 http://localhost:${PORT}           ║
  ╚══════════════════════════════════════╝
  
  Features:
  ✅ Real-time matchmaking
  ✅ Azar-style video chat
  ✅ Gifts with effects
  ✅ Friends system
  ✅ Video filters
  ✅ Screen sharing
  ✅ Instant connect
  ✅ Translation
  ✅ Background music
  ✅ And more...
  `);
});