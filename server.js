/**
 * LiveConnect - Production-Ready Random Video Chat Server
 * 
 * Features:
 * - WebRTC Signaling (offer/answer/ICE candidates)
 * - Random user matching with queue system
 * - Real-time chat with typing indicators
 * - Rate limiting & security headers
 * - CORS configuration
 * - Compression for performance
 */

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

// ============================================
// APP CONFIGURATION
// ============================================

const app = express();
const httpServer = createServer(app);

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : ['http://localhost:3000', 'http://127.0.0.1:3000'];

// Trust proxy for platforms like Heroku, Railway
app.set('trust proxy', 1);

// ============================================
// MIDDLEWARE
// ============================================

// Compression
app.use(compression());

// Security headers (configured for WebRTC)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            connectSrc: ["'self'", "wss:", "ws:", "https:"],
            mediaSrc: ["'self'", "blob:"],
            imgSrc: ["'self'", "data:", "blob:"],
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// CORS
app.use(cors({
    origin: NODE_ENV === 'production' ? ALLOWED_ORIGINS : '*',
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// Serve static files
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: NODE_ENV === 'production' ? '1d' : 0
}));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        uptime: process.uptime(),
        users: users.size,
        queue: waitingQueue.length
    });
});

// API endpoint for stats
app.get('/api/stats', (req, res) => {
    res.json({
        online: users.size,
        countries: new Set([...users.values()].map(u => u.country.code)).size,
        inCall: [...users.values()].filter(u => u.inCall).length / 2
    });
});

// ============================================
// SOCKET.IO SETUP
// ============================================

const io = new Server(httpServer, {
    cors: {
        origin: NODE_ENV === 'production' ? ALLOWED_ORIGINS : '*',
        methods: ["GET", "POST"],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
});

// ============================================
// USER & ROOM MANAGEMENT
// ============================================

const users = new Map();
let waitingQueue = [];
const rooms = new Map();
const reports = new Map(); // Track reports for moderation

// Country data
const countries = [
    { code: '🇩🇪', name: 'Deutschland' },
    { code: '🇺🇸', name: 'USA' },
    { code: '🇬🇧', name: 'UK' },
    { code: '🇫🇷', name: 'Frankreich' },
    { code: '🇪🇸', name: 'Spanien' },
    { code: '🇮🇹', name: 'Italien' },
    { code: '🇯🇵', name: 'Japan' },
    { code: '🇰🇷', name: 'Südkorea' },
    { code: '🇧🇷', name: 'Brasilien' },
    { code: '🇳🇱', name: 'Niederlande' },
    { code: '🇸🇪', name: 'Schweden' },
    { code: '🇵🇱', name: 'Polen' },
    { code: '🇦🇹', name: 'Österreich' },
    { code: '🇨🇭', name: 'Schweiz' },
    { code: '🇨🇦', name: 'Kanada' },
    { code: '🇦🇺', name: 'Australien' },
    { code: '🇲🇽', name: 'Mexiko' },
    { code: '🇮🇳', name: 'Indien' },
    { code: '🇹🇷', name: 'Türkei' },
    { code: '🇷🇺', name: 'Russland' },
    { code: '🇵🇹', name: 'Portugal' },
    { code: '🇧🇪', name: 'Belgien' },
    { code: '🇳🇴', name: 'Norwegen' },
    { code: '🇩🇰', name: 'Dänemark' },
    { code: '🇫🇮', name: 'Finnland' }
];

// Username generators
const adjectives = ['Happy', 'Cool', 'Smart', 'Funny', 'Nice', 'Chill', 'Wild', 'Sweet', 'Brave', 'Lucky', 
                    'Swift', 'Clever', 'Bright', 'Calm', 'Bold', 'Free', 'Kind', 'Quick', 'Warm', 'Wise'];
const nouns = ['Panda', 'Tiger', 'Eagle', 'Wolf', 'Fox', 'Bear', 'Lion', 'Hawk', 'Shark', 'Dragon',
               'Phoenix', 'Dolphin', 'Falcon', 'Panther', 'Raven', 'Cobra', 'Jaguar', 'Owl', 'Lynx', 'Viper'];

function generateUsername() {
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 1000);
    return `${adj}${noun}${num}`;
}

function getRandomCountry() {
    return countries[Math.floor(Math.random() * countries.length)];
}

function broadcastOnlineCount() {
    const count = users.size;
    const countrySet = new Set([...users.values()].map(u => u.country.code));
    io.emit('online-count', {
        count: count,
        countries: countrySet.size
    });
}

function findMatch(socketId) {
    const user = users.get(socketId);
    if (!user) return null;

    // Find first available user in queue
    for (let i = 0; i < waitingQueue.length; i++) {
        const matchId = waitingQueue[i];
        if (matchId !== socketId && users.has(matchId)) {
            const matchUser = users.get(matchId);
            if (!matchUser.inCall && matchUser.searching) {
                waitingQueue.splice(i, 1);
                return matchId;
            }
        }
    }
    return null;
}

function createRoom(user1Id, user2Id) {
    const roomId = uuidv4();
    
    rooms.set(roomId, {
        id: roomId,
        user1: user1Id,
        user2: user2Id,
        createdAt: Date.now()
    });
    
    const user1 = users.get(user1Id);
    const user2 = users.get(user2Id);
    
    if (user1 && user2) {
        user1.inCall = true;
        user1.partnerId = user2Id;
        user1.roomId = roomId;
        user1.searching = false;
        
        user2.inCall = true;
        user2.partnerId = user1Id;
        user2.roomId = roomId;
        user2.searching = false;
    }
    
    return roomId;
}

function endRoom(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    
    const user1 = users.get(room.user1);
    const user2 = users.get(room.user2);
    
    if (user1) {
        user1.inCall = false;
        user1.partnerId = null;
        user1.roomId = null;
    }
    
    if (user2) {
        user2.inCall = false;
        user2.partnerId = null;
        user2.roomId = null;
    }
    
    rooms.delete(roomId);
}

function cleanupUser(socketId) {
    const user = users.get(socketId);
    if (user) {
        if (user.partnerId) {
            io.to(user.partnerId).emit('partner-left');
        }
        if (user.roomId) {
            endRoom(user.roomId);
        }
        waitingQueue = waitingQueue.filter(id => id !== socketId);
    }
    users.delete(socketId);
}

// ============================================
// SOCKET.IO EVENT HANDLERS
// ============================================

io.on('connection', (socket) => {
    console.log(`[${new Date().toISOString()}] User connected: ${socket.id}`);
    
    // Initialize user
    const country = getRandomCountry();
    users.set(socket.id, {
        id: socket.id,
        name: generateUsername(),
        country: country,
        inCall: false,
        partnerId: null,
        roomId: null,
        searching: false,
        connectedAt: Date.now()
    });
    
    socket.emit('user-info', users.get(socket.id));
    broadcastOnlineCount();
    
    // ----------------------------------------
    // MATCHING
    // ----------------------------------------
    
    socket.on('find-match', () => {
        const user = users.get(socket.id);
        if (!user || user.searching || user.inCall) return;
        
        console.log(`[${new Date().toISOString()}] User ${socket.id} searching for match`);
        user.searching = true;
        
        const matchId = findMatch(socket.id);
        
        if (matchId) {
            const matchUser = users.get(matchId);
            const roomId = createRoom(socket.id, matchId);
            
            console.log(`[${new Date().toISOString()}] Match: ${socket.id} <-> ${matchId}`);
            
            socket.emit('match-found', {
                partnerId: matchId,
                partnerName: matchUser.name,
                partnerCountry: matchUser.country,
                roomId: roomId,
                isInitiator: true
            });
            
            io.to(matchId).emit('match-found', {
                partnerId: socket.id,
                partnerName: user.name,
                partnerCountry: user.country,
                roomId: roomId,
                isInitiator: false
            });
        } else {
            if (!waitingQueue.includes(socket.id)) {
                waitingQueue.push(socket.id);
            }
            socket.emit('searching');
            console.log(`[${new Date().toISOString()}] User ${socket.id} added to queue (size: ${waitingQueue.length})`);
        }
    });
    
    socket.on('cancel-search', () => {
        const user = users.get(socket.id);
        if (user) {
            user.searching = false;
            waitingQueue = waitingQueue.filter(id => id !== socket.id);
        }
    });
    
    socket.on('next-partner', () => {
        const user = users.get(socket.id);
        if (!user) return;
        
        if (user.roomId) {
            const partnerId = user.partnerId;
            endRoom(user.roomId);
            if (partnerId) {
                io.to(partnerId).emit('partner-left');
            }
        }
        
        waitingQueue = waitingQueue.filter(id => id !== socket.id);
        user.searching = false;
        user.inCall = false;
        user.partnerId = null;
        user.roomId = null;
        
        socket.emit('start-new-search');
    });
    
    socket.on('end-call', () => {
        const user = users.get(socket.id);
        if (!user || !user.roomId) return;
        
        const partnerId = user.partnerId;
        endRoom(user.roomId);
        
        if (partnerId) {
            io.to(partnerId).emit('partner-left');
        }
        
        socket.emit('call-ended');
    });
    
    // ----------------------------------------
    // WEBRTC SIGNALING
    // ----------------------------------------
    
    socket.on('webrtc-offer', (data) => {
        const user = users.get(socket.id);
        if (!user || !user.partnerId) return;
        
        io.to(user.partnerId).emit('webrtc-offer', {
            offer: data.offer,
            from: socket.id
        });
    });
    
    socket.on('webrtc-answer', (data) => {
        const user = users.get(socket.id);
        if (!user || !user.partnerId) return;
        
        io.to(user.partnerId).emit('webrtc-answer', {
            answer: data.answer,
            from: socket.id
        });
    });
    
    socket.on('ice-candidate', (data) => {
        const user = users.get(socket.id);
        if (!user || !user.partnerId) return;
        
        io.to(user.partnerId).emit('ice-candidate', {
            candidate: data.candidate,
            from: socket.id
        });
    });
    
    // ----------------------------------------
    // CHAT
    // ----------------------------------------
    
    socket.on('chat-message', (data) => {
        const user = users.get(socket.id);
        if (!user || !user.partnerId) return;
        
        // Basic message sanitization
        const message = String(data.message).slice(0, 1000).trim();
        if (!message) return;
        
        io.to(user.partnerId).emit('chat-message', {
            message: message,
            from: user.name,
            timestamp: Date.now()
        });
    });
    
    socket.on('typing', () => {
        const user = users.get(socket.id);
        if (!user || !user.partnerId) return;
        
        io.to(user.partnerId).emit('partner-typing');
    });
    
    // ----------------------------------------
    // REPORTING
    // ----------------------------------------
    
    socket.on('report-user', (data) => {
        const user = users.get(socket.id);
        if (!user || !user.partnerId) return;
        
        const reportId = uuidv4();
        reports.set(reportId, {
            id: reportId,
            reporter: socket.id,
            reported: user.partnerId,
            reason: data.reason || 'unspecified',
            timestamp: Date.now()
        });
        
        console.log(`[${new Date().toISOString()}] Report: ${socket.id} reported ${user.partnerId}`);
        socket.emit('report-received');
    });
    
    // ----------------------------------------
    // DISCONNECT
    // ----------------------------------------
    
    socket.on('disconnect', (reason) => {
        console.log(`[${new Date().toISOString()}] User disconnected: ${socket.id} (${reason})`);
        cleanupUser(socket.id);
        broadcastOnlineCount();
    });
});

// ============================================
// CLEANUP INTERVAL
// ============================================

// Clean up stale users every 5 minutes
setInterval(() => {
    const now = Date.now();
    const staleThreshold = 10 * 60 * 1000; // 10 minutes
    
    for (const [socketId, user] of users) {
        if (now - user.connectedAt > staleThreshold && !user.inCall) {
            const socket = io.sockets.sockets.get(socketId);
            if (!socket || !socket.connected) {
                cleanupUser(socketId);
            }
        }
    }
    
    // Clean waiting queue
    waitingQueue = waitingQueue.filter(id => users.has(id));
    
    console.log(`[${new Date().toISOString()}] Cleanup: ${users.size} users, ${waitingQueue.length} in queue`);
}, 5 * 60 * 1000);

// ============================================
// START SERVER
// ============================================

httpServer.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🎥 LiveConnect Server - Production Ready               ║
║                                                          ║
║   Environment: ${NODE_ENV.padEnd(40)}║
║   Port: ${String(PORT).padEnd(47)}║
║   URL: http://localhost:${PORT}                          ║
║                                                          ║
║   Ready for video chat connections!                      ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down...');
    httpServer.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
