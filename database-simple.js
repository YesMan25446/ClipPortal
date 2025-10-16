// Simplified database for deployment - uses JSON files with encryption
const fs = require('fs-extra');
const crypto = require('crypto');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Simple encryption key (for deployment compatibility)
const DB_KEY = process.env.DB_ENCRYPTION_KEY || 'clipportal-default-key-change-in-production';

// Ensure data directory exists - prefer persistent volume if available
const dataDir = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
fs.ensureDirSync(dataDir);

// Log where we're storing data
if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
  console.log(`🗄️  Using persistent volume for data: ${dataDir}`);
} else {
  console.log(`🗄️  Using local data directory: ${dataDir} (ephemeral - data will be lost on redeploy)`);
}

// Data files
const usersFile = path.join(dataDir, 'users-encrypted.json');
const messagesFile = path.join(dataDir, 'messages.json');
const commentsFile = path.join(dataDir, 'comments.json');
const auditFile = path.join(dataDir, 'audit.json');

// Simple encryption/decryption
function encrypt(text) {
  if (!text) return null;
  try {
    const cipher = crypto.createCipher('aes256', DB_KEY);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  } catch (error) {
    console.error('Encryption error:', error);
    return text;
  }
}

function decrypt(encryptedText) {
  if (!encryptedText) return null;
  try {
    const decipher = crypto.createDecipher('aes256', DB_KEY);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    return encryptedText;
  }
}

// Restore data from environment backup if available
function restoreFromEnvironment() {
  try {
    if (process.env.USER_DATA_BACKUP) {
      const backupData = JSON.parse(Buffer.from(process.env.USER_DATA_BACKUP, 'base64').toString());
      fs.writeJsonSync(usersFile, backupData);
      console.log('✅ Restored user data from environment backup');
    }
  } catch (error) {
    console.warn('⚠️  Failed to restore from environment backup:', error.message);
  }
}

// Backup critical data to environment (for small datasets)
function backupToEnvironment() {
  try {
    if (fs.existsSync(usersFile)) {
      const userData = fs.readJsonSync(usersFile);
      // Only backup if we have users and it's not too large (< 8KB to stay within env var limits)
      if (userData.users && userData.users.length > 0) {
        const backupStr = JSON.stringify(userData);
        if (backupStr.length < 8192) {
          const encoded = Buffer.from(backupStr).toString('base64');
          // Log to console as a backup mechanism (can be set as env var)
          console.log(`📦 User data backup (set as USER_DATA_BACKUP env var): ${encoded}`);
        }
      }
    }
  } catch (error) {
    console.warn('⚠️  Failed to create environment backup:', error.message);
  }
}

// Initialize files if they don't exist
function initializeFiles() {
  // First try to restore from environment backup
  restoreFromEnvironment();
  
  if (!fs.existsSync(usersFile)) {
    fs.writeJsonSync(usersFile, { users: [] });
  }
  if (!fs.existsSync(messagesFile)) {
    fs.writeJsonSync(messagesFile, { messages: [] });
  }
  if (!fs.existsSync(commentsFile)) {
    fs.writeJsonSync(commentsFile, { comments: [] });
  }
  if (!fs.existsSync(auditFile)) {
    fs.writeJsonSync(auditFile, { logs: [] });
  }
}

class SimpleDatabaseManager {
  constructor() {
    initializeFiles();
    console.log('✅ Simple database initialized successfully');
    
    // Show current backup on startup (helpful for setting env var)
    setTimeout(() => backupToEnvironment(), 1000);
  }

  // User operations
  createUser({ id, username, email, passwordHash, isVerified = false, verifyToken, verifyTokenExpires, isAdmin = false }) {
    const users = this.readUsers();
    const now = new Date().toISOString();
    
    const user = {
      id,
      username,
      email: encrypt(email.toLowerCase()), // Encrypt email
      password_hash: passwordHash,
      is_verified: isVerified,
      verify_token: verifyToken,
      verify_token_expires: verifyTokenExpires,
      is_admin: isAdmin,
      created_at: now,
      updated_at: now
    };
    
    users.users.push(user);
    this.writeUsers(users);
    return user;
  }

  getUserById(id) {
    const users = this.readUsers();
    const user = users.users.find(u => u.id === id);
    if (user && user.email) {
      user.email = decrypt(user.email); // Decrypt email
    }
    return user;
  }

  getUserByUsername(username) {
    const users = this.readUsers();
    const user = users.users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (user && user.email) {
      user.email = decrypt(user.email); // Decrypt email
    }
    return user;
  }

  getUserByEmail(email) {
    const users = this.readUsers();
    const encryptedEmail = encrypt(email.toLowerCase());
    const user = users.users.find(u => u.email === encryptedEmail);
    if (user && user.email) {
      user.email = decrypt(user.email); // Decrypt email
    }
    return user;
  }

  updateUser(id, updates) {
    const users = this.readUsers();
    const userIndex = users.users.findIndex(u => u.id === id);
    if (userIndex === -1) return null;
    
    const now = new Date().toISOString();
    const updateData = { ...updates };
    
    if (updateData.email) {
      updateData.email = encrypt(updateData.email.toLowerCase());
    }
    
    // Handle isAdmin -> is_admin conversion
    if (updateData.isAdmin !== undefined) {
      updateData.is_admin = updateData.isAdmin;
      delete updateData.isAdmin;
    }
    
    users.users[userIndex] = { 
      ...users.users[userIndex], 
      ...updateData, 
      updated_at: now 
    };
    
    this.writeUsers(users);
    return users.users[userIndex];
  }

  deleteUser(id) {
    const users = this.readUsers();
    users.users = users.users.filter(u => u.id !== id);
    this.writeUsers(users);
    return true;
  }

  getAllUsers(limit = 1000, offset = 0) {
    const users = this.readUsers();
    return users.users.slice(offset, offset + limit).map(user => {
      if (user.email) {
        user.email = decrypt(user.email);
      }
      return user;
    });
  }

  searchUsers(query = '', limit = 50) {
    const users = this.readUsers();
    let filtered = users.users;
    
    if (query) {
      filtered = users.users.filter(u => 
        u.username.toLowerCase().includes(query.toLowerCase())
      );
    }
    
    return filtered.slice(0, limit).map(user => {
      if (user.email) {
        user.email = decrypt(user.email);
      }
      return user;
    });
  }

  // Friend operations (simplified)
  getFriends(userId) {
    // Return empty array for now - can be implemented later
    return [];
  }

  getPendingFriendRequests(userId) {
    // Return empty array for now
    return [];
  }

  sendFriendRequest(userId, friendId) {
    // Simple implementation - can be enhanced
    return true;
  }

  acceptFriendRequest(userId, friendId) {
    // Simple implementation
    return true;
  }

  // Audit logging
  logAction(userId, action, details, ipAddress, userAgent) {
    try {
      const audit = this.readAudit();
      const log = {
        id: uuidv4(),
        user_id: userId,
        action,
        details: details ? encrypt(JSON.stringify(details)) : null,
        ip_address: ipAddress,
        user_agent: userAgent,
        timestamp: new Date().toISOString()
      };
      
      audit.logs.push(log);
      
      // Keep only last 1000 logs
      if (audit.logs.length > 1000) {
        audit.logs = audit.logs.slice(-1000);
      }
      
      this.writeAudit(audit);
    } catch (error) {
      console.error('Audit log error:', error);
    }
  }

  // Helper methods
  readUsers() {
    try {
      return fs.readJsonSync(usersFile);
    } catch (error) {
      console.error('Error reading users:', error);
      return { users: [] };
    }
  }

  writeUsers(data) {
    try {
      fs.writeJsonSync(usersFile, data, { spaces: 2 });
      // Create backup after writing user data
      backupToEnvironment();
      return true;
    } catch (error) {
      console.error('Error writing users:', error);
      return false;
    }
  }

  readAudit() {
    try {
      return fs.readJsonSync(auditFile);
    } catch (error) {
      return { logs: [] };
    }
  }

  writeAudit(data) {
    try {
      fs.writeJsonSync(auditFile, data, { spaces: 2 });
    } catch (error) {
      console.error('Error writing audit:', error);
    }
  }

  getStats() {
    const users = this.readUsers();
    return {
      users: users.users.length,
      admins: users.users.filter(u => u.is_admin).length,
      friendships: 0, // Simplified
      activeSessions: 0 // Simplified
    };
  }

  // Backup method
  async backup(backupPath) {
    try {
      const backupData = {
        users: this.readUsers(),
        messages: fs.readJsonSync(messagesFile),
        comments: fs.readJsonSync(commentsFile),
        audit: this.readAudit(),
        timestamp: new Date().toISOString()
      };
      
      fs.writeJsonSync(backupPath, backupData, { spaces: 2 });
      console.log(`✅ Backup created: ${backupPath}`);
      return backupPath;
    } catch (error) {
      console.error('Backup failed:', error);
      throw error;
    }
  }

  close() {
    // Nothing to close for file-based storage
    console.log('Simple database connection closed');
  }
}

// Export singleton instance
const dbManager = new SimpleDatabaseManager();

module.exports = {
  db: dbManager,
  encrypt,
  decrypt
};