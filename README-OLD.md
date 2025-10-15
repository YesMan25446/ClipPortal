# Clip Portal

A community platform for sharing and rating gaming clips. Users can submit their best gaming moments and rate clips from other community members.

## Features

- **Watch & Rate Clips**: Browse clips by category, sort by different criteria, and rate content
- **Submit Clips**: Upload video files or share links from YouTube/Twitch
- **Automatic Thumbnails**: Generates thumbnails from first frame of uploaded videos
- **Real-time Statistics**: View total clips, ratings, and average ratings
- **Responsive Design**: Works on desktop, tablet, and mobile devices
- **File Upload**: Support for video file uploads up to 100MB

## Tech Stack

### Frontend
- HTML5, CSS3, JavaScript (Vanilla)
- Responsive design with CSS Grid and Flexbox
- Modern UI with gradients and animations

### Backend
- Node.js with Express.js
- Multer for file uploads
- JSON file storage (easily upgradeable to database)
- RESTful API design

## Quick Start

### Prerequisites
- Node.js (version 14 or higher)
- npm or yarn
- FFmpeg (for thumbnail generation from video files)

### Installation

1. **Clone or download the project**
   ```bash
   cd clip-submission-site
   ```

2. **Install FFmpeg**
   
   **Windows:**
   - Download from https://ffmpeg.org/download.html
   - Extract and add to your system PATH
   - Or use chocolatey: `choco install ffmpeg`
   
   **macOS:**
   ```bash
   brew install ffmpeg
   ```
   
   **Linux (Ubuntu/Debian):**
   ```bash
   sudo apt update
   sudo apt install ffmpeg
   ```

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Start the server**
   ```bash
   npm start
   ```
   
   For development with auto-restart:
   ```bash
   npm run dev
   ```

5. **Open your browser**
   Navigate to `http://localhost:3000`

## Project Structure

```
clip-submission-site/
├── index.html          # Landing page (watch clips)
├── submit.html         # Submit clips page
├── about.html          # About page
├── styles.css          # Main stylesheet
├── script.js           # Frontend JavaScript
├── server.js           # Express server
├── package.json        # Dependencies and scripts
├── data/
│   └── clips.json      # Data storage (auto-created)
├── uploads/            # Uploaded files (auto-created)
└── thumbnails/         # Generated thumbnails (auto-created)
```

## API Endpoints

### Clips
- `GET /api/clips` - Get all clips (with optional filtering and sorting)
- `GET /api/clips/:id` - Get a specific clip
- `POST /api/clips` - Submit a new clip
- `POST /api/clips/:id/rate` - Rate a clip (1-5 stars)

### Statistics
- `GET /api/stats` - Get site statistics

### File Serving
- `GET /uploads/:filename` - Serve uploaded files

## Usage

### Submitting Clips
1. Navigate to the Submit page
2. Fill in the title (required)
3. Either provide a video URL or upload a file
4. Select a category and add a description
5. Click "Submit Clip"

### Watching and Rating
1. Browse clips on the main page
2. Use filters to find specific categories
3. Sort by newest, oldest, rating, or popularity
4. Click on a clip thumbnail to watch it
5. Rate clips by clicking the stars

## Configuration

### Environment Variables
- `PORT` - Server port (default: 3000)

### File Upload Limits
- Maximum file size: 100MB
- Allowed file types: Video files only
- Upload directory: `./uploads/`

## Development

### Adding New Features
1. Backend changes go in `server.js`
2. Frontend changes go in `script.js` and `styles.css`
3. New pages should follow the existing HTML structure

### Data Storage
Currently uses JSON file storage in `data/clips.json`. For production, consider upgrading to:
- SQLite (simple)
- PostgreSQL (robust)
- MongoDB (document-based)

### Security Considerations
For production deployment:
- Add authentication/authorization
- Implement rate limiting
- Add input validation and sanitization
- Use HTTPS
- Implement proper file type validation
- Add virus scanning for uploads

## Deployment

### Local Development
```bash
npm run dev
```

### Production
```bash
npm start
```

### Environment Setup
1. Set `NODE_ENV=production`
2. Configure proper file permissions for uploads directory
3. Set up reverse proxy (nginx) if needed
4. Configure SSL certificates

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - feel free to use this project for your own purposes.

## Support

For issues or questions:
1. Check the browser console for errors
2. Verify the server is running
3. Check file permissions for uploads directory
4. Ensure all dependencies are installed

## Future Enhancements

- User authentication and profiles
- Comments system
- Advanced video processing (thumbnails, compression)
- Real-time notifications
- Search functionality
- Social sharing
- Admin panel
- Database integration
- Video streaming optimization

## Security Best Practices

- Sensitive files (`.env`, `data/*.json`, uploads, thumbnails) are excluded from git in `.gitignore`.
- User emails (in `users.json`) are now AES-256 encrypted at rest. The encryption key is stored in `EMAIL_ENC_KEY` in your environment settings.
- **Never commit your live database files or environment secrets to a public repo.** Always keep `.env` (containing SMTP, JWT, admin passwords, encryption key, etc.) private.
- Passwords use bcrypt hashing by default (never plain text).

### Email Encryption
- Emails are encrypted on registration/save and automatically decrypted only for authentication or admin functions.
- To rotate keys, set a new value for `EMAIL_ENC_KEY` and re-run the encryption logic if needed.