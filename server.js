const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const geoip = require('geoip-lite');
const compression = require('compression');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling'],
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true
  }
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "ws:"]
    }
  }
}));
app.use(cors());
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use('/api/', limiter);

// Serve static files
app.use(express.static('public', {
  maxAge: '1y',
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// API endpoints
app.get('/api/stats', (req, res) => {
  res.json({
    online: users.size,
    searching: Object.values(waitingQueues).reduce((a, b) => a + b.length, 0),
    totalUsers: totalUsersCreated,
    version: '2.0.0'
  });
});

app.get('/api/user/:id', (req, res) => {
  const user = users.get(req.params.id);
  if (user) {
    res.json({
      id: user.id,
      name: user.name,
      country: user.country,
      gender: user.gender,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
      totalCalls: user.totalCalls || 0,
      totalTime: user.totalTime || 0,
      likes: user.likes || 0,
      rating: user.rating || 5.0
    });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

// PWA routes
app.get('/manifest.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});

app.get('/offline', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'offline.html'));
});

app.get('/install', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'install.html'));
});

// Service Worker
app.get('/sw.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

// Main route
app.get('*', (req, res) => {
  // Check if user is on mobile and show install prompt
  const isMobile = /iPhone|iPad|iPod|Android/i.test(req.headers['user-agent']);
  const hasVisited = req.cookies?.visited === 'true';
  
  if (isMobile && !hasVisited) {
    res.cookie('visited', 'true', { maxAge: 86400000 }); // 1 day
    res.sendFile(path.join(__dirname, 'public', 'install-prompt.html'));
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// ============================================
// ENHANCED DATA STRUCTURES
// ============================================

const users = new Map();
const waitingQueues = {
  all: [],
  male: [],
  female: [],
  random: [],
  instant: []
};

const friendships = new Map();
const blockedUsers = new Map();
const reports = new Map();
const userRatings = new Map();
const callHistory = new Map();
const userPreferences = new Map();

let totalUsersCreated = 0;

// Enhanced countries with flags and timezones
const countries = [
  { code: '🇩🇪', name: 'Deutschland', region: 'europe', language: 'de', timezone: 'Europe/Berlin' },
  { code: '🇺🇸', name: 'USA', region: 'americas', language: 'en', timezone: 'America/New_York' },
  { code: '🇬🇧', name: 'UK', region: 'europe', language: 'en', timezone: 'Europe/London' },
  { code: '🇫🇷', name: 'Frankreich', region: 'europe', language: 'fr', timezone: 'Europe/Paris' },
  { code: '🇪🇸', name: 'Spanien', region: 'europe', language: 'es', timezone: 'Europe/Madrid' },
  { code: '🇮🇹', name: 'Italien', region: 'europe', language: 'it', timezone: 'Europe/Rome' },
  { code: '🇯🇵', name: 'Japan', region: 'asia', language: 'ja', timezone: 'Asia/Tokyo' },
  { code: '🇰🇷', name: 'Südkorea', region: 'asia', language: 'ko', timezone: 'Asia/Seoul' },
  { code: '🇧🇷', name: 'Brasilien', region: 'americas', language: 'pt', timezone: 'America/Sao_Paulo' },
  { code: '🇳🇱', name: 'Niederlande', region: 'europe', language: 'nl', timezone: 'Europe/Amsterdam' },
  { code: '🇵🇱', name: 'Polen', region: 'europe', language: 'pl', timezone: 'Europe/Warsaw' },
  { code: '🇹🇷', name: 'Türkei', region: 'europe', language: 'tr', timezone: 'Europe/Istanbul' },
  { code: '🇷🇺', name: 'Russland', region: 'europe', language: 'ru', timezone: 'Europe/Moscow' },
  { code: '🇮🇳', name: 'Indien', region: 'asia', language: 'hi', timezone: 'Asia/Kolkata' },
  { code: '🇲🇽', name: 'Mexiko', region: 'americas', language: 'es', timezone: 'America/Mexico_City' },
  { code: '🇦🇺', name: 'Australien', region: 'oceania', language: 'en', timezone: 'Australia/Sydney' },
  { code: '🇨🇦', name: 'Kanada', region: 'americas', language: 'en', timezone: 'America/Toronto' },
  { code: '🇨🇳', name: 'China', region: 'asia', language: 'zh', timezone: 'Asia/Shanghai' },
  { code: '🇸🇦', name: 'Saudi-Arabien', region: 'asia', language: 'ar', timezone: 'Asia/Riyadh' },
  { code: '🇪🇬', name: 'Ägypten', region: 'africa', language: 'ar', timezone: 'Africa/Cairo' }
];

// Enhanced name generation
const firstNames = {
  male: ['Max', 'Leon', 'Paul', 'Finn', 'Luis', 'Jonas', 'Felix', 'Elias', 'Lukas', 'Noah', 'Ben', 'Tim', 'Julian', 'Moritz', 'David', 'Simon', 'Philipp', 'Fabian', 'Tom', 'Jan'],
  female: ['Emma', 'Mia', 'Sophia', 'Hannah', 'Anna', 'Lea', 'Lena', 'Emilia', 'Laura', 'Sarah', 'Lina', 'Marie', 'Clara', 'Julia', 'Lisa', 'Nele', 'Charlotte', 'Johanna', 'Lara', 'Amelie']
};

const lastNames = ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann'];

// Enhanced gifts with categories
const gifts = [
  { id: 'heart', emoji: '❤️', name: 'Herz', coins: 10, category: 'love', effect: 'like' },
  { id: 'rose', emoji: '🌹', name: 'Rose', coins: 20, category: 'love', effect: 'romantic' },
  { id: 'diamond', emoji: '💎', name: 'Diamant', coins: 50, category: 'premium', effect: 'premium' },
  { id: 'crown', emoji: '👑', name: 'Krone', coins: 100, category: 'premium', effect: 'royal' },
  { id: 'fire', emoji: '🔥', name: 'Feuer', coins: 15, category: 'fun', effect: 'hot' },
  { id: 'star', emoji: '⭐', name: 'Stern', coins: 25, category: 'fun', effect: 'shiny' },
  { id: 'kiss', emoji: '💋', name: 'Kuss', coins: 30, category: 'love', effect: 'intimate' },
  { id: 'ring', emoji: '💍', name: 'Ring', coins: 200, category: 'premium', effect: 'engagement' },
  { id: 'teddy', emoji: '🧸', name: 'Teddy', coins: 40, category: 'cute', effect: 'cute' },
  { id: 'rocket', emoji: '🚀', name: 'Rakete', coins: 75, category: 'fun', effect: 'fast' },
  { id: 'rainbow', emoji: '🌈', name: 'Regenbogen', coins: 35, category: 'fun', effect: 'colorful' },
  { id: 'cake', emoji: '🎂', name: 'Kuchen', coins: 45, category: 'cute', effect: 'sweet' },
  { id: 'trophy', emoji: '🏆', name: 'Trophy', coins: 150, category: 'premium', effect: 'winner' },
  { id: 'money', emoji: '💰', name: 'Geld', coins: 80, category: 'premium', effect: 'rich' },
  { id: 'sparkles', emoji: '✨', name: 'Glitzer', coins: 25, category: 'fun', effect: 'sparkly' }
];

// Filters and preferences
const filters = {
  gender: ['male', 'female', 'all'],
  ageGroups: ['18-24', '25-34', '35-44', '45+', 'all'],
  regions: ['europe', 'americas', 'asia', 'africa', 'oceania', 'all'],
  interests: ['music', 'sports', 'gaming', 'movies', 'travel', 'food', 'fashion', 'art', 'technology']
};

// ============================================
// ENHANCED HELPER FUNCTIONS
// ============================================

function generateRandomName(gender) {
  if (gender === 'male' && firstNames.male.length > 0) {
    const firstName = firstNames.male[Math.floor(Math.random() * firstNames.male.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    return `${firstName} ${lastName}`;
  } else if (gender === 'female' && firstNames.female.length > 0) {
    const firstName = firstNames.female[Math.floor(Math.random() * firstNames.female.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    return `${firstName} ${lastName}`;
  }
  // Fallback for unknown gender
  const firstName = [...firstNames.male, ...firstNames.female][Math.floor(Math.random() * (firstNames.male.length + firstNames.female.length))];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
  return `${firstName} ${lastName}`;
}

function getCountryByIP(ip) {
  // For development, return random country
  // In production, use geoip.lookup(ip)
  return countries[Math.floor(Math.random() * countries.length)];
}

function calculateUserLevel(totalTime, totalCalls) {
  const score = (totalTime / 3600000) + (totalCalls * 10);
  if (score < 100) return { level: 1, progress: score / 100 };
  if (score < 500) return { level: 2, progress: (score - 100) / 400 };
  if (score < 1500) return { level: 3, progress: (score - 500) / 1000 };
  if (score < 4000) return { level: 4, progress: (score - 1500) / 2500 };
  return { level: 5, progress: 1 };
}

function matchUsers(user1, user2) {
  // Check basic compatibility
  if (user1.gender && user2.lookingFor !== 'all' && user2.lookingFor !== user1.gender) return false;
  if (user2.gender && user1.lookingFor !== 'all' && user1.lookingFor !== user2.gender) return false;
  
  // Check region filter
  if (user1.regionFilter && user1.regionFilter !== 'all' && user1.regionFilter !== user2.country.region) return false;
  if (user2.regionFilter && user2.regionFilter !== 'all' && user2.regionFilter !== user1.country.region) return false;
  
  // Check age group
  if (user1.ageGroup && user1.ageGroup !== 'all' && user1.ageGroup !== user2.ageGroup) return false;
  if (user2.ageGroup && user2.ageGroup !== 'all' && user2.ageGroup !== user1.ageGroup) return false;
  
  // Check interests overlap (optional)
  if (user1.interests && user2.interests) {
    const commonInterests = user1.interests.filter(interest => user2.interests.includes(interest));
    if (commonInterests.length === 0 && user1.requireCommonInterests) return false;
  }
  
  // Check if blocked
  if (blockedUsers.get(user1.id)?.includes(user2.id)) return false;
  if (blockedUsers.get(user2.id)?.includes(user1.id)) return false;
  
  return true;
}

function findBestMatch(userId) {
  const user = users.get(userId);
  if (!user) return null;
  
  const queueType = user.matchPreference || 'all';
  const queue = waitingQueues[queueType];
  
  // Search in preferred queue first
  for (let i = 0; i < queue.length; i++) {
    const matchId = queue[i];
    if (matchId === userId) continue;
    
    const match = users.get(matchId);
    if (!match || match.inCall) continue;
    
    if (matchUsers(user, match)) {
      queue.splice(i, 1);
      return matchId;
    }
  }
  
  // Try other queues if no match found
  if (queueType !== 'all') {
    const allQueue = waitingQueues.all;
    for (let i = 0; i < allQueue.length; i++) {
      const matchId = allQueue[i];
      if (matchId === userId) continue;
      
      const match = users.get(matchId);
      if (!match || match.inCall) continue;
      
      if (matchUsers(user, match)) {
        allQueue.splice(i, 1);
        return matchId;
      }
    }
  }
  
  return null;
}

function addToWaitingQueue(userId, user) {
  removeFromAllQueues(userId);
  
  if (user.matchPreference && waitingQueues[user.matchPreference]) {
    waitingQueues[user.matchPreference].push(userId);
  } else {
    waitingQueues.all.push(userId);
  }
  
  user.searching = true;
  user.searchStartTime = Date.now();
}

function removeFromAllQueues(userId) {
  for (const queue of Object.values(waitingQueues)) {
    const index = queue.indexOf(userId);
    if (index > -1) queue.splice(index, 1);
  }
}

// ============================================
// ENHANCED SOCKET.IO HANDLERS
// ============================================

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);
  
  // Get client IP (for geo-location)
  const ip = socket.handshake.address;
  const geo = getCountryByIP(ip);
  
  // Create enhanced user profile
  const user = {
    id: socket.id,
    name: generateRandomName(),
    country: geo,
    gender: null,
    age: null,
    ageGroup: null,
    lookingFor: 'all',
    regionFilter: 'all',
    interests: [],
    bio: '',
    coins: 500,
    gems: 10,
    level: 1,
    experience: 0,
    totalCalls: 0,
    totalTime: 0,
    likes: 0,
    giftsReceived: [],
    friends: [],
    blocked: [],
    isOnline: true,
    lastSeen: Date.now(),
    inCall: false,
    partnerId: null,
    searching: false,
    matchPreference: 'all',
    requireCommonInterests: false,
    videoEnabled: true,
    audioEnabled: true,
    language: 'de',
    theme: 'dark',
    notifications: true,
    createdAt: Date.now()
  };
  
  users.set(socket.id, user);
  totalUsersCreated++;
  
  // Send initial data
  socket.emit('init', {
    user: {
      id: user.id,
      name: user.name,
      country: user.country,
      coins: user.coins,
      gems: user.gems,
      level: user.level
    },
    gifts,
    countries,
    filters,
    onlineCount: users.size
  });
  
  // Update stats for all
  broadcastStats();
  
  // Handle profile update
  socket.on('update-profile', (data) => {
    const u = users.get(socket.id);
    if (!u) return;
    
    if (data.gender) u.gender = data.gender;
    if (data.age) {
      u.age = data.age;
      if (data.age >= 18 && data.age <= 24) u.ageGroup = '18-24';
      else if (data.age <= 34) u.ageGroup = '25-34';
      else if (data.age <= 44) u.ageGroup = '35-44';
      else u.ageGroup = '45+';
    }
    if (data.lookingFor) u.lookingFor = data.lookingFor;
    if (data.regionFilter) u.regionFilter = data.regionFilter;
    if (data.interests) u.interests = data.interests;
    if (data.bio) u.bio = data.bio.substring(0, 200);
    if (data.matchPreference) u.matchPreference = data.matchPreference;
    if (data.language) u.language = data.language;
    if (data.theme) u.theme = data.theme;
    
    socket.emit('profile-updated', { user: u });
  });
  
  // Enhanced search with preferences
  socket.on('find-match', (data) => {
    const u = users.get(socket.id);
    if (!u || u.inCall || u.searching) return;
    
    if (data?.preference) {
      u.matchPreference = data.preference;
    }
    
    const matchId = findBestMatch(socket.id);
    
    if (matchId) {
      const match = users.get(matchId);
      if (createMatch(socket.id, matchId)) {
        // Notify both users
        socket.emit('match-found', {
          partner: {
            id: match.id,
            name: match.name,
            country: match.country,
            gender: match.gender,
            age: match.age,
            interests: match.interests,
            bio: match.bio,
            level: match.level
          },
          isInitiator: true
        });
        
        io.to(matchId).emit('match-found', {
          partner: {
            id: u.id,
            name: u.name,
            country: u.country,
            gender: u.gender,
            age: u.age,
            interests: u.interests,
            bio: u.bio,
            level: u.level
          },
          isInitiator: false
        });
        
        broadcastStats();
      }
    } else {
      addToWaitingQueue(socket.id, u);
      const position = waitingQueues[u.matchPreference || 'all'].length;
      socket.emit('searching', {
        position,
        estimatedTime: position * 3,
        mode: u.matchPreference || 'all'
      });
      broadcastStats();
    }
  });
  
  // Filtered search
  socket.on('filtered-search', (filters) => {
    const u = users.get(socket.id);
    if (!u) return;
    
    // Apply filters to user
    if (filters.gender) u.lookingFor = filters.gender;
    if (filters.ageGroup) u.ageGroup = filters.ageGroup;
    if (filters.region) u.regionFilter = filters.region;
    if (filters.interests) u.interests = filters.interests;
    if (filters.requireCommonInterests !== undefined) {
      u.requireCommonInterests = filters.requireCommonInterests;
    }
    
    // Start search with these filters
    socket.emit('find-match', { preference: 'filtered' });
  });
  
  // Instant connect (skip queue)
  socket.on('instant-connect', () => {
    const u = users.get(socket.id);
    if (!u || u.inCall || u.searching) return;
    
    if (u.gems > 0) {
      u.gems--;
      // Force immediate match
      const availableUsers = Array.from(users.keys())
        .filter(id => id !== socket.id && !users.get(id).inCall && !users.get(id).searching);
      
      if (availableUsers.length > 0) {
        const matchId = availableUsers[Math.floor(Math.random() * availableUsers.length)];
        const match = users.get(matchId);
        
        if (createMatch(socket.id, matchId)) {
          socket.emit('match-found', {
            partner: {
              id: match.id,
              name: match.name,
              country: match.country,
              gender: match.gender
            },
            isInitiator: true,
            instant: true
          });
          
          io.to(matchId).emit('match-found', {
            partner: {
              id: u.id,
              name: u.name,
              country: u.country,
              gender: u.gender
            },
            isInitiator: false,
            instant: true
          });
          
          broadcastStats();
        }
      } else {
        socket.emit('instant-failed', { reason: 'no_available_users' });
      }
    } else {
      socket.emit('insufficient-gems', { needed: 1, have: u.gems });
    }
  });
  
  // Video call controls
  socket.on('toggle-video', (enabled) => {
    const u = users.get(socket.id);
    if (u) {
      u.videoEnabled = enabled;
      if (u.partnerId) {
        io.to(u.partnerId).emit('partner-video-toggle', { enabled });
      }
    }
  });
  
  socket.on('toggle-audio', (enabled) => {
    const u = users.get(socket.id);
    if (u) {
      u.audioEnabled = enabled;
      if (u.partnerId) {
        io.to(u.partnerId).emit('partner-audio-toggle', { enabled });
      }
    }
  });
  
  // Chat translation
  socket.on('translate-message', (data) => {
    if (data.message && data.targetLanguage) {
      // In production, integrate with translation API
      // For now, send back same message with flag
      const translated = `${data.message} [${data.targetLanguage.toUpperCase()}]`;
      socket.emit('message-translated', {
        original: data.message,
        translated: translated,
        language: data.targetLanguage
      });
    }
  });
  
  // Screen sharing
  socket.on('screen-share-start', () => {
    const u = users.get(socket.id);
    if (u?.partnerId) {
      io.to(u.partnerId).emit('partner-screen-share-start');
    }
  });
  
  socket.on('screen-share-stop', () => {
    const u = users.get(socket.id);
    if (u?.partnerId) {
      io.to(u.partnerId).emit('partner-screen-share-stop');
    }
  });
  
  // Virtual gifts with effects
  socket.on('send-gift-with-effect', (data) => {
    const u = users.get(socket.id);
    if (!u?.partnerId) return;
    
    const gift = gifts.find(g => g.id === data.giftId);
    if (!gift) return;
    
    if (u.coins < gift.coins) {
      socket.emit('insufficient-coins', { needed: gift.coins, have: u.coins });
      return;
    }
    
    u.coins -= gift.coins;
    u.totalGiftsSent = (u.totalGiftsSent || 0) + 1;
    
    const partner = users.get(u.partnerId);
    if (partner) {
      partner.coins += Math.floor(gift.coins * 0.3);
      partner.giftsReceived.push({
        gift,
        from: u.name,
        fromId: u.id,
        timestamp: Date.now(),
        effect: data.effect
      });
      
      // Send gift with special effect
      io.to(u.partnerId).emit('receive-gift-with-effect', {
        gift,
        from: u.name,
        effect: data.effect || gift.effect,
        newCoins: partner.coins
      });
      
      // Achievement check
      checkGiftAchievements(u.id);
    }
    
    socket.emit('gift-sent-with-effect', {
      gift,
      effect: data.effect,
      newCoins: u.coins
    });
    
    broadcastStats();
  });
  
  // User rating system
  socket.on('rate-partner', (data) => {
    const u = users.get(socket.id);
    if (!u?.partnerId) return;
    
    const partner = users.get(u.partnerId);
    if (partner && data.rating >= 1 && data.rating <= 5) {
      if (!userRatings.has(partner.id)) {
        userRatings.set(partner.id, []);
      }
      userRatings.get(partner.id).push({
        from: u.id,
        rating: data.rating,
        comment: data.comment,
        timestamp: Date.now()
      });
      
      // Calculate average rating
      const ratings = userRatings.get(partner.id);
      const avg = ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;
      partner.rating = avg.toFixed(1);
      
      io.to(u.partnerId).emit('rated-by-partner', {
        rating: data.rating,
        comment: data.comment,
        averageRating: partner.rating
      });
      
      // Check for rating achievements
      if (data.rating === 5) {
        u.fiveStarRatings = (u.fiveStarRatings || 0) + 1;
        checkRatingAchievements(u.id);
      }
    }
  });
  
  // Video filters
  socket.on('apply-video-filter', (filter) => {
    const u = users.get(socket.id);
    if (u?.partnerId) {
      io.to(u.partnerId).emit('partner-applied-filter', { filter });
    }
  });
  
  // Background music
  socket.on('play-background-music', (music) => {
    const u = users.get(socket.id);
    if (u?.partnerId) {
      io.to(u.partnerId).emit('partner-playing-music', { music });
    }
  });
  
  // Call recording consent
  socket.on('request-recording-consent', () => {
    const u = users.get(socket.id);
    if (u?.partnerId) {
      io.to(u.partnerId).emit('recording-consent-requested');
    }
  });
  
  socket.on('give-recording-consent', (consent) => {
    const u = users.get(socket.id);
    if (u?.partnerId) {
      io.to(u.partnerId).emit('recording-consent-given', { consent });
    }
  });
  
  // Friend suggestions
  socket.on('get-friend-suggestions', () => {
    const u = users.get(socket.id);
    if (!u) return;
    
    const suggestions = Array.from(users.values())
      .filter(user => 
        user.id !== socket.id &&
        !u.friends.includes(user.id) &&
        !u.blocked.includes(user.id) &&
        user.isOnline &&
        !user.inCall
      )
      .slice(0, 10)
      .map(user => ({
        id: user.id,
        name: user.name,
        country: user.country,
        gender: user.gender,
        age: user.age,
        commonInterests: user.interests?.filter(i => u.interests?.includes(i)).length || 0
      }));
    
    socket.emit('friend-suggestions', { suggestions });
  });
  
  // Language practice mode
  socket.on('set-language-practice', (language) => {
    const u = users.get(socket.id);
    if (u) {
      u.practiceLanguage = language;
      u.matchPreference = 'language';
      socket.emit('language-mode-activated', { language });
    }
  });
  
  // Disconnect handler
  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    
    const u = users.get(socket.id);
    if (u) {
      u.isOnline = false;
      u.lastSeen = Date.now();
      
      if (u.partnerId) {
        const partner = users.get(u.partnerId);
        if (partner) {
          partner.inCall = false;
          partner.partnerId = null;
          io.to(u.partnerId).emit('partner-disconnected', {
            reason: 'disconnected',
            callDuration: Date.now() - (u.callStartTime || Date.now())
          });
          
          // Save call history
          saveCallHistory(u.id, u.partnerId, u.callStartTime);
        }
      }
      
      removeFromAllQueues(socket.id);
      users.delete(socket.id);
    }
    
    broadcastStats();
  });
});

// Helper functions
function createMatch(userId1, userId2) {
  const u1 = users.get(userId1);
  const u2 = users.get(userId2);
  
  if (!u1 || !u2) return false;
  
  u1.inCall = true;
  u1.partnerId = userId2;
  u1.searching = false;
  u1.callStartTime = Date.now();
  
  u2.inCall = true;
  u2.partnerId = userId1;
  u2.searching = false;
  u2.callStartTime = Date.now();
  
  removeFromAllQueues(userId1);
  removeFromAllQueues(userId2);
  
  return true;
}

function saveCallHistory(userId1, userId2, startTime) {
  const call = {
    users: [userId1, userId2],
    startTime,
    endTime: Date.now(),
    duration: Date.now() - startTime
  };
  
  if (!callHistory.has(userId1)) callHistory.set(userId1, []);
  if (!callHistory.has(userId2)) callHistory.set(userId2, []);
  
  callHistory.get(userId1).push(call);
  callHistory.get(userId2).push(call);
  
  // Update user stats
  const u1 = users.get(userId1);
  const u2 = users.get(userId2);
  
  if (u1) {
    u1.totalCalls = (u1.totalCalls || 0) + 1;
    u1.totalTime = (u1.totalTime || 0) + call.duration;
    u1.level = calculateUserLevel(u1.totalTime, u1.totalCalls).level;
  }
  
  if (u2) {
    u2.totalCalls = (u2.totalCalls || 0) + 1;
    u2.totalTime = (u2.totalTime || 0) + call.duration;
    u2.level = calculateUserLevel(u2.totalTime, u2.totalCalls).level;
  }
}

function checkGiftAchievements(userId) {
  const u = users.get(userId);
  if (!u) return;
  
  const giftsSent = u.totalGiftsSent || 0;
  
  if (giftsSent >= 100 && !u.achievements?.giftMaster) {
    u.achievements = u.achievements || {};
    u.achievements.giftMaster = true;
    u.gems += 50;
    io.to(userId).emit('achievement-unlocked', {
      title: 'Gift Master',
      description: '100 gifts sent!',
      reward: { gems: 50 }
    });
  }
}

function checkRatingAchievements(userId) {
  const u = users.get(userId);
  if (!u) return;
  
  const fiveStars = u.fiveStarRatings || 0;
  
  if (fiveStars >= 10 && !u.achievements?.highlyRated) {
    u.achievements = u.achievements || {};
    u.achievements.highlyRated = true;
    u.gems += 100;
    io.to(userId).emit('achievement-unlocked', {
      title: 'Highly Rated',
      description: 'Received 10 five-star ratings!',
      reward: { gems: 100 }
    });
  }
}

function broadcastStats() {
  const online = Array.from(users.values()).filter(u => u.isOnline).length;
  const searching = Object.values(waitingQueues).reduce((a, b) => a + b.length, 0);
  const inCall = Array.from(users.values()).filter(u => u.inCall).length / 2;
  
  io.emit('stats', {
    online,
    searching,
    inCall,
    totalUsers: totalUsersCreated,
    timestamp: Date.now()
  });
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [id, user] of users) {
    if (user.searching && now - user.searchStartTime > 5 * 60 * 1000) {
      // Remove users searching for more than 5 minutes
      removeFromAllQueues(id);
      user.searching = false;
      const socket = io.sockets.sockets.get(id);
      if (socket) {
        socket.emit('search-timeout');
      }
    }
  }
  broadcastStats();
}, 60000);

// Daily gift distribution
setInterval(() => {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    for (const [id, user] of users) {
      if (user.isOnline) {
        user.coins += 50; // Daily login bonus
        const socket = io.sockets.sockets.get(id);
        if (socket) {
          socket.emit('daily-bonus', { coins: 50 });
        }
      }
    }
  }
}, 60000); // Check every minute

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`📺 BrownTV 2.0 running on port ${PORT}`);
  console.log(`🌍 Server accessible at: http://localhost:${PORT}`);
  console.log(`📱 PWA installable via: https://your-domain.com/install`);
});