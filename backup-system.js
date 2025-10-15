const { db } = require('./database-simple');
const path = require('path');
const fs = require('fs-extra');
const cron = require('node-cron');

// Backup configuration
const BACKUP_DIR = path.join(__dirname, 'data', 'backups');
const MAX_BACKUPS = 30; // Keep last 30 backups
const BACKUP_SCHEDULE = '0 2 * * *'; // Daily at 2 AM

// Ensure backup directory exists
fs.ensureDirSync(BACKUP_DIR);

class BackupSystem {
  constructor() {
    this.isRunning = false;
  }

  // Create a backup with timestamp
  async createBackup(description = 'scheduled') {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFileName = `clipportal-backup-${timestamp}.db`;
      const backupPath = path.join(BACKUP_DIR, backupFileName);
      
      console.log(`🔄 Creating database backup: ${backupFileName}`);
      
      await db.backup(backupPath);
      
      // Create metadata file
      const metadataPath = path.join(BACKUP_DIR, `${backupFileName}.meta.json`);
      const metadata = {
        filename: backupFileName,
        created_at: new Date().toISOString(),
        description: description,
        stats: db.getStats(),
        size_bytes: (await fs.stat(backupPath)).size
      };
      
      await fs.writeJson(metadataPath, metadata, { spaces: 2 });
      
      console.log(`✅ Backup created successfully: ${backupPath}`);
      console.log(`📊 Backup stats: ${metadata.stats.users} users, ${metadata.stats.friendships} friendships`);
      
      // Clean up old backups
      await this.cleanupOldBackups();
      
      return { success: true, filename: backupFileName, path: backupPath, metadata };
      
    } catch (error) {
      console.error('❌ Backup creation failed:', error);
      throw error;
    }
  }

  // List all available backups
  async listBackups() {
    try {
      const files = await fs.readdir(BACKUP_DIR);
      const backupFiles = files.filter(f => f.endsWith('.db'));
      
      const backups = [];
      for (const file of backupFiles) {
        const metaFile = path.join(BACKUP_DIR, `${file}.meta.json`);
        let metadata = null;
        
        try {
          if (await fs.pathExists(metaFile)) {
            metadata = await fs.readJson(metaFile);
          }
        } catch (e) {
          // Ignore metadata read errors
        }
        
        const filePath = path.join(BACKUP_DIR, file);
        const stats = await fs.stat(filePath);
        
        backups.push({
          filename: file,
          path: filePath,
          size: stats.size,
          created: stats.mtime,
          metadata: metadata
        });
      }
      
      // Sort by creation time, newest first
      backups.sort((a, b) => b.created - a.created);
      
      return backups;
      
    } catch (error) {
      console.error('❌ Failed to list backups:', error);
      throw error;
    }
  }

  // Restore database from backup
  async restoreFromBackup(backupFilename) {
    try {
      const backupPath = path.join(BACKUP_DIR, backupFilename);
      
      if (!(await fs.pathExists(backupPath))) {
        throw new Error(`Backup file not found: ${backupFilename}`);
      }
      
      console.log(`🔄 Restoring database from backup: ${backupFilename}`);
      
      // Create a backup of current database before restoring
      await this.createBackup('pre-restore');
      
      // Close current database connection
      db.close();
      
      // Copy backup file to main database location
      const currentDbPath = path.join(__dirname, 'data', 'clipportal.db');
      await fs.copy(backupPath, currentDbPath);
      
      console.log(`✅ Database restored from backup: ${backupFilename}`);
      console.log('⚠️  Application needs to be restarted to use the restored database');
      
      return { success: true, message: 'Database restored successfully. Please restart the application.' };
      
    } catch (error) {
      console.error('❌ Database restore failed:', error);
      throw error;
    }
  }

  // Clean up old backups (keep only MAX_BACKUPS most recent)
  async cleanupOldBackups() {
    try {
      const backups = await this.listBackups();
      
      if (backups.length > MAX_BACKUPS) {
        const toDelete = backups.slice(MAX_BACKUPS);
        
        console.log(`🧹 Cleaning up ${toDelete.length} old backups (keeping ${MAX_BACKUPS} most recent)`);
        
        for (const backup of toDelete) {
          await fs.remove(backup.path);
          
          // Also remove metadata file
          const metaPath = `${backup.path}.meta.json`;
          if (await fs.pathExists(metaPath)) {
            await fs.remove(metaPath);
          }
          
          console.log(`🗑️  Deleted old backup: ${backup.filename}`);
        }
      }
    } catch (error) {
      console.error('❌ Backup cleanup failed:', error);
      // Don't throw - cleanup failures shouldn't stop backup creation
    }
  }

  // Start automated backup scheduler
  startScheduledBackups() {
    if (this.isRunning) {
      console.log('⚠️  Backup scheduler is already running');
      return;
    }

    console.log(`⏰ Starting automated backup scheduler: ${BACKUP_SCHEDULE}`);
    
    this.scheduledTask = cron.schedule(BACKUP_SCHEDULE, async () => {
      try {
        await this.createBackup('scheduled');
      } catch (error) {
        console.error('❌ Scheduled backup failed:', error);
      }
    }, {
      scheduled: true,
      timezone: "America/New_York"
    });

    this.isRunning = true;
    console.log('✅ Automated backup scheduler started');
  }

  // Stop automated backup scheduler
  stopScheduledBackups() {
    if (this.scheduledTask) {
      this.scheduledTask.stop();
      this.scheduledTask = null;
    }
    this.isRunning = false;
    console.log('🛑 Automated backup scheduler stopped');
  }

  // Get backup system status
  getStatus() {
    return {
      isRunning: this.isRunning,
      schedule: BACKUP_SCHEDULE,
      backupDir: BACKUP_DIR,
      maxBackups: MAX_BACKUPS,
      nextRun: this.scheduledTask ? this.scheduledTask.getStatus() : null
    };
  }

  // Export database data as JSON (for additional backup format)
  async exportDatabaseAsJson() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const exportPath = path.join(BACKUP_DIR, `database-export-${timestamp}.json`);
      
      // Export all tables
      const exportData = {
        exported_at: new Date().toISOString(),
        version: '1.0',
        stats: db.getStats(),
        users: db.searchUsers('', 10000), // Get all users
        // Note: Not exporting sensitive session data or audit logs for security
      };
      
      await fs.writeJson(exportPath, exportData, { spaces: 2 });
      
      console.log(`✅ Database exported as JSON: ${exportPath}`);
      return { success: true, path: exportPath, data: exportData };
      
    } catch (error) {
      console.error('❌ JSON export failed:', error);
      throw error;
    }
  }
}

// Create singleton instance
const backupSystem = new BackupSystem();

// Manual backup function for immediate use
async function createManualBackup(description = 'manual') {
  return await backupSystem.createBackup(description);
}

// Export for use in other modules
module.exports = {
  backupSystem,
  createManualBackup,
  BackupSystem
};

// Command line usage
if (require.main === module) {
  const command = process.argv[2];
  
  (async () => {
    try {
      switch (command) {
        case 'create':
          const description = process.argv[3] || 'manual';
          await backupSystem.createBackup(description);
          break;
          
        case 'list':
          const backups = await backupSystem.listBackups();
          console.log('📋 Available backups:');
          backups.forEach(b => {
            console.log(`  - ${b.filename} (${(b.size / 1024 / 1024).toFixed(2)} MB) - ${b.created}`);
          });
          break;
          
        case 'restore':
          const filename = process.argv[3];
          if (!filename) {
            console.error('❌ Please specify backup filename to restore');
            process.exit(1);
          }
          await backupSystem.restoreFromBackup(filename);
          break;
          
        case 'export':
          await backupSystem.exportDatabaseAsJson();
          break;
          
        case 'start':
          backupSystem.startScheduledBackups();
          console.log('🎯 Scheduled backups started. Press Ctrl+C to stop.');
          // Keep process alive
          setInterval(() => {}, 60000);
          break;
          
        default:
          console.log('📖 Usage:');
          console.log('  node backup-system.js create [description]');
          console.log('  node backup-system.js list');
          console.log('  node backup-system.js restore <filename>');
          console.log('  node backup-system.js export');
          console.log('  node backup-system.js start');
          break;
      }
    } catch (error) {
      console.error('❌ Command failed:', error);
      process.exit(1);
    }
  })();
}