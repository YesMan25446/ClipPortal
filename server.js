const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');

ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (_) { /* optional dependency */ }
const crypto = require('crypto');
// Use simple database for all environments (no SQLite compilation issues)
const { db } = require('./database-simple');
const { backupSystem } = require('./backup-system'); // Automated backup system
const EMAIL_ENC_KEY = process.env.EMAIL_ENC_KEY;

function encryptEmail(email) {
  if (!EMAIL_ENC_KEY || !email || email.includes('@') === false) return email;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(EMAIL_ENC_KEY, 'hex'), iv);
  let enc = cipher.update(email, 'utf8', 'hex');
  enc += cipher.final('hex');
  return iv.toString('hex') + ':' + enc;
}
function decryptEmail(encData) {
  if (!EMAIL_ENC_KEY || !encData || !encData.includes(':')) return encData;
  const [ivHex, enc] = encData.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(EMAIL_ENC_KEY, 'hex'), iv);
  let dec = decipher.update(enc, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}
// Utility to encrypt all plain emails on startup:
(function encryptAllPlainEmails(){
  if (!EMAIL_ENC_KEY) return;
  try {
    const users = readUsers();
    let changed = false;
    for (const user of users.users) {
      // only try to encrypt if it looks like plain email
      if (user.email && user.email.includes('@')) {
        user.email = encryptEmail(user.email);
        changed = true;
      }
    }
    if (changed) writeUsers(users);
  } catch(e) {}
})();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// Admin configuration
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Vincentfårisig132'; // Change this to your desired password

// Middleware
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.static('.')); // Serve static files from current directory

// Ensure uploads and thumbnails directories exist
const uploadsDir = path.join(__dirname, 'uploads');
const thumbnailsDir = path.join(__dirname, 'thumbnails');
fs.ensureDirSync(uploadsDir);
fs.ensureDirSync(thumbnailsDir);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept video files
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'), false);
    }
  }
});

// Data storage files
const dataDir = path.join(__dirname, 'data');
fs.ensureDirSync(dataDir);

const dataFile = path.join(dataDir, 'clips.json');
const usersFile = path.join(dataDir, 'users.json');
const messagesFile = path.join(dataDir, 'messages.json');
const commentsFile = path.join(dataDir, 'comments.json');

// Initialize data files if they don't exist
if (!fs.existsSync(dataFile)) {
  fs.writeJsonSync(dataFile, {
    clips: [],
    stats: {
      totalClips: 0,
      totalRatings: 0,
      averageRating: 0
    }
  });
}

if (!fs.existsSync(usersFile)) {
  fs.writeJsonSync(usersFile, { users: [] });
}

if (!fs.existsSync(messagesFile)) {
  fs.writeJsonSync(messagesFile, { messages: [] });
}

if (!fs.existsSync(commentsFile)) {
  fs.writeJsonSync(commentsFile, { comments: [] });
}

// Helper functions - now using encrypted database instead of JSON files
function readUsers() {
  // Legacy compatibility function - returns users in old format
  try {
    const allUsers = db.searchUsers('', 1000); // Get all users
    return {
      users: allUsers.map(user => ({
        ...user,
        friends: db.getFriends(user.id).map(f => f.id),
        incomingRequests: db.getPendingFriendRequests(user.id).map(f => f.id),
        outgoingRequests: [] // Not tracking outgoing requests in new system
      }))
    };
  } catch (error) {
    console.error('Error reading users from database:', error);
    return { users: [] };
  }
}

function writeUsers(data) {
  // This function is deprecated but kept for compatibility
  console.warn('writeUsers() is deprecated - data is now automatically saved to encrypted database');
  return true;
}
function readMessages() {
  try { return fs.readJsonSync(messagesFile); } catch { return { messages: [] }; }
}
function writeMessages(data) {
  try { fs.writeJsonSync(messagesFile, data, { spaces: 2 }); return true; } catch { return false; }
}
function readComments() {
  try { return fs.readJsonSync(commentsFile); } catch { return { comments: [] }; }
}
function writeComments(data) {
  try { fs.writeJsonSync(commentsFile, data, { spaces: 2 }); return true; } catch { return false; }
}

function getUserPublic(u) {
  // Convert database user format to public format
  const friends = u.friends || db.getFriends(u.id).map(f => f.id);
  return { 
    id: u.id, 
    username: u.username, 
    friends: friends, 
    createdAt: u.created_at || u.createdAt 
  };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').toLowerCase());
}

async function sendVerificationEmail({ to, username, token }) {
  const baseUrl = process.env.SITE_BASE_URL || `http://localhost:${PORT}`;
  const verifyUrl = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;
  const subject = 'Verify your Clip Portal account';
  const text = `Hi ${username || ''}\n\nPlease verify your email by clicking the link below:\n${verifyUrl}\n\nIf you did not sign up, you can ignore this email.`;
  const html = `<p>Hi ${username || ''},</p><p>Please verify your email by clicking the link below:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>If you did not sign up, you can ignore this email.</p>`;

  // Prefer SMTP if configured and nodemailer available
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || 'no-reply@clip-portal.local';

  try {
    if (nodemailer && host && user && pass) {
      const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
      await transporter.sendMail({ from, to, subject, text, html });
      return { sent: true };
    }
  } catch (e) {
    console.error('SMTP send failed:', e);
  }

  // Fallback: log link to server console
  console.log(`Email verification required for ${to}. Verify via: ${verifyUrl}`);
  return { sent: false };
}

function authRequired(req, res, next) {
  try {
    const token = req.cookies.auth || (req.headers['authorization']?.split(' ')[1]);
    if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch (e) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
}

function optionalAuth(req) {
  try {
    const token = req.cookies.auth || (req.headers['authorization']?.split(' ')[1]);
    if (!token) return null;
    const payload = jwt.verify(token, JWT_SECRET);
    return payload.sub;
  } catch {
    return null;
  }
}

function adminRequired(req, res, next) {
  try {
    // Ensure auth first
    authRequired(req, res, () => {
      const users = readUsers();
      const me = users.users.find(u => u.id === req.userId);
      if (!me || !me.isAdmin) {
        return res.status(403).json({ success: false, error: 'Admin only' });
      }
      next();
    });
  } catch (e) {
    return res.status(403).json({ success: false, error: 'Admin only' });
  }
}

function getYouTubeThumbnail(url) {
  const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(youtubeRegex);
  if (match && match[1]) {
    return `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg`;
  }
  return null;
}

function getTwitchThumbnail(url) {
  const twitchRegex = /(?:https?:\/\/)?(?:www\.)?twitch\.tv\/videos\/(\d+)/;
  const match = url.match(twitchRegex);
  if (match && match[1]) {
    // Twitch requires API call for thumbnails, but we can use a placeholder
    return '/images/twitch-placeholder.svg';
  }
  return null;
}

// Generate thumbnail from video file using FFmpeg
function generateThumbnail(videoPath, thumbnailPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: ['0%'], // Take screenshot at the beginning
        filename: path.basename(thumbnailPath),
        folder: path.dirname(thumbnailPath),
        size: '400x225' // 16:9 aspect ratio
      })
      .on('end', () => {
        console.log('Thumbnail generated successfully');
        resolve(thumbnailPath);
      })
      .on('error', (err) => {
        console.error('Error generating thumbnail:', err);
        reject(err);
      });
  });
}

// Get duration (seconds) via ffprobe
function getVideoDurationSeconds(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(err);
      const sec = (metadata && metadata.format && metadata.format.duration) ? Number(metadata.format.duration) : 0;
      resolve(sec || 0);
    });
  });
}

function secondsToTimestamp(totalSeconds) {
  const sec = Math.max(0, Math.round(totalSeconds || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function readData() {
  try {
    return fs.readJsonSync(dataFile);
  } catch (error) {
    console.error('Error reading data file:', error);
    return { clips: [], stats: { totalClips: 0, totalRatings: 0, averageRating: 0 } };
  }
}

function writeData(data) {
  try {
    fs.writeJsonSync(dataFile, data, { spaces: 2 });
    return true;
  } catch (error) {
    console.error('Error writing data file:', error);
    return false;
  }
}

function updateStats(data) {
  const clips = data.clips;
  data.stats.totalClips = clips.length;
  data.stats.totalRatings = clips.reduce((sum, clip) => sum + clip.ratingCount, 0);
  data.stats.averageRating = clips.length > 0 
    ? (clips.reduce((sum, clip) => sum + clip.rating, 0) / clips.length).toFixed(1)
    : 0;
  return data;
}

// On startup, ensure thumbnails exist for any uploaded clips that are missing them
// Deployment trigger: force reset database v2
async function ensureThumbnailsForExistingClips() {
  try {
    const data = readData();
    let changed = false;

    for (const clip of data.clips) {
      const isPlaceholder = !clip.thumbnail || clip.thumbnail.startsWith('/images/');
      if (clip.filePath && isPlaceholder) {
        const videoPath = path.join(__dirname, clip.filePath);
        if (!fs.existsSync(videoPath)) {
          console.warn(`Video not found for thumbnail generation: ${videoPath}`);
          continue;
        }

        const thumbFilename = `thumb_${clip.id}.jpg`;
        const thumbPath = path.join(thumbnailsDir, thumbFilename);

        try {
          // Only generate if it doesn't already exist
          if (!fs.existsSync(thumbPath)) {
            await generateThumbnail(videoPath, thumbPath);
          }
          clip.thumbnail = `/thumbnails/${thumbFilename}`;
          clip.updatedAt = new Date().toISOString();
          changed = true;
        } catch (err) {
          console.error(`Failed to generate thumbnail for clip ${clip.id}:`, err);
        }
      }
    }

    if (changed) {
      const updated = updateStats(data);
      writeData(updated);
      console.log('Ensured thumbnails for existing clips.');
    }
  } catch (err) {
    console.error('ensureThumbnailsForExistingClips failed:', err);
  }
}

// API Routes

// Ensure at least one admin exists: if none, promote the first user
(function ensureAdminUser(){
  try {
    const allUsers = db.getAllUsers();
    if (allUsers.length > 0 && !allUsers.some(u => u.is_admin)) {
      db.updateUser(allUsers[0].id, { isAdmin: true });
      console.log(`👑 Promoted initial user '${allUsers[0].username}' to admin`);
    }
  } catch (e) { /* ignore */ }
})();

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  try {
    console.log('Registration attempt:', { username: req.body?.username, email: req.body?.email });
    const { username, email, password } = req.body || {};
    if (!username || !password || !email) {
      return res.status(400).json({ success: false, error: 'Username, email and password are required' });
    }
    if (username.length < 3 || password.length < 6) {
      return res.status(400).json({ success: false, error: 'Username must be 3+ chars and password 6+ chars' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address' });
    }
    
    const emailLower = String(email).toLowerCase();
    
    // Check if username or email already exists using database
    if (db.getUserByUsername(username)) {
      return res.status(409).json({ success: false, error: 'Username already taken' });
    }
    if (db.getUserByEmail(emailLower)) {
      return res.status(409).json({ success: false, error: 'Email already in use' });
    }
    
    const id = uuidv4();
    const passwordHash = bcrypt.hashSync(password, 10);
    const verifyToken = uuidv4();
    
    // Check if this is the first user to make them admin
    console.log('Checking if first user...');
    const isFirstUser = db.getAllUsers().length === 0;
    console.log('Is first user:', isFirstUser);
    
    const userData = {
      id,
      username,
      email: emailLower,
      passwordHash,
      isVerified: true, // Skip email verification for easier setup
      verifyToken: null,
      verifyTokenExpires: null,
      isAdmin: isFirstUser
    };
    
    console.log('Creating user with data:', { ...userData, passwordHash: '[hidden]' });
    // Create user in encrypted database
    db.createUser(userData);
    console.log('User created successfully');
    
    // Log the registration
    db.logAction(
      id,
      'USER_REGISTERED',
      { username, email: emailLower },
      req.ip,
      req.headers['user-agent']
    );

    // Send verification email (best-effort)
    await sendVerificationEmail({ to: emailLower, username, token: verifyToken });

    res.json({ success: true, message: 'Account created. Please check your email to verify your account.' });
  } catch (e) {
    console.error('register error:', e);
    console.error('Stack:', e.stack);
    res.status(500).json({ success: false, error: 'Register failed: ' + e.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    
    // Get user from encrypted database
    const user = db.getUserByUsername(username);
    if (!user) return res.status(401).json({ success: false, error: 'Invalid credentials' });
    if (!bcrypt.compareSync(password || '', user.password_hash)) return res.status(401).json({ success: false, error: 'Invalid credentials' });
    if (!user.is_verified) return res.status(403).json({ success: false, error: 'Email not verified. Please check your inbox.', needsVerification: true });
    
    const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '30d' });
    
    // Log the login
    db.logAction(
      user.id,
      'USER_LOGIN',
      { username: user.username },
      req.ip,
      req.headers['user-agent']
    );
    
    res.cookie('auth', token, { httpOnly: true, sameSite: 'lax' });
    res.json({ success: true, user: getUserPublic(user) });
  } catch (e) {
    console.error('login error', e);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('auth');
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  const uid = optionalAuth(req);
  if (!uid) return res.json({ success: true, user: null });
  
  const user = db.getUserById(uid);
  if (!user) return res.json({ success: true, user: null });
  
  const incoming = db.getPendingFriendRequests(uid).length;
  res.json({ 
    success: true, 
    user: { 
      ...getUserPublic(user), 
      isAdmin: !!user.is_admin, 
      incomingRequests: incoming, 
      isVerified: !!user.is_verified 
    } 
  });
});

// User search (for adding friends)
app.get('/api/users/search', authRequired, (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  
  try {
    const users = db.searchUsers(q, 20); // Limit to 20 results
    const publicUsers = users.map(getUserPublic);
    res.json({ success: true, users: publicUsers });
  } catch (error) {
    console.error('User search error:', error);
    res.status(500).json({ success: false, error: 'Search failed' });
  }
});

// Friends routes
app.get('/api/friends', authRequired, (req, res) => {
  const friends = db.getFriends(req.userId);
  const incomingRequests = db.getPendingFriendRequests(req.userId);
  
  res.json({ 
    success: true, 
    friends: friends.map(getUserPublic), 
    incomingRequests: incomingRequests.map(r => r.id), 
    outgoingRequests: [] // Not tracking outgoing in new system
  });
});

app.post('/api/friends/request/:id', authRequired, (req, res) => {
  const targetId = req.params.id;
  if (targetId === req.userId) return res.status(400).json({ success: false, error: 'Cannot friend yourself' });
  
  const target = db.getUserById(targetId);
  if (!target) return res.status(404).json({ success: false, error: 'User not found' });
  
  // Check if already friends
  const existingFriends = db.getFriends(req.userId);
  if (existingFriends.some(f => f.id === targetId)) {
    return res.status(409).json({ success: false, error: 'Already friends' });
  }
  
  // Check if request already exists
  const pendingRequests = db.getPendingFriendRequests(targetId);
  if (pendingRequests.some(r => r.id === req.userId)) {
    return res.status(409).json({ success: false, error: 'Request already sent' });
  }
  
  try {
    db.sendFriendRequest(req.userId, targetId);
    
    // Log the action
    db.logAction(
      req.userId,
      'FRIEND_REQUEST_SENT',
      { targetUserId: targetId, targetUsername: target.username },
      req.ip,
      req.headers['user-agent']
    );
    
    res.json({ success: true, message: 'Friend request sent' });
  } catch (error) {
    console.error('Friend request error:', error);
    res.status(500).json({ success: false, error: 'Failed to send friend request' });
  }
});

app.post('/api/friends/accept/:id', authRequired, (req, res) => {
  const requesterId = req.params.id;
  
  const requester = db.getUserById(requesterId);
  if (!requester) return res.status(404).json({ success: false, error: 'User not found' });
  
  try {
    db.acceptFriendRequest(req.userId, requesterId);
    
    // Log the action
    db.logAction(
      req.userId,
      'FRIEND_REQUEST_ACCEPTED',
      { requesterUserId: requesterId, requesterUsername: requester.username },
      req.ip,
      req.headers['user-agent']
    );
    
    res.json({ success: true, message: 'Friend request accepted' });
  } catch (error) {
    console.error('Friend accept error:', error);
    res.status(500).json({ success: false, error: 'Failed to accept friend request' });
  }
});

// Admin routes
app.get('/api/admin/users', adminRequired, (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  const users = readUsers();
  let list = users.users;
  if (q) list = list.filter(u => u.username.toLowerCase().includes(q));
  list = list.slice(0, 50).map(u => ({ ...getUserPublic(u), isAdmin: !!u.isAdmin }));
  res.json({ success: true, users: list });
});

app.post('/api/admin/users/:id/make-admin', adminRequired, (req, res) => {
  const users = readUsers();
  const u = users.users.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ success: false, error: 'User not found' });
  u.isAdmin = true;
  writeUsers(users);
  res.json({ success: true, user: { ...getUserPublic(u), isAdmin: true } });
});

app.delete('/api/admin/users/:id', adminRequired, (req, res) => {
  try {
    const userId = req.params.id;
    const currentUser = req.userId;
    const users = readUsers();
    const toDelete = users.users.find(u => u.id === userId);
    if (!toDelete) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    // Prevent admin from deleting themselves
    if (userId === currentUser) {
      return res.status(403).json({ success: false, error: 'You cannot delete your own account from admin panel.' });
    }
    // If deleting admin, ensure at least one admin remains
    if (toDelete.isAdmin) {
      const adminCount = users.users.filter(u => u.isAdmin).length;
      if (adminCount <= 1) {
        return res.status(400).json({ success: false, error: 'There must be at least one admin.' });
      }
    }
    users.users = users.users.filter(u => u.id !== userId);
    if (writeUsers(users)) {
      return res.json({ success: true, message: 'User deleted successfully' });
    } else {
      return res.status(500).json({ success: false, error: 'Failed to delete user' });
    }
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ success: false, error: 'Failed to delete user' });
  }
});

// Comments routes
app.get('/api/clips/:id/comments', (req, res) => {
  const data = readComments();
  const list = data.comments
    .filter(c => c.clipId === req.params.id)
    .sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-200);
  res.json({ success: true, comments: list });
});

app.post('/api/clips/:id/comments', authRequired, (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ success: false, error: 'Comment text required' });
  const users = readUsers();
  const me = users.users.find(u => u.id === req.userId);
  const data = readComments();
  const c = { id: uuidv4(), clipId: req.params.id, userId: me.id, username: me.username, text: text.trim(), createdAt: new Date().toISOString() };
  data.comments.push(c);
  writeComments(data);
  res.json({ success: true, comment: c });
});

// Messaging routes
app.post('/api/messages/:toId', authRequired, (req, res) => {
  const toId = req.params.toId;
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ success: false, error: 'Message text required' });
  const users = readUsers();
  const me = users.users.find(u => u.id === req.userId);
  if (!(me.friends || []).includes(toId)) return res.status(403).json({ success: false, error: 'Can only message friends' });
  const data = readMessages();
  const msg = { id: uuidv4(), senderId: req.userId, recipientId: toId, text: text.trim(), createdAt: new Date().toISOString(), read: false };
  data.messages.push(msg);
  writeMessages(data);
  res.json({ success: true, message: msg });
});

app.get('/api/messages/with/:userId', authRequired, (req, res) => {
  const otherId = req.params.userId;
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const data = readMessages();
  const conv = data.messages
    .filter(m => (m.senderId === req.userId && m.recipientId === otherId) || (m.senderId === otherId && m.recipientId === req.userId))
    .sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-limit);
  res.json({ success: true, messages: conv });
});

// Health check endpoint for connectivity tests
app.get('/health', (req, res) => {
  res.json({ success: true, status: 'ok', time: new Date().toISOString() });
});

// Get all clips with optional filtering and sorting
app.get('/api/clips', (req, res) => {
  try {
    // Always compute fresh stats so UI reflects current data
    const data = updateStats(readData());

    // Determine requester admin status
    const uid = optionalAuth(req);
    const users = readUsers();
    const me = users.users.find(u => u.id === uid);
    const isAdmin = !!(me && me.isAdmin);

    // Normalize status for backward compatibility
    let clips = data.clips.map(c => ({ ...c, status: c.status || 'approved' }));

    // Status filtering
    const statusParam = (req.query.status || '').toLowerCase();
    if (!isAdmin) {
      clips = clips.filter(c => c.status === 'approved');
    } else if (statusParam === 'pending') {
      clips = clips.filter(c => c.status === 'pending');
    } else if (statusParam === 'approved') {
      clips = clips.filter(c => c.status === 'approved');
    } // 'all' or empty -> no additional filter for admin

    // Filter by category
    const category = req.query.category;
    if (category && category !== '') {
      clips = clips.filter(clip => (clip.category || '').toLowerCase() === category.toLowerCase());
    }

    // Sort clips
    const sortBy = req.query.sortBy || 'newest';
    switch (sortBy) {
      case 'oldest':
        clips.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        break;
      case 'rating':
        clips.sort((a, b) => (b.rating || 0) - (a.rating || 0));
        break;
      case 'popular':
        clips.sort((a, b) => (b.ratingCount || 0) - (a.ratingCount || 0));
        break;
      default: // newest
        clips.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    // Compute response stats from the filtered list (public should only see approved numbers)
    const stats = {
      totalClips: clips.length,
      totalRatings: clips.reduce((sum, c) => sum + (c.ratingCount || 0), 0),
      averageRating: clips.length > 0 ? Number((clips.reduce((s, c) => s + (c.rating || 0), 0) / clips.length).toFixed(1)) : 0
    };

    res.json({
      success: true,
      clips,
      stats
    });
  } catch (error) {
    console.error('Error fetching clips:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch clips' });
  }
});

// Get a specific clip by ID
app.get('/api/clips/:id', (req, res) => {
  try {
    const data = readData();
    const clip = data.clips.find(c => c.id === req.params.id);
    
    if (!clip) {
      return res.status(404).json({ success: false, error: 'Clip not found' });
    }

    // Access control: only admins can view pending clips
    const status = clip.status || 'approved';
    if (status !== 'approved') {
      const uid = optionalAuth(req);
      const users = readUsers();
      const me = users.users.find(u => u.id === uid);
      const isAdmin = !!(me && me.isAdmin);
      if (!isAdmin) return res.status(404).json({ success: false, error: 'Clip not found' });
    }

    // Add a convenience flag for this requester
    const clientId = req.headers['x-client-id'];
    const ratedBy = Array.isArray(clip.ratedBy) ? clip.ratedBy : [];
    const userHasRated = clientId ? ratedBy.includes(clientId) : false;

    res.json({ success: true, clip: { ...clip, status, userHasRated } });
  } catch (error) {
    console.error('Error fetching clip:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch clip' });
  }
});

// Submit a new clip (goes into pending state for admin approval)
app.post('/api/clips', upload.single('file'), async (req, res) => {
  try {
    const { title, url, category, description } = req.body;
    
    // Validation
    if (!title || title.trim() === '') {
      return res.status(400).json({ success: false, error: 'Title is required' });
    }

    if (!url && !req.file) {
      return res.status(400).json({ success: false, error: 'Either URL or file is required' });
    }

    const data = readData();
    // Generate thumbnail
    let thumbnail = '/images/video-placeholder.svg'; // Default placeholder
    
    if (req.file) {
      // For file uploads, verify max duration 30s and generate thumbnail
      try {
        const videoPath = req.file.path;
        const durationSec = await getVideoDurationSeconds(videoPath);
        if (!Number.isFinite(durationSec)) {
          throw new Error('Could not read video duration');
        }
        if (durationSec > 30.05) {
          try { fs.unlinkSync(videoPath); } catch (_) {}
          return res.status(400).json({ success: false, error: 'Maximum clip length is 30 seconds.' });
        }

        const thumbnailFilename = `thumb_${uuidv4()}.jpg`;
        const thumbnailPath = path.join(thumbnailsDir, thumbnailFilename);

        await generateThumbnail(videoPath, thumbnailPath);
        thumbnail = `/thumbnails/${thumbnailFilename}`;
        console.log(`Generated thumbnail: ${thumbnail}`);

        // Attach computed duration to request for later use
        req._clipDurationSec = durationSec;
      } catch (error) {
        console.error('Failed processing uploaded video:', error);
        return res.status(400).json({ success: false, error: 'Failed to process video. Ensure it is a valid file up to 30 seconds.' });
      }
    } else if (url) {
      // Try to get thumbnail from URL
      const youtubeThumbnail = getYouTubeThumbnail(url);
      const twitchThumbnail = getTwitchThumbnail(url);
      
      if (youtubeThumbnail) {
        thumbnail = youtubeThumbnail;
      } else if (twitchThumbnail) {
        thumbnail = '/images/twitch-placeholder.svg';
      } else {
        // For other URLs, use a generic placeholder
        thumbnail = '/images/video-placeholder.svg';
      }
    }

    const uid = optionalAuth(req);
    const users = readUsers();
    const submitter = users.users.find(u => u.id === uid);

    const newClip = {
      id: uuidv4(),
      title: title.trim(),
      description: description ? description.trim() : '',
      category: category || 'Other',
      url: url || null,
      filePath: req.file ? `/uploads/${req.file.filename}` : null,
      thumbnail: thumbnail,
      duration: req._clipDurationSec ? secondsToTimestamp(req._clipDurationSec) : '0:00',
      rating: 0,
      ratingCount: 0,
      ratedBy: [], // track unique raters by client id
      durationSeconds: req._clipDurationSec || null,
      status: 'pending',
      submittedBy: submitter ? submitter.id : null,
      submittedByName: submitter ? submitter.username : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    data.clips.push(newClip);
    const updatedData = updateStats(data);
    
    if (writeData(updatedData)) {
      res.json({ success: true, clip: newClip, message: 'Clip submitted and awaiting admin approval.' });
    } else {
      res.status(500).json({ success: false, error: 'Failed to save clip' });
    }
  } catch (error) {
    console.error('Error submitting clip:', error);
    res.status(500).json({ success: false, error: 'Failed to submit clip' });
  }
});

// Rate a clip (require login; one rating per user)
app.post('/api/clips/:id/rate', authRequired, (req, res) => {
  try {
    const { rating } = req.body || {};
    const userId = req.userId;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, error: 'Rating must be between 1 and 5' });
    }

    const data = readData();
    const clipIndex = data.clips.findIndex(c => c.id === req.params.id);
    if (clipIndex === -1) {
      return res.status(404).json({ success: false, error: 'Clip not found' });
    }

    const clip = data.clips[clipIndex];
    clip.ratedBy = Array.isArray(clip.ratedBy) ? clip.ratedBy : [];

    if (clip.ratedBy.includes(userId)) {
      return res.status(409).json({ success: false, error: 'You have already rated this clip' });
    }

    const newRatingCount = clip.ratingCount + 1;
    const newRating = ((clip.rating * clip.ratingCount) + rating) / newRatingCount;

    data.clips[clipIndex] = {
      ...clip,
      rating: Math.round(newRating * 10) / 10,
      ratingCount: newRatingCount,
      ratedBy: [...clip.ratedBy, userId],
      updatedAt: new Date().toISOString()
    };

    const updatedData = updateStats(data);

    if (writeData(updatedData)) {
      res.json({
        success: true,
        clip: data.clips[clipIndex],
        message: 'Rating submitted successfully'
      });
    } else {
      res.status(500).json({ success: false, error: 'Failed to save rating' });
    }
  } catch (error) {
    console.error('Error rating clip:', error);
    res.status(500).json({ success: false, error: 'Failed to rate clip' });
  }
});

// Get site statistics
app.get('/api/stats', (req, res) => {
  try {
    const data = readData();
    res.json({ success: true, stats: data.stats });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

// Email verification endpoints
app.get('/api/auth/verify', (req, res) => {
  try {
    const token = (req.query.token || '').trim();
    if (!token) return res.status(400).json({ success: false, error: 'Missing token' });
    const users = readUsers();
    const idx = users.users.findIndex(u => u.verifyToken === token);
    if (idx === -1) return res.status(400).json({ success: false, error: 'Invalid or expired token' });
    const u = users.users[idx];
    const exp = u.verifyTokenExpires ? new Date(u.verifyTokenExpires).getTime() : 0;
    if (!exp || exp < Date.now()) return res.status(400).json({ success: false, error: 'Token expired' });
    u.isVerified = true;
    u.verifyToken = null;
    u.verifyTokenExpires = null;
    writeUsers(users);
    res.json({ success: true, message: 'Email verified. You can now log in.' });
  } catch (e) {
    console.error('verify error', e);
    res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

app.post('/api/auth/resend-verification', async (req, res) => {
  try {
    const { usernameOrEmail } = req.body || {};
    const users = readUsers();
    const match = (usernameOrEmail || '').toLowerCase();
    const u = users.users.find(x => x.username.toLowerCase() === match || (x.email || '').toLowerCase() === match);
    if (!u) return res.status(404).json({ success: false, error: 'Account not found' });
    if (u.isVerified) return res.json({ success: true, message: 'Already verified' });
    u.verifyToken = uuidv4();
    u.verifyTokenExpires = new Date(Date.now() + 24*3600*1000).toISOString();
    writeUsers(users);
    await sendVerificationEmail({ to: decryptEmail(u.email), username: u.username, token: u.verifyToken });
    res.json({ success: true, message: 'Verification email sent' });
  } catch (e) {
    console.error('resend error', e);
    res.status(500).json({ success: false, error: 'Failed to resend email' });
  }
});

// Admin authentication
app.post('/api/admin/login', (req, res) => {
  try {
    const { password } = req.body;
    
    if (password === ADMIN_PASSWORD) {
      res.json({ success: true, message: 'Login successful' });
    } else {
      res.status(401).json({ success: false, error: 'Invalid password' });
    }
  } catch (error) {
    console.error('Error during admin login:', error);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// Approve a pending clip (admin only)
app.post('/api/admin/clips/:id/approve', adminRequired, (req, res) => {
  try {
    const data = readData();
    const idx = data.clips.findIndex(c => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Clip not found' });
    data.clips[idx].status = 'approved';
    data.clips[idx].updatedAt = new Date().toISOString();
    if (writeData(updateStats(data))) {
      return res.json({ success: true, clip: data.clips[idx] });
    }
    return res.status(500).json({ success: false, error: 'Failed to approve clip' });
  } catch (e) {
    console.error('approve error', e);
    res.status(500).json({ success: false, error: 'Failed to approve clip' });
  }
});

// Delete a clip (admin only)
app.delete('/api/clips/:id', adminRequired, (req, res) => {
  try {
    const data = readData();
    const clipIndex = data.clips.findIndex(c => c.id === req.params.id);
    
    if (clipIndex === -1) {
      return res.status(404).json({ success: false, error: 'Clip not found' });
    }

    const clip = data.clips[clipIndex];
    
    // Delete associated files
    if (clip.filePath) {
      const filePath = path.join(__dirname, clip.filePath);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`Deleted video file: ${filePath}`);
      }
    }
    
    // Delete thumbnail if it's a generated one (not YouTube/external)
    if (clip.thumbnail && clip.thumbnail.startsWith('/thumbnails/')) {
      const thumbnailPath = path.join(__dirname, clip.thumbnail);
      if (fs.existsSync(thumbnailPath)) {
        fs.unlinkSync(thumbnailPath);
        console.log(`Deleted thumbnail: ${thumbnailPath}`);
      }
    }

    // Remove clip from data
    data.clips.splice(clipIndex, 1);
    const updatedData = updateStats(data);
    
    if (writeData(updatedData)) {
      res.json({ 
        success: true, 
        message: 'Clip deleted successfully',
        deletedClip: clip
      });
    } else {
      res.status(500).json({ success: false, error: 'Failed to delete clip' });
    }
  } catch (error) {
    console.error('Error deleting clip:', error);
    res.status(500).json({ success: false, error: 'Failed to delete clip' });
  }
});

// Serve uploaded files and thumbnails
app.use('/uploads', express.static(uploadsDir));
app.use('/thumbnails', express.static(thumbnailsDir));

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: 'File too large. Maximum size is 100MB.' });
    }
  }
  
  console.error('Server error:', error);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Helper to find a local IPv4 address for convenience logging
function getLocalIPv4() {
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name] || []) {
        if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal) {
          return iface.address;
        }
      }
    }
  } catch (_) {}
  return 'localhost';
}

// Start server (bind to all interfaces for LAN access)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Clip Portal server running on http://localhost:${PORT}`);
  const ip = getLocalIPv4();
  console.log(`📱 Access from your phone (same Wi‑Fi): http://${ip}:${PORT}`);
  console.log(`📁 Uploads directory: ${uploadsDir}`);
  console.log(`🔐 Database: Encrypted SQLite with automatic backups`);
  
  // Start automated backup system
  try {
    backupSystem.startScheduledBackups();
    console.log(`💾 Automated database backups enabled (daily at 2 AM)`);
  } catch (error) {
    console.warn('⚠️  Failed to start backup system:', error.message);
  }
  
  // Kick off background thumbnail generation for any existing clips
  ensureThumbnailsForExistingClips().catch(err => console.error('Startup thumbnail generation failed:', err));
});

module.exports = app;
