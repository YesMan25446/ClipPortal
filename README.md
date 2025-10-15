# ClipPortal 🎮

A modern video clip sharing platform where users can upload, rate, and discover amazing gaming moments and highlights. Features both a **full-featured server application** and a **GitHub Pages demo**.

🌐 **Live Demo**: [GitHub Pages](https://yesman25446.github.io/ClipPortal/)

## 🚀 Two Deployment Options

### 📱 GitHub Pages (Demo Mode)
- **Static preview** with demo content
- Works without a backend server
- Perfect for showcasing the UI/UX
- Limited functionality (no real authentication, submissions, or database)
- **URL**: https://yesman25446.github.io/ClipPortal/

### 🖥️ Full Application (Local/Server)
- **Complete functionality** with encrypted database
- User authentication and account management
- Clip submission and rating system
- Admin panel and content moderation
- Automated database backups
- Real-time features

## ✨ Features

### Core Features
- **Video Upload**: Direct file uploads (up to 100MB, 30 seconds max)
- **URL Submissions**: Support for YouTube, Twitch, and other platforms
- **5-Star Rating System**: Community-driven content rating
- **Categories**: Gaming, Sports, Comedy, Music, and Other
- **Responsive Design**: Mobile and desktop optimized
- **Real-time Stats**: Live metrics and analytics

### Full Application Features
- **🔐 Encrypted Database**: AES-256-GCM encryption for sensitive data
- **👥 User Authentication**: Secure JWT-based login system
- **📧 Email Verification**: Account security with email confirmation
- **👑 Admin Panel**: Content moderation and user management
- **👫 Friends System**: Social connections and messaging
- **💬 Comments**: Community engagement on clips
- **🔄 Auto Backups**: Daily encrypted database backups
- **📊 Audit Logging**: Security tracking and user action logs

## 🛠️ Technologies Used

### Frontend
- **HTML5, CSS3, JavaScript (ES6+)**
- **Responsive design** with mobile-first approach
- **Progressive enhancement** for GitHub Pages compatibility

### Backend (Full Application)
- **Node.js & Express.js** - Server framework
- **SQLite with better-sqlite3** - High-performance database
- **AES-256-GCM Encryption** - Data protection
- **bcrypt** - Password hashing
- **JWT** - Secure authentication
- **FFmpeg** - Video processing and thumbnails
- **Multer** - File upload handling
- **Nodemailer** - Email verification
- **node-cron** - Automated backup scheduling

## 🚀 Quick Start

### Option 1: View Demo (No Setup Required)
Visit: https://yesman25446.github.io/ClipPortal/

### Option 2: Run Full Application

#### Prerequisites
- **Node.js** (v14 or higher)
- **npm** (comes with Node.js)

#### Installation
```bash
# Clone the repository
git clone https://github.com/YesMan25446/ClipPortal.git
cd ClipPortal

# Install dependencies
npm install

# Run database migration (if you have existing data)
node migrate-database.js

# Start the server
node server.js
```

#### Access the Application
- **Local**: http://localhost:3000
- **Network**: http://YOUR_LOCAL_IP:3000

## ⚙️ Configuration

### Environment Variables
The application automatically creates a `.env` file with encryption keys:

```env
# Database encryption key - KEEP SECRET!
DB_ENCRYPTION_KEY=your-auto-generated-key

# Server Configuration
PORT=3000
JWT_SECRET=your-jwt-secret

# Admin Configuration
ADMIN_PASSWORD=your-admin-password

# Email Configuration (Optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=ClipPortal <noreply@clipportal.com>

# Site Configuration
SITE_BASE_URL=http://localhost:3000
```

## 🗄️ Database & Security

### Encrypted Database
- **SQLite** with **better-sqlite3** for performance
- **AES-256-GCM encryption** for sensitive fields
- **Foreign key constraints** for data integrity
- **Indexed queries** for optimal performance

### Security Features
- **End-to-end encryption** for sensitive data
- **bcrypt password hashing** with salt
- **JWT authentication** with httpOnly cookies
- **Session management** with IP/user-agent tracking
- **Audit logging** for all user actions
- **Rate limiting** and input validation
- **XSS and injection protection**

### Backup System
```bash
# Create manual backup
node backup-system.js create "my-backup"

# List all backups
node backup-system.js list

# Restore from backup
node backup-system.js restore <filename>

# Export as JSON
node backup-system.js export

# Start automated backups
node backup-system.js start
```

## 📡 API Endpoints

### Public Endpoints
```
GET  /api/clips              # Get all approved clips
GET  /api/clips/:id          # Get specific clip
GET  /api/stats              # Get site statistics
POST /api/clips              # Submit new clip
```

### Authentication
```
POST /api/auth/register      # Register new user
POST /api/auth/login         # Login user
POST /api/auth/logout        # Logout user
GET  /api/auth/me            # Get current user info
GET  /api/auth/verify        # Verify email address
```

### User Features (Authenticated)
```
POST /api/clips/:id/rate     # Rate a clip
GET  /api/friends            # Get friends list
POST /api/friends/request/:id # Send friend request
POST /api/friends/accept/:id  # Accept friend request
GET  /api/messages/with/:id   # Get conversation
POST /api/messages/:id        # Send message
```

### Admin Endpoints
```
POST   /api/admin/clips/:id/approve # Approve pending clip
DELETE /api/clips/:id              # Delete clip
GET    /api/admin/users            # Get all users
POST   /api/admin/users/:id/make-admin # Make user admin
DELETE /api/admin/users/:id         # Delete user
```

## 📁 Project Structure

```
ClipPortal/
├── 🔧 Server Files
│   ├── server.js              # Main application server
│   ├── database.js            # Encrypted database manager
│   ├── migrate-database.js    # Database migration script
│   └── backup-system.js       # Automated backup system
│
├── 🌐 Frontend Files
│   ├── index.html            # Homepage
│   ├── submit.html           # Clip submission
│   ├── admin.html            # Admin panel
│   ├── account.html          # Login/register
│   ├── messages.html         # User messages
│   ├── about.html            # About page
│   ├── styles.css            # Main stylesheet
│   ├── script.js             # Full app JavaScript
│   └── script-static.js      # GitHub Pages compatible
│
├── 📊 Data & Storage
│   ├── data/
│   │   ├── clipportal.db     # Encrypted SQLite database
│   │   ├── backups/          # Automatic database backups
│   │   └── *.json            # Legacy JSON files (migrated)
│   ├── uploads/              # User uploaded videos
│   └── thumbnails/           # Generated thumbnails
│
├── 🎨 Assets
│   └── images/               # Static images and placeholders
│
└── 📋 Configuration
    ├── package.json          # Dependencies and scripts
    ├── .env                  # Environment variables (auto-created)
    └── README.md            # This file
```

## 🔧 Development

### Running in Development Mode
```bash
# Start with auto-restart
npm run dev

# Or run directly
node server.js
```

### Database Management
```bash
# Migrate existing JSON data
node migrate-database.js

# Create backup
node backup-system.js create

# View database stats
node -e "console.log(require('./database').db.getStats())"
```

## 🚀 Deployment

### GitHub Pages (Demo)
Automatically deployed when you push to the `main` branch.

### Full Application Deployment

#### Using PM2 (Recommended)
```bash
npm install -g pm2
pm2 start server.js --name "clip-portal"
pm2 save
pm2 startup
```

#### Using Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

#### Nginx Reverse Proxy
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 🔒 Security Best Practices

### For Production
1. **Change default admin password**
2. **Use strong JWT secret**
3. **Configure HTTPS**
4. **Set up firewall rules**
5. **Regular database backups**
6. **Monitor audit logs**
7. **Keep dependencies updated**

### Database Security
- **Encryption key** stored securely in `.env`
- **Passwords** never stored in plain text
- **Session tokens** expire after 30 days
- **Audit trail** for all user actions
- **IP tracking** for security monitoring

## 🐛 Troubleshooting

### Common Issues

1. **GitHub Pages shows "Network Error"**
   - This is normal - GitHub Pages can't run the server
   - The demo mode will automatically activate

2. **Database migration fails**
   ```bash
   # Reset and try again
   rm data/clipportal.db
   node migrate-database.js
   ```

3. **Backup system issues**
   ```bash
   # Check backup status
   node backup-system.js list
   ```

4. **Permission errors on Linux/Mac**
   ```bash
   chmod +x migrate-database.js
   chmod +x backup-system.js
   ```

## 📈 Performance

- **SQLite WAL mode** for concurrent access
- **Prepared statements** for query optimization
- **Automatic indexing** for fast lookups
- **FFmpeg optimization** for video processing
- **Lazy loading** for large datasets
- **Efficient backup compression**

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature-name`
3. Make changes and test locally
4. Commit: `git commit -am 'Add feature'`
5. Push: `git push origin feature-name`
6. Create Pull Request

## 📋 Roadmap

### Phase 1 (Current) ✅
- [x] Encrypted database system
- [x] Automated backup system
- [x] GitHub Pages compatibility
- [x] User authentication
- [x] Admin panel

### Phase 2 (Planned)
- [ ] Real-time notifications
- [ ] Advanced video processing
- [ ] Cloud storage integration (AWS S3)
- [ ] Mobile app (React Native)
- [ ] Advanced analytics dashboard
- [ ] AI content moderation

### Phase 3 (Future)
- [ ] Live streaming support
- [ ] Multi-language support
- [ ] Advanced social features
- [ ] Plugin system
- [ ] White-label solutions

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 💬 Support

- **Issues**: [GitHub Issues](https://github.com/YesMan25446/ClipPortal/issues)
- **Discussions**: [GitHub Discussions](https://github.com/YesMan25446/ClipPortal/discussions)
- **Wiki**: [Project Wiki](https://github.com/YesMan25446/ClipPortal/wiki)

---

**Made with ❤️ for the gaming community**

🌟 **Star this repo** if you find it useful!

📧 **Questions?** Open an issue or start a discussion!