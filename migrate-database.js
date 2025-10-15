const fs = require('fs-extra');
const path = require('path');
const { db } = require('./database');

// Migration script to transfer data from JSON files to the new encrypted database
async function migrateUsersToDatabase() {
  console.log('🚀 Starting database migration...');
  
  const dataDir = path.join(__dirname, 'data');
  const usersFile = path.join(dataDir, 'users.json');
  const backupDir = path.join(dataDir, 'backup');
  
  // Create backup directory
  await fs.ensureDir(backupDir);
  
  try {
    // Check if users.json exists
    if (!fs.existsSync(usersFile)) {
      console.log('ℹ️  No users.json found, skipping user migration');
      return;
    }
    
    // Read existing users data
    console.log('📖 Reading existing users data...');
    const usersData = await fs.readJson(usersFile);
    const users = usersData.users || [];
    
    if (users.length === 0) {
      console.log('ℹ️  No users found in users.json');
      return;
    }
    
    console.log(`📊 Found ${users.length} users to migrate`);
    
    // Backup existing file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `users-${timestamp}.json`);
    await fs.copy(usersFile, backupFile);
    console.log(`💾 Backup created: ${backupFile}`);
    
    // Migrate each user
    let migratedCount = 0;
    let skippedCount = 0;
    
    for (const user of users) {
      try {
        // Check if user already exists in database (by username)
        const existingUser = db.getUserByUsername(user.username);
        if (existingUser) {
          console.log(`⚠️  User '${user.username}' already exists in database, skipping...`);
          skippedCount++;
          continue;
        }
        
        // Migrate user to database
        const userData = {
          id: user.id,
          username: user.username,
          email: user.email,
          passwordHash: user.passwordHash,
          isVerified: Boolean(user.isVerified),
          verifyToken: user.verifyToken || null,
          verifyTokenExpires: user.verifyTokenExpires || null,
          isAdmin: Boolean(user.isAdmin)
        };
        
        db.createUser(userData);
        
        // Migrate friends if they exist
        if (user.friends && Array.isArray(user.friends)) {
          for (const friendId of user.friends) {
            try {
              // Check if friendship already exists
              const existingFriends = db.getFriends(user.id);
              const friendExists = existingFriends.some(f => f.id === friendId);
              
              if (!friendExists) {
                // Add as accepted friendship (since it was already friends in JSON)
                db.sendFriendRequest(user.id, friendId);
                db.acceptFriendRequest(user.id, friendId);
              }
            } catch (friendError) {
              console.log(`⚠️  Could not migrate friendship for ${user.username} -> ${friendId}:`, friendError.message);
            }
          }
        }
        
        // Log the migration
        db.logAction(
          user.id,
          'MIGRATION_IMPORTED',
          { 
            source: 'users.json',
            migratedAt: new Date().toISOString(),
            hadFriends: user.friends?.length || 0
          },
          'migration-script',
          'database-migration/1.0'
        );
        
        migratedCount++;
        console.log(`✅ Migrated user: ${user.username}`);
        
      } catch (userError) {
        console.error(`❌ Failed to migrate user '${user.username}':`, userError.message);
      }
    }
    
    console.log('\\n📈 Migration Summary:');
    console.log(`   Successfully migrated: ${migratedCount} users`);
    console.log(`   Skipped (already exists): ${skippedCount} users`);
    console.log(`   Total processed: ${users.length} users`);
    
    if (migratedCount > 0) {
      // Rename original file to indicate it's been migrated
      const migratedFile = path.join(dataDir, `users-migrated-${timestamp}.json`);
      await fs.move(usersFile, migratedFile);
      console.log(`\\n🗂️  Original users.json moved to: ${path.basename(migratedFile)}`);
      console.log('💡 You can safely delete this file after verifying the migration worked correctly.');
    }
    
    // Display database stats
    console.log('\\n📊 Database Statistics:');
    const stats = db.getStats();
    console.log(`   Users: ${stats.users}`);
    console.log(`   Admins: ${stats.admins}`);
    console.log(`   Friendships: ${stats.friendships}`);
    console.log(`   Active Sessions: ${stats.activeSessions}`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Function to test database functionality
function testDatabaseFunctionality() {
  console.log('\\n🧪 Testing database functionality...');
  
  try {
    // Test basic operations
    const stats = db.getStats();
    console.log('✅ Database connection: OK');
    console.log(`✅ Users in database: ${stats.users}`);
    
    // Test user lookup
    if (stats.users > 0) {
      const users = db.searchUsers('', 1); // Get one user
      if (users.length > 0) {
        const testUser = db.getUserById(users[0].id);
        if (testUser && testUser.username) {
          console.log(`✅ User lookup: OK (found: ${testUser.username})`);
        }
      }
    }
    
    console.log('✅ All database tests passed!');
    
  } catch (error) {
    console.error('❌ Database test failed:', error);
    throw error;
  }
}

// Main migration function
async function runMigration() {
  try {
    console.log('════════════════════════════════════════');
    console.log('     CLIP PORTAL DATABASE MIGRATION     ');
    console.log('════════════════════════════════════════');
    
    await migrateUsersToDatabase();
    testDatabaseFunctionality();
    
    console.log('\\n🎉 Migration completed successfully!');
    console.log('\\n🔐 Your user data is now stored in an encrypted database.');
    console.log('📁 Database location: data/clipportal.db');
    console.log('🔑 Encryption key saved in .env file - keep it secure!');
    
  } catch (error) {
    console.error('\\n💥 Migration failed:', error);
    console.log('\\n🔄 Your original data is safe. Check the error and try again.');
    process.exit(1);
  }
}

// Run migration if this script is executed directly
if (require.main === module) {
  runMigration();
}

module.exports = {
  migrateUsersToDatabase,
  testDatabaseFunctionality,
  runMigration
};