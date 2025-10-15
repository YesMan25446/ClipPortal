const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs-extra');

// Database configuration
const DB_PATH = path.join(__dirname, 'data', 'clipportal.db');
const DB_KEY = process.env.DB_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

// Ensure data directory exists
fs.ensureDirSync(path.dirname(DB_PATH));

// Initialize database
const db = new Database(DB_PATH);

// Enable foreign keys and WAL mode for better performance
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// Encryption/Decryption functions for sensitive data
function encrypt(text, key = DB_KEY) {
  if (!text) return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  cipher.setAAD(Buffer.from('clipportal', 'utf8'));
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedData, key = DB_KEY) {
  if (!encryptedData || !encryptedData.includes(':')) return encryptedData;
  
  try {
    const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    decipher.setAAD(Buffer.from('clipportal', 'utf8'));
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption failed:', error);
    return encryptedData; // Return original if decryption fails
  }
}

// Create tables
function initializeDatabase() {
  // Users table with encrypted sensitive fields
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email_encrypted TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_verified BOOLEAN DEFAULT FALSE,
      verify_token TEXT NULL,
      verify_token_expires TEXT NULL,
      is_admin BOOLEAN DEFAULT FALSE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata_encrypted TEXT NULL
    )
  `);

  // Friends table
  db.exec(`
    CREATE TABLE IF NOT EXISTS friends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      friend_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'blocked')),
      requested_at TEXT NOT NULL,
      accepted_at TEXT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, friend_id)
    )
  `);

  // Sessions table for enhanced security
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      jwt_token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Audit log for security tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      action TEXT NOT NULL,
      details_encrypted TEXT,
      ip_address TEXT,
      user_agent TEXT,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Create indexes for performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email_encrypted);
    CREATE INDEX IF NOT EXISTS idx_friends_user_id ON friends(user_id);
    CREATE INDEX IF NOT EXISTS idx_friends_friend_id ON friends(friend_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
  `);

  // Initialize prepared statements after tables are created
  userQueries = {
    create: db.prepare(`
      INSERT INTO users (
        id, username, email_encrypted, password_hash, is_verified, 
        verify_token, verify_token_expires, is_admin, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    
    findById: db.prepare('SELECT * FROM users WHERE id = ?'),
    findByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
    findByEmail: db.prepare('SELECT * FROM users WHERE email_encrypted = ?'),
    
    update: db.prepare(`
      UPDATE users SET 
        email_encrypted = ?, is_verified = ?, verify_token = ?, 
        verify_token_expires = ?, is_admin = ?, updated_at = ?
      WHERE id = ?
    `),
    
    updatePassword: db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?'),
    delete: db.prepare('DELETE FROM users WHERE id = ?'),
    list: db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?'),
    count: db.prepare('SELECT COUNT(*) as count FROM users'),
    search: db.prepare('SELECT * FROM users WHERE username LIKE ? LIMIT ? OFFSET ?')
  };
  
  friendQueries = {
    addFriend: db.prepare(`
      INSERT INTO friends (user_id, friend_id, status, requested_at)
      VALUES (?, ?, 'pending', ?)
    `),
    
    acceptFriend: db.prepare(`
      UPDATE friends SET status = 'accepted', accepted_at = ?
      WHERE user_id = ? AND friend_id = ? AND status = 'pending'
    `),
    
    getFriends: db.prepare(`
      SELECT u.id, u.username, u.created_at, f.accepted_at
      FROM friends f
      JOIN users u ON (f.friend_id = u.id OR f.user_id = u.id)
      WHERE (f.user_id = ? OR f.friend_id = ?) 
        AND f.status = 'accepted' 
        AND u.id != ?
    `),
    
    getPendingRequests: db.prepare(`
      SELECT u.id, u.username, f.requested_at
      FROM friends f
      JOIN users u ON f.user_id = u.id
      WHERE f.friend_id = ? AND f.status = 'pending'
    `),
    
    removeFriend: db.prepare(`
      DELETE FROM friends 
      WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
    `)
  };
  
  sessionQueries = {
    create: db.prepare(`
      INSERT INTO user_sessions (id, user_id, jwt_token_hash, expires_at, created_at, last_used_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    
    find: db.prepare('SELECT * FROM user_sessions WHERE id = ? AND expires_at > ?'),
    update: db.prepare('UPDATE user_sessions SET last_used_at = ? WHERE id = ?'),
    delete: db.prepare('DELETE FROM user_sessions WHERE id = ?'),
    deleteExpired: db.prepare('DELETE FROM user_sessions WHERE expires_at <= ?'),
    deleteByUser: db.prepare('DELETE FROM user_sessions WHERE user_id = ?')
  };
  
  auditQueries = {
    log: db.prepare(`
      INSERT INTO audit_log (user_id, action, details_encrypted, ip_address, user_agent, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    
    getByUser: db.prepare(`
      SELECT * FROM audit_log WHERE user_id = ? 
      ORDER BY timestamp DESC LIMIT ? OFFSET ?
    `),
    
    cleanup: db.prepare('DELETE FROM audit_log WHERE timestamp < ?')
  };

  console.log('✅ Database initialized successfully');
}

// User management functions - will be initialized after database setup
let userQueries = {};

// Friend management functions - will be initialized after database setup
let friendQueries = {};

// Session management - will be initialized after database setup
let sessionQueries = {};

// Audit logging - will be initialized after database setup
let auditQueries = {};

// Database utilities
class DatabaseManager {
  constructor() {
    initializeDatabase();
  }

  // User operations
  createUser({ id, username, email, passwordHash, isVerified = false, verifyToken, verifyTokenExpires, isAdmin = false }) {
    const now = new Date().toISOString();
    const encryptedEmail = encrypt(email.toLowerCase());
    
    return userQueries.create.run(
      id, username, encryptedEmail, passwordHash, isVerified ? 1 : 0,
      verifyToken, verifyTokenExpires, isAdmin ? 1 : 0, now, now
    );
  }

  getUserById(id) {
    const user = userQueries.findById.get(id);
    if (user) {
      user.email = decrypt(user.email_encrypted);
      user.is_verified = Boolean(user.is_verified);
      user.is_admin = Boolean(user.is_admin);
      delete user.email_encrypted;
    }
    return user;
  }

  getUserByUsername(username) {
    const user = userQueries.findByUsername.get(username);
    if (user) {
      user.email = decrypt(user.email_encrypted);
      user.is_verified = Boolean(user.is_verified);
      user.is_admin = Boolean(user.is_admin);
      delete user.email_encrypted;
    }
    return user;
  }

  getUserByEmail(email) {
    const encryptedEmail = encrypt(email.toLowerCase());
    const user = userQueries.findByEmail.get(encryptedEmail);
    if (user) {
      user.email = decrypt(user.email_encrypted);
      user.is_verified = Boolean(user.is_verified);
      user.is_admin = Boolean(user.is_admin);
      delete user.email_encrypted;
    }
    return user;
  }

  updateUser(id, updates) {
    const now = new Date().toISOString();
    const currentUser = userQueries.findById.get(id);
    if (!currentUser) return null;
    
    const encryptedEmail = updates.email ? encrypt(updates.email.toLowerCase()) : currentUser.email_encrypted;
    const isVerified = updates.isVerified !== undefined ? (updates.isVerified ? 1 : 0) : currentUser.is_verified;
    const isAdmin = updates.isAdmin !== undefined ? (updates.isAdmin ? 1 : 0) : currentUser.is_admin;
    
    return userQueries.update.run(
      encryptedEmail,
      isVerified,
      updates.verifyToken !== undefined ? updates.verifyToken : currentUser.verify_token,
      updates.verifyTokenExpires !== undefined ? updates.verifyTokenExpires : currentUser.verify_token_expires,
      isAdmin,
      now,
      id
    );
  }

  updateUserPassword(id, passwordHash) {
    const now = new Date().toISOString();
    return userQueries.updatePassword.run(passwordHash, now, id);
  }

  deleteUser(id) {
    return userQueries.delete.run(id);
  }

  getAllUsers(limit = 1000, offset = 0) {
    const users = userQueries.list.all(limit, offset);
    return users.map(user => {
      user.email = decrypt(user.email_encrypted);
      user.is_verified = Boolean(user.is_verified);
      user.is_admin = Boolean(user.is_admin);
      delete user.email_encrypted;
      return user;
    });
  }

  searchUsers(query, limit = 50, offset = 0) {
    const users = userQueries.search.all(`%${query}%`, limit, offset);
    return users.map(user => {
      user.email = decrypt(user.email_encrypted);
      user.is_verified = Boolean(user.is_verified);
      user.is_admin = Boolean(user.is_admin);
      delete user.email_encrypted;
      return user;
    });
  }

  // Friend operations
  sendFriendRequest(userId, friendId) {
    const now = new Date().toISOString();
    return friendQueries.addFriend.run(userId, friendId, now);
  }

  acceptFriendRequest(userId, friendId) {
    const now = new Date().toISOString();
    return friendQueries.acceptFriend.run(now, friendId, userId);
  }

  getFriends(userId) {
    return friendQueries.getFriends.all(userId, userId, userId);
  }

  getPendingFriendRequests(userId) {
    return friendQueries.getPendingRequests.all(userId);
  }

  removeFriend(userId, friendId) {
    return friendQueries.removeFriend.run(userId, friendId, friendId, userId);
  }

  // Session management
  createSession(sessionId, userId, tokenHash, expiresAt, ipAddress, userAgent) {
    const now = new Date().toISOString();
    return sessionQueries.create.run(
      sessionId, userId, tokenHash, expiresAt, now, now, ipAddress, userAgent
    );
  }

  getValidSession(sessionId) {
    const now = new Date().toISOString();
    return sessionQueries.find.get(sessionId, now);
  }

  updateSessionLastUsed(sessionId) {
    const now = new Date().toISOString();
    return sessionQueries.update.run(now, sessionId);
  }

  deleteSession(sessionId) {
    return sessionQueries.delete.run(sessionId);
  }

  deleteUserSessions(userId) {
    return sessionQueries.deleteByUser.run(userId);
  }

  cleanupExpiredSessions() {
    const now = new Date().toISOString();
    return sessionQueries.deleteExpired.run(now);
  }

  // Audit logging
  logAction(userId, action, details, ipAddress, userAgent) {
    const now = new Date().toISOString();
    const encryptedDetails = details ? encrypt(JSON.stringify(details)) : null;
    return auditQueries.log.run(userId, action, encryptedDetails, ipAddress, userAgent, now);
  }

  getUserAuditLog(userId, limit = 100, offset = 0) {
    const logs = auditQueries.getByUser.all(userId, limit, offset);
    return logs.map(log => {
      if (log.details_encrypted) {
        try {
          log.details = JSON.parse(decrypt(log.details_encrypted));
        } catch (e) {
          log.details = null;
        }
        delete log.details_encrypted;
      }
      return log;
    });
  }

  // Database maintenance
  backup(backupPath) {
    return new Promise((resolve, reject) => {
      try {
        db.backup(backupPath)
          .then(() => {
            console.log(`✅ Database backup created: ${backupPath}`);
            resolve(backupPath);
          })
          .catch(reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  // Close database connection
  close() {
    db.close();
  }

  // Get database statistics
  getStats() {
    const userCount = userQueries.count.get().count;
    const adminCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_admin = 1').get().count;
    const friendshipCount = db.prepare('SELECT COUNT(*) as count FROM friends WHERE status = \'accepted\'').get().count;
    const sessionCount = db.prepare('SELECT COUNT(*) as count FROM user_sessions WHERE expires_at > ?').get(new Date().toISOString()).count;
    
    return {
      users: userCount,
      admins: adminCount,
      friendships: friendshipCount,
      activeSessions: sessionCount
    };
  }
}

// Export singleton instance
const dbManager = new DatabaseManager();

// Save encryption key to environment file if not exists
if (!process.env.DB_ENCRYPTION_KEY) {
  const envFile = path.join(__dirname, '.env');
  const envContent = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
  
  if (!envContent.includes('DB_ENCRYPTION_KEY')) {
    const newLine = envContent.length > 0 && !envContent.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(envFile, `${newLine}# Database encryption key - KEEP SECRET!\nDB_ENCRYPTION_KEY=${DB_KEY}\n`);
    console.log('🔐 Database encryption key saved to .env file');
  }
}

module.exports = {
  db: dbManager,
  encrypt,
  decrypt,
  DB_KEY
};