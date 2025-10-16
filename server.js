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
// Use simple database with persistent storage on Railway volumes if available
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
// Persistent storage root (Railway volume if attached)
const STORAGE_ROOT = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');

// Mailjet domain validation helper (for Railway subdomains without DNS access)
const MJ_VALIDATION_FILE = process.env.MJ_VALIDATION_FILE;
if (MJ_VALIDATION_FILE) {
  app.all(`/${MJ_VALIDATION_FILE}`, (_req, res) => {
    res.set('Content-Type', 'text/plain');
    res.status(200).end(); // explicit 0-byte body, no charset
  });
}
// Generic fallback: accept any 32-hex + .txt (Mailjet style) just in case env var differs
app.all(/^\/[A-Fa-f0-9]{32}\.txt$/, (_req, res) => {
  res.set('Content-Type', 'text/plain');
  res.status(200).end();
});

// Admin configuration
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Vincentfårisig132'; // Change this to your desired password

// Middleware
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.static('.')); // Serve static files from current directory

// Ensure uploads and thumbnails directories exist (persisted)
const uploadsDir = path.join(STORAGE_ROOT, 'uploads');
const thumbnailsDir = path.join(STORAGE_ROOT, 'thumbnails');
const avatarsDir = path.join(STORAGE_ROOT, 'profile', 'avatars');
const bannersDir = path.join(STORAGE_ROOT, 'profile', 'banners');
fs.ensureDirSync(uploadsDir);
fs.ensureDirSync(thumbnailsDir);
fs.ensureDirSync(avatarsDir);
fs.ensureDirSync(bannersDir);

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

// Image uploaders for profile (avatars, banners)
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const target = (req._imageTarget === 'banner') ? bannersDir : avatarsDir;
    cb(null, target);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    const uniqueName = `${uuidv4()}${ext}`;
    cb(null, uniqueName);
  }
});
const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Only image files are allowed'), false);
  }
});

// Data storage files (persisted)
const dataDir = STORAGE_ROOT;
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
  const profile = u.profile || {};
  return { 
    id: u.id, 
    username: u.username, 
    friends: friends, 
    createdAt: u.created_at || u.createdAt,
    profile: {
      displayName: profile.displayName || u.username,
      bio: profile.bio || '',
      themeColor: profile.themeColor || '#6ea1ff',
      avatar: profile.avatar || null,
      banner: profile.banner || null
    }
  };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').toLowerCase());
}

async function sendMagicLink({ to, username, token, purpose = 'verify', redirectTo = '/dashboard' }) {
  const baseUrl = process.env.SITE_BASE_URL || `http://localhost:${PORT}`;
  const magicUrl = `${baseUrl}/api/auth/magic-callback?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent(redirectTo)}`;
  
  let subject, text, html;
  
  if (purpose === 'verify') {
    subject = 'Verify your Clip Portal account';
    text = `Hi ${username || ''},\n\nWelcome to Clip Portal! Click the link below to verify your email and access your account:\n\n${magicUrl}\n\nThis link will expire in 15 minutes.\n\nIf you did not sign up, you can ignore this email.`;
    html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333;">Welcome to Clip Portal!</h2>
        <p>Hi ${username || ''},</p>
        <p>Thanks for signing up! Click the button below to verify your email and access your account:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${magicUrl}" style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Verify Account & Sign In</a>
        </div>
        <p style="color: #666; font-size: 14px;">This link will expire in 15 minutes for security.</p>
        <p style="color: #666; font-size: 14px;">If you did not sign up for Clip Portal, you can safely ignore this email.</p>
      </div>
    `;
  } else if (purpose === 'login') {
    subject = 'Sign in to Clip Portal';
    text = `Hi ${username || ''},\n\nClick the link below to sign in to your Clip Portal account:\n\n${magicUrl}\n\nThis link will expire in 15 minutes.\n\nIf you did not request this, you can ignore this email.`;
    html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333;">Sign in to Clip Portal</h2>
        <p>Hi ${username || ''},</p>
        <p>Click the button below to sign in to your account:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${magicUrl}" style="background-color: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Sign In</a>
        </div>
        <p style="color: #666; font-size: 14px;">This link will expire in 15 minutes for security.</p>
        <p style="color: #666; font-size: 14px;">If you did not request this sign-in link, you can safely ignore this email.</p>
      </div>
    `;
  }

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
  console.log(`Magic link for ${to} (${purpose}): ${magicUrl}`);
  return { sent: false };
}

// Legacy function for backwards compatibility
async function sendVerificationEmail({ to, username, token }) {
  return sendMagicLink({ to, username, token, purpose: 'verify' });
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
      const me = db.getUserById(req.userId);
      if (!me || !me.is_admin) {
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

// Map web path (/uploads/..., /thumbnails/...) to storage path in STORAGE_ROOT
function webToStoragePath(webPath) {
  const p = String(webPath || '').replace(/^\//, '');
  return path.join(STORAGE_ROOT, p.replace(/\//g, path.sep));
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
    // Trigger backup after writing clips data
    setTimeout(() => {
      try {
        const { backupToEnvironment } = require('./database-simple');
        if (backupToEnvironment) backupToEnvironment();
      } catch (e) { /* ignore if backup fails */ }
    }, 100);
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
const videoPath = webToStoragePath(clip.filePath);
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
    
    // Check if this is the first user to make them admin
    const isFirstUser = db.getAllUsers().length === 0;
    
    const userData = {
      id,
      username,
      email: emailLower,
      passwordHash,
      isVerified: false,
      isAdmin: isFirstUser
    };
    
    // Create user in encrypted database
    db.createUser(userData);
    
    // Create magic link token for verification (15 minutes)
    const { rawToken } = db.createMagicToken(id, 'verify', 15);
    
    // Log the registration
    db.logAction(
      id,
      'USER_REGISTERED',
      { username, email: emailLower },
      req.ip,
      req.headers['user-agent']
    );

    // Send magic link for verification
    await sendMagicLink({ 
      to: emailLower, 
      username, 
      token: rawToken, 
      purpose: 'verify', 
      redirectTo: '/dashboard' 
    });

    res.json({ success: true, message: 'Account created! Please check your email for a magic link to verify and sign in.' });
  } catch (e) {
    console.error('register error', e);
    res.status(500).json({ success: false, error: 'Register failed' });
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
    incomingRequests: incomingRequests.map(getUserPublic), 
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

app.post('/api/friends/decline/:id', authRequired, (req, res) => {
  const requesterId = req.params.id;
  const requester = db.getUserById(requesterId);
  if (!requester) return res.status(404).json({ success: false, error: 'User not found' });
  try {
    const changed = db.declineFriendRequest(req.userId, requesterId);
    if (!changed) return res.status(400).json({ success: false, error: 'No pending request to decline' });
    db.logAction(
      req.userId,
      'FRIEND_REQUEST_DECLINED',
      { requesterUserId: requesterId, requesterUsername: requester.username },
      req.ip,
      req.headers['user-agent']
    );
    res.json({ success: true, message: 'Friend request declined' });
  } catch (error) {
    console.error('Friend decline error:', error);
    res.status(500).json({ success: false, error: 'Failed to decline friend request' });
  }
});

// Profile routes
// Get public profile by username (with approved clips)
app.get('/api/profile/:username', async (req, res) => {
  try {
    const username = String(req.params.username || '').trim();
    if (!username) return res.status(400).json({ success: false, error: 'Username required' });
    const user = db.getUserByUsername(username);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    const data = readData();
    const clips = (data.clips || [])
      .filter(c => c.submittedBy === user.id && (c.status || 'pending') === 'approved')
      .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.json({ success: true, user: getUserPublic(user), clips });
  } catch (e) {
    console.error('profile get error', e);
    return res.status(500).json({ success: false, error: 'Failed to load profile' });
  }
});

// Get my profile (with my clips incl. pending)
app.get('/api/me/profile', authRequired, (req, res) => {
  try {
    const me = db.getUserById(req.userId);
    if (!me) return res.status(404).json({ success: false, error: 'User not found' });
    const data = readData();
    const myClips = (data.clips || [])
      .filter(c => c.submittedBy === me.id)
      .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    const userPublic = getUserPublic(me);
    // include editable profile details exactly as stored
    userPublic.profile = me.profile || userPublic.profile || {};
    return res.json({ success: true, user: userPublic, clips: myClips });
  } catch (e) {
    console.error('me profile error', e);
    return res.status(500).json({ success: false, error: 'Failed to load profile' });
  }
});

// Update my profile (displayName, bio, themeColor)
app.post('/api/me/profile', authRequired, (req, res) => {
  try {
    const { displayName, bio, themeColor } = req.body || {};
    const me = db.getUserById(req.userId);
    if (!me) return res.status(404).json({ success: false, error: 'User not found' });
    const nextProfile = { ...(me.profile || {}) };
    if (typeof displayName === 'string') nextProfile.displayName = displayName.slice(0, 60);
    if (typeof bio === 'string') nextProfile.bio = bio.slice(0, 500);
    if (typeof themeColor === 'string') nextProfile.themeColor = themeColor.slice(0, 20);
    const updated = db.updateUser(me.id, { profile: nextProfile });
    return res.json({ success: true, user: getUserPublic(updated) });
  } catch (e) {
    console.error('update profile error', e);
    return res.status(500).json({ success: false, error: 'Failed to update profile' });
  }
});

// Upload avatar
app.post('/api/me/profile/avatar', authRequired, (req, res, next) => { req._imageTarget = 'avatar'; next(); }, imageUpload.single('avatar'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
    const me = db.getUserById(req.userId);
    if (!me) return res.status(404).json({ success: false, error: 'User not found' });
    const rel = `/profile/avatars/${req.file.filename}`;
    const profile = { ...(me.profile || {}), avatar: rel };
    db.updateUser(me.id, { profile });
    return res.json({ success: true, url: rel });
  } catch (e) {
    console.error('avatar upload error', e);
    return res.status(500).json({ success: false, error: 'Failed to upload avatar' });
  }
});

// Upload banner
app.post('/api/me/profile/banner', authRequired, (req, res, next) => { req._imageTarget = 'banner'; next(); }, imageUpload.single('banner'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
    const me = db.getUserById(req.userId);
    if (!me) return res.status(404).json({ success: false, error: 'User not found' });
    const rel = `/profile/banners/${req.file.filename}`;
    const profile = { ...(me.profile || {}), banner: rel };
    db.updateUser(me.id, { profile });
    return res.json({ success: true, url: rel });
  } catch (e) {
    console.error('banner upload error', e);
    return res.status(500).json({ success: false, error: 'Failed to upload banner' });
  }
});

// Admin routes
// Pending clips count for notifications
app.get('/api/admin/pending-count', adminRequired, (req, res) => {
  try {
    const data = readData();
    const count = (data.clips || []).filter(c => (c.status || 'pending') === 'pending').length;
    res.json({ success: true, pending: count });
  } catch (e) {
    res.json({ success: true, pending: 0 });
  }
});

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

    // Locate real user from encrypted DB
    const allUsers = db.getAllUsers(10000);
    const toDelete = allUsers.find(u => u.id === userId);
    if (!toDelete) return res.status(404).json({ success: false, error: 'User not found' });

    // Prevent admin from deleting themselves
    if (userId === currentUser) {
      return res.status(403).json({ success: false, error: 'You cannot delete your own account from admin panel.' });
    }

    // Ensure at least one admin remains if deleting an admin
    if (toDelete.is_admin) {
      const adminCount = allUsers.filter(u => u.is_admin).length;
      if (adminCount <= 1) {
        return res.status(400).json({ success: false, error: 'There must be at least one admin.' });
      }
    }

    // Delete user's related data in DB (friends/messages/comments)
    db.deleteUserCascade(userId);

    // Also remove their clips and files from clips store
    let data = readData();
    const before = data.clips.length;
    for (const clip of [...data.clips]) {
      if (clip.submittedBy === userId) {
        // Delete associated files similar to clip delete route
        if (clip.filePath) {
          const filePath = webToStoragePath(clip.filePath);
          try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
        }
        if (clip.thumbnail && clip.thumbnail.startsWith('/thumbnails/')) {
          const tPath = webToStoragePath(clip.thumbnail);
          try { if (fs.existsSync(tPath)) fs.unlinkSync(tPath); } catch (_) {}
        }
      }
    }
    data.clips = data.clips.filter(c => c.submittedBy !== userId);
    writeData(updateStats(data));

    return res.json({ success: true, message: 'User deleted successfully', removedClips: before - data.clips.length });
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

// In-memory SSE stream registry for real-time messaging
const messageStreams = new Map(); // userId -> Set<res>
function sseSend(userId, event, payload) {
  const set = messageStreams.get(userId);
  if (!set) return;
  const data = `event: ${event}\n` + `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) {
    try { res.write(data); } catch (_) {}
  }
}

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
  // Push to both sender and recipient in real-time
  sseSend(toId, 'message', { message: msg });
  sseSend(req.userId, 'message', { message: msg });
  res.json({ success: true, message: msg });
});

// Server-Sent Events stream for real-time messages
app.get('/api/messages/stream', authRequired, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  res.flushHeaders && res.flushHeaders();
  // Register connection
  const uid = req.userId;
  let set = messageStreams.get(uid);
  if (!set) { set = new Set(); messageStreams.set(uid, set); }
  set.add(res);
  // Initial hello
  try { res.write(': connected\n\n'); } catch (_) {}
  // Keep-alive ping
  const interval = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 25000);
  // Cleanup on close
  req.on('close', () => {
    clearInterval(interval);
    try { res.end(); } catch (_) {}
    const s = messageStreams.get(uid);
    if (s) { s.delete(res); if (!s.size) messageStreams.delete(uid); }
  });
});

// Unread messages count for current user
app.get('/api/messages/unread-count', authRequired, (req, res) => {
  const data = readMessages();
  const count = data.messages.filter(m => m.recipientId === req.userId && !m.read).length;
  res.json({ success: true, unread: count });
});

// Mark messages from a specific user as read for the current user
app.post('/api/messages/mark-read/:userId', authRequired, (req, res) => {
  const otherId = req.params.userId;
  const data = readMessages();
  let changed = false;
  for (const m of data.messages) {
    if (m.senderId === otherId && m.recipientId === req.userId && !m.read) {
      m.read = true;
      changed = true;
    }
  }
  if (changed) writeMessages(data);
  res.json({ success: true, changed });
});

app.get('/api/messages/with/:userId', authRequired, (req, res) => {
  const otherId = req.params.userId;
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const markRead = String(req.query.markRead || 'true').toLowerCase() !== 'false';
  const data = readMessages();
  const conv = data.messages
    .filter(m => (m.senderId === req.userId && m.recipientId === otherId) || (m.senderId === otherId && m.recipientId === req.userId))
    .sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-limit);
  if (markRead) {
    let changed = false;
    for (const m of data.messages) {
      if (m.senderId === otherId && m.recipientId === req.userId && !m.read) { m.read = true; changed = true; }
    }
    if (changed) writeMessages(data);
  }
  res.json({ success: true, messages: conv });
});

// Health check endpoint for connectivity tests
app.get('/health', (req, res) => {
  res.json({ success: true, status: 'ok', time: new Date().toISOString() });
});

// Fix missing thumbnails on restored clips
function fixMissingThumbnails(clips) {
  return clips.map(clip => {
    // If thumbnail is a local file path that doesn't exist, fall back to placeholder or external thumbnail
if (clip.thumbnail && clip.thumbnail.startsWith('/thumbnails/')) {
      const thumbnailPath = webToStoragePath(clip.thumbnail);
      if (!fs.existsSync(thumbnailPath)) {
        // Try to get external thumbnail if URL is available
        if (clip.url) {
          const youtubeThumbnail = getYouTubeThumbnail(clip.url);
          const twitchThumbnail = getTwitchThumbnail(clip.url);
          if (youtubeThumbnail) {
            clip.thumbnail = youtubeThumbnail;
          } else if (twitchThumbnail) {
            clip.thumbnail = '/images/twitch-placeholder.svg';
          } else {
            clip.thumbnail = '/images/video-placeholder.svg';
          }
        } else {
          // No URL available, use generic placeholder
          clip.thumbnail = '/images/video-placeholder.svg';
        }
      }
    }
    return clip;
  });
}

// Get all clips with optional filtering and sorting
app.get('/api/clips', (req, res) => {
  try {
    // Always compute fresh stats so UI reflects current data
    const data = updateStats(readData());

    // Determine requester admin status
    const uid = optionalAuth(req);
    const me = uid ? db.getUserById(uid) : null;
    const isAdmin = !!(me && me.is_admin);

    // Don't auto-approve clips without status - preserve them as they are
    let clips = data.clips.map(c => ({ ...c, status: c.status || 'pending' }));
    
    // Fix missing thumbnails for restored clips
    clips = fixMissingThumbnails(clips);

    // Status filtering
    const statusParam = (req.query.status || '').toLowerCase();

    // Default: only approved for everyone (including admins) unless explicit status provided
    if (!statusParam) {
      clips = clips.filter(c => (c.status || 'pending') === 'approved');
    } else if (statusParam === 'approved') {
      clips = clips.filter(c => (c.status || 'pending') === 'approved');
    } else if (statusParam === 'pending') {
      // Only admins can view pending and only when explicitly requested (used by admin page)
      clips = isAdmin ? clips.filter(c => (c.status || 'pending') === 'pending')
                      : clips.filter(c => (c.status || 'pending') === 'approved');
    } else if (statusParam === 'all') {
      clips = isAdmin ? clips : clips.filter(c => (c.status || 'pending') === 'approved');
    } else {
      clips = clips.filter(c => (c.status || 'pending') === 'approved');
    }

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
    let clip = data.clips.find(c => c.id === req.params.id);
    
    if (!clip) {
      return res.status(404).json({ success: false, error: 'Clip not found' });
    }

    // Fix thumbnail if missing
    clip = fixMissingThumbnails([clip])[0];

    // Access control: only admins can view pending clips
    const status = clip.status || 'pending';
    if (status !== 'approved') {
      const uid = optionalAuth(req);
      const me = uid ? db.getUserById(uid) : null;
      const isAdmin = !!(me && me.is_admin);
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
        console.log(`Using YouTube thumbnail: ${thumbnail}`);
      } else if (twitchThumbnail) {
        thumbnail = '/images/twitch-placeholder.svg';
        console.log(`Using Twitch placeholder thumbnail`);
      } else {
        // For other URLs, use a generic placeholder
        thumbnail = '/images/video-placeholder.svg';
        console.log(`Using generic placeholder for URL: ${url}`);
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

// Magic link callback endpoint
app.get('/api/auth/magic-callback', (req, res) => {
  try {
    const rawToken = (req.query.token || '').trim();
    const redirectTo = req.query.redirect || '/dashboard';
    
    if (!rawToken) {
      return res.status(400).send(`
        <html><body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
          <h2 style="color: #dc3545;">Invalid Link</h2>
          <p>This magic link is missing required information. Please try requesting a new one.</p>
          <a href="/" style="color: #007bff;">Return to Home</a>
        </body></html>
      `);
    }

    // Verify the magic token
    const tokenData = db.verifyMagicToken(rawToken, 'verify') || db.verifyMagicToken(rawToken, 'login');
    
    if (!tokenData) {
      return res.status(400).send(`
        <html><body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
          <h2 style="color: #dc3545;">Link Expired or Invalid</h2>
          <p>This magic link has expired or has already been used. Magic links are valid for 15 minutes.</p>
          <p><a href="/api/auth/request-magic-link" style="color: #007bff;">Request a new magic link</a></p>
          <a href="/" style="color: #007bff;">Return to Home</a>
        </body></html>
      `);
    }

    // Get the user
    const user = db.getUserById(tokenData.userId);
    if (!user) {
      return res.status(404).send(`
        <html><body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
          <h2 style="color: #dc3545;">User Not Found</h2>
          <p>The user associated with this magic link could not be found.</p>
          <a href="/" style="color: #007bff;">Return to Home</a>
        </body></html>
      `);
    }

    // If this is a verification token, mark user as verified
    if (tokenData.purpose === 'verify' && !user.is_verified) {
      db.updateUser(user.id, { is_verified: true });
    }

    // Create JWT session token
    const sessionToken = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '30d' });
    
    // Log the successful authentication
    db.logAction(
      user.id,
      tokenData.purpose === 'verify' ? 'USER_VERIFIED_VIA_MAGIC_LINK' : 'USER_LOGIN_VIA_MAGIC_LINK',
      { purpose: tokenData.purpose },
      req.ip,
      req.headers['user-agent']
    );
    
    // Set session cookie and redirect
    res.cookie('auth', sessionToken, { httpOnly: true, sameSite: 'lax', secure: req.secure });
    
    // Success page with redirect
    const message = tokenData.purpose === 'verify' ? 
      'Email verified and signed in successfully!' : 
      'Signed in successfully!';
    
    res.send(`
      <html><body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
        <h2 style="color: #28a745;">✓ ${message}</h2>
        <p>Welcome, ${user.username}!</p>
        <p>Redirecting you to the app...</p>
        <script>
          setTimeout(() => {
            window.location.href = '${redirectTo}';
          }, 2000);
        </script>
        <a href="${redirectTo}" style="color: #007bff;">Click here if not redirected automatically</a>
      </body></html>
    `);
    
  } catch (e) {
    console.error('Magic link callback error:', e);
    res.status(500).send(`
      <html><body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
        <h2 style="color: #dc3545;">Authentication Error</h2>
        <p>Something went wrong while processing your magic link. Please try again.</p>
        <a href="/" style="color: #007bff;">Return to Home</a>
      </body></html>
    `);
  }
});

// Legacy email verification endpoint (for backwards compatibility)
app.get('/api/auth/verify', (req, res) => {
  try {
    const token = (req.query.token || '').trim();
    if (!token) return res.status(400).json({ success: false, error: 'Missing token' });

    // Find user by verification token (supports both legacy and new field names)
    const all = db.getAllUsers(10000);
    const u = all.find(x => (x.verify_token === token) || (x.verifyToken === token));
    if (!u) return res.status(400).json({ success: false, error: 'Invalid or expired token' });

    const expStr = u.verify_token_expires || u.verifyTokenExpires;
    const exp = expStr ? new Date(expStr).getTime() : 0;
    if (!exp || exp < Date.now()) return res.status(400).json({ success: false, error: 'Token expired' });

    db.updateUser(u.id, { is_verified: true, verify_token: null, verify_token_expires: null });
    res.json({ success: true, message: 'Email verified. You can now log in.' });
  } catch (e) {
    console.error('verify error', e);
    res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

// Rate limiting for magic links (simple in-memory store)
const rateLimitStore = new Map();

function checkRateLimit(key, maxRequests = 5, windowMs = 15 * 60 * 1000) { // 5 requests per 15 minutes
  const now = Date.now();
  const windowStart = now - windowMs;
  
  if (!rateLimitStore.has(key)) {
    rateLimitStore.set(key, []);
  }
  
  const requests = rateLimitStore.get(key).filter(time => time > windowStart);
  
  if (requests.length >= maxRequests) {
    return { allowed: false, resetTime: requests[0] + windowMs };
  }
  
  requests.push(now);
  rateLimitStore.set(key, requests);
  
  // Clean up old entries periodically
  if (Math.random() < 0.1) { // 10% chance
    for (const [k, times] of rateLimitStore.entries()) {
      const validTimes = times.filter(time => time > windowStart);
      if (validTimes.length === 0) {
        rateLimitStore.delete(k);
      } else {
        rateLimitStore.set(k, validTimes);
      }
    }
  }
  
  return { allowed: true };
}

// Magic link login endpoint
app.post('/api/auth/request-magic-link', async (req, res) => {
  try {
    const { email, redirectTo = '/dashboard' } = req.body || {};
    
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }
    
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address' });
    }
    
    const emailLower = email.toLowerCase();
    
    // Rate limiting by IP and email
    const ipKey = `magic_link_ip_${req.ip}`;
    const emailKey = `magic_link_email_${emailLower}`;
    
    const ipLimit = checkRateLimit(ipKey, 10, 15 * 60 * 1000); // 10 per 15 minutes per IP
    const emailLimit = checkRateLimit(emailKey, 3, 15 * 60 * 1000); // 3 per 15 minutes per email
    
    if (!ipLimit.allowed) {
      const resetIn = Math.ceil((ipLimit.resetTime - Date.now()) / 60000);
      return res.status(429).json({ 
        success: false, 
        error: `Too many requests from this IP. Try again in ${resetIn} minutes.` 
      });
    }
    
    if (!emailLimit.allowed) {
      const resetIn = Math.ceil((emailLimit.resetTime - Date.now()) / 60000);
      return res.status(429).json({ 
        success: false, 
        error: `Too many magic link requests for this email. Try again in ${resetIn} minutes.` 
      });
    }
    
    // Find user by email
    const user = db.getUserByEmail(emailLower);
    
    // Always return success message for security (don't reveal if email exists)
    if (!user) {
      // Log the attempt but don't reveal the email doesn't exist
      console.log(`Magic link requested for non-existent email: ${emailLower}`);
      return res.json({ 
        success: true, 
        message: 'If an account exists with that email, you will receive a magic link shortly.' 
      });
    }
    
    if (!user.is_verified) {
      return res.status(403).json({ 
        success: false, 
        error: 'Account not verified. Please check your email for the verification link sent when you signed up.' 
      });
    }
    
    // Create magic link token for login (15 minutes)
    const { rawToken } = db.createMagicToken(user.id, 'login', 15);
    
    // Log the request
    db.logAction(
      user.id,
      'MAGIC_LINK_REQUESTED',
      { purpose: 'login', email: emailLower },
      req.ip,
      req.headers['user-agent']
    );
    
    // Send magic link
    await sendMagicLink({ 
      to: emailLower, 
      username: user.username, 
      token: rawToken, 
      purpose: 'login',
      redirectTo 
    });
    
    res.json({ 
      success: true, 
      message: 'Magic link sent! Check your email and click the link to sign in.' 
    });
    
  } catch (e) {
    console.error('Magic link request error:', e);
    res.status(500).json({ success: false, error: 'Failed to send magic link' });
  }
});

app.post('/api/auth/resend-verification', async (req, res) => {
  try {
    const { usernameOrEmail } = req.body || {};
    const match = String(usernameOrEmail || '').toLowerCase();
    
    // Rate limiting
    const key = `resend_${req.ip}_${match}`;
    const rateLimit = checkRateLimit(key, 3, 15 * 60 * 1000); // 3 per 15 minutes
    
    if (!rateLimit.allowed) {
      const resetIn = Math.ceil((rateLimit.resetTime - Date.now()) / 60000);
      return res.status(429).json({ 
        success: false, 
        error: `Too many verification requests. Try again in ${resetIn} minutes.` 
      });
    }
    
    // Try username first, then email
    let u = db.getUserByUsername(match);
    if (!u && isValidEmail(match)) u = db.getUserByEmail(match);
    if (!u) return res.status(404).json({ success: false, error: 'Account not found' });
    if (u.is_verified) return res.json({ success: true, message: 'Already verified' });
    
    // Create magic link token for verification
    const { rawToken } = db.createMagicToken(u.id, 'verify', 15);
    
    await sendMagicLink({ 
      to: u.email, 
      username: u.username, 
      token: rawToken, 
      purpose: 'verify', 
      redirectTo: '/dashboard' 
    });
    
    res.json({ success: true, message: 'Verification magic link sent' });
  } catch (e) {
    console.error('resend error', e);
    res.status(500).json({ success: false, error: 'Failed to resend verification' });
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
      const filePath = webToStoragePath(clip.filePath);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`Deleted video file: ${filePath}`);
      }
    }
    
    // Delete thumbnail if it's a generated one (not YouTube/external)
if (clip.thumbnail && clip.thumbnail.startsWith('/thumbnails/')) {
      const thumbnailPath = webToStoragePath(clip.thumbnail);
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
app.use('/profile/avatars', express.static(avatarsDir));
app.use('/profile/banners', express.static(bannersDir));

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
  console.log(`📁 Storage root: ${STORAGE_ROOT}`);
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
