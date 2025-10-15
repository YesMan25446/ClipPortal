// GitHub Pages compatible version - works without backend server
(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  
  // Detect if we're running on GitHub Pages or local server
  const isGitHubPages = window.location.hostname.includes('github.io') || window.location.hostname.includes('githubusercontent.com');
  const API_BASE = isGitHubPages ? null : (window.location.origin + '/api');
  
  // Sample data for GitHub Pages demo
  const DEMO_CLIPS = [
    {
      id: 'demo1',
      title: 'Epic Gaming Moment',
      description: 'An incredible gaming highlight that will blow your mind!',
      category: 'Gaming',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      thumbnail: '/images/video-placeholder.svg',
      duration: '1:23',
      rating: 4.5,
      ratingCount: 42,
      createdAt: new Date(Date.now() - 86400000).toISOString() // 1 day ago
    },
    {
      id: 'demo2', 
      title: 'Amazing Trick Shot',
      description: 'A perfect shot that defies physics!',
      category: 'Sports',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      thumbnail: '/images/video-placeholder.svg',
      duration: '0:45',
      rating: 4.8,
      ratingCount: 67,
      createdAt: new Date(Date.now() - 172800000).toISOString() // 2 days ago
    },
    {
      id: 'demo3',
      title: 'Funny Fail Compilation',
      description: 'Hilarious moments that will make you laugh!',
      category: 'Comedy',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 
      thumbnail: '/images/video-placeholder.svg',
      duration: '2:15',
      rating: 4.2,
      ratingCount: 89,
      createdAt: new Date(Date.now() - 259200000).toISOString() // 3 days ago
    }
  ];

  const DEMO_STATS = {
    totalClips: DEMO_CLIPS.length,
    totalRatings: DEMO_CLIPS.reduce((sum, clip) => sum + clip.ratingCount, 0),
    averageRating: (DEMO_CLIPS.reduce((sum, clip) => sum + clip.rating, 0) / DEMO_CLIPS.length).toFixed(1)
  };

  // Helper: API call with GitHub Pages fallback
  async function api(path, options = {}) {
    if (!API_BASE) {
      // GitHub Pages mode - return demo data
      console.log('GitHub Pages mode: Using demo data for', path);
      return handleDemoAPI(path, options);
    }
    
    try {
      const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...options });
      let data = null;
      try { data = await res.json(); } catch {}
      return { status: res.status, ok: res.ok, data };
    } catch (error) {
      console.warn('API call failed, falling back to demo mode:', error);
      return handleDemoAPI(path, options);
    }
  }

  // Handle demo API responses for GitHub Pages
  function handleDemoAPI(path, options) {
    return new Promise(resolve => {
      setTimeout(() => { // Simulate network delay
        if (path === '/clips') {
          resolve({
            status: 200,
            ok: true,
            data: { success: true, clips: DEMO_CLIPS, stats: DEMO_STATS }
          });
        } else if (path === '/auth/me') {
          resolve({
            status: 200,
            ok: true,
            data: { success: true, user: null }
          });
        } else if (path.startsWith('/clips/') && path.endsWith('/rate')) {
          // Demo rating - just return success
          resolve({
            status: 200,
            ok: true,
            data: { success: true, message: 'Demo mode - rating not saved' }
          });
        } else if (path === '/auth/register' || path === '/auth/login') {
          resolve({
            status: 200,
            ok: true,
            data: { success: false, error: 'Demo mode - authentication disabled on GitHub Pages' }
          });
        } else {
          resolve({
            status: 404,
            ok: false,
            data: { success: false, error: 'Demo mode - feature not available' }
          });
        }
      }, 300); // 300ms delay
    });
  }

  // Auth helpers
  let CURRENT_USER = null;
  async function getCurrentUser(force = false) {
    if (CURRENT_USER && !force) return CURRENT_USER;
    const { data } = await api('/auth/me');
    CURRENT_USER = data?.user || null;
    return CURRENT_USER;
  }

  // Client identity for local storage
  function getClientId() {
    try {
      const key = 'clipportal_client_id';
      let id = localStorage.getItem(key);
      if (!id) {
        if (window.crypto && window.crypto.randomUUID) {
          id = window.crypto.randomUUID();
        } else {
          id = 'cid-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        }
        localStorage.setItem(key, id);
      }
      return id;
    } catch (_) {
      return 'cid-fallback';
    }
  }
  const CLIENT_ID = getClientId();

  function hasRated(clipId) {
    try {
      const store = JSON.parse(localStorage.getItem('ratedClips') || '{}');
      return !!store[clipId];
    } catch (_) { return false; }
  }

  function markRated(clipId) {
    try {
      const store = JSON.parse(localStorage.getItem('ratedClips') || '{}');
      store[clipId] = true;
      localStorage.setItem('ratedClips', JSON.stringify(store));
    } catch (_) {}
  }
  
  // Common elements
  const year = $('#year');
  if (year) year.textContent = new Date().getFullYear();

  // Show demo notice for GitHub Pages
  function showDemoNotice() {
    if (isGitHubPages) {
      const notice = document.createElement('div');
      notice.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; 
        background: #ff6b6b; color: white; padding: 8px; 
        text-align: center; z-index: 9999; font-size: 14px;
      `;
      notice.innerHTML = `
        📍 Demo Mode: This is a static preview on GitHub Pages. 
        <a href="#" onclick="this.parentElement.style.display='none'" style="color: white; margin-left: 10px;">✕ Close</a>
      `;
      document.body.prepend(notice);
    }
  }

  // Update nav visibility based on auth
  async function updateNavAuth() {
    const me = await getCurrentUser(true);
    const adminLink = document.querySelector('a[href="admin.html"]');
    if (adminLink) adminLink.style.display = (me && me.isAdmin) ? '' : 'none';
  }

  // Landing page functionality
  function initLandingPage() {
    const clipsGrid = $('#clipsGrid');
    const categoryFilter = $('#categoryFilter');
    const sortBy = $('#sortBy');
    const refreshBtn = $('#refreshBtn');
    const loadMoreBtn = $('#loadMoreBtn');
    const videoModal = $('#videoModal');
    const modalVideo = $('#modalVideo');
    const modalTitle = $('#modalTitle');
    const modalDescription = $('#modalDescription');
    const closeModal = $('.close');

    let clips = [];
    let currentPage = 1;
    const clipsPerPage = 8;

    // Load clips from API or demo data
    async function loadClips() {
      try {
        const category = categoryFilter ? categoryFilter.value : '';
        const sort = sortBy ? sortBy.value : 'newest';
        
        const response = await api(`/clips?category=${encodeURIComponent(category)}&sortBy=${sort}`);
        
        if (response.data?.success) {
          clips = response.data.clips;
          updateStats(response.data.stats);
          renderClips(clips);
        } else {
          console.error('Failed to load clips:', response.data?.error);
          showError('Failed to load clips. Using demo data.');
          // Fallback to demo data
          clips = DEMO_CLIPS;
          updateStats(DEMO_STATS);
          renderClips(clips);
        }
      } catch (error) {
        console.error('Error loading clips:', error);
        showError('Network error. Loading demo clips.');
        clips = DEMO_CLIPS;
        updateStats(DEMO_STATS);
        renderClips(clips);
      }
    }

    // Update stats display
    function updateStats(stats) {
      const totalClips = $('#totalClips');
      const totalRatings = $('#totalRatings');
      const avgRating = $('#avgRating');
      
      if (totalClips) totalClips.textContent = stats.totalClips || 0;
      if (totalRatings) totalRatings.textContent = stats.totalRatings || 0;
      if (avgRating) avgRating.textContent = stats.averageRating || '0.0';
    }

    // Render clips
    function renderClips(clipsToRender) {
      if (!clipsGrid) return;
      
      if (clipsToRender.length === 0) {
        clipsGrid.innerHTML = `
          <div style="grid-column: 1/-1; text-align: center; padding: 40px;">
            <h3>No clips available</h3>
            <p>Be the first to submit a clip!</p>
            <a href="submit.html" class="btn primary">Submit Clip</a>
          </div>
        `;
        return;
      }
      
      clipsGrid.innerHTML = clipsToRender.map(clip => {
        const disabledClass = hasRated(clip.id) ? 'disabled' : '';
        return `
        <div class="clip-card" data-category="${clip.category}" data-id="${clip.id}">
          <div class="clip-thumbnail" onclick="openVideoModal('${clip.id}')">
            <div class="play-button" aria-label="Play">
              <svg class="play-icon" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5v14l11-7z"></path>
              </svg>
            </div>
            <img src="${clip.thumbnail || '/images/video-placeholder.svg'}" alt="${escapeHtml(clip.title)}" onerror="this.onerror=null;this.src='/images/video-placeholder.svg';" />
            <div class="clip-duration">${clip.duration || '0:00'}</div>
          </div>
          <div class="clip-info">
            <h3 class="clip-title">${escapeHtml(clip.title)}</h3>
            <p class="clip-description">${escapeHtml(clip.description || 'No description provided')}</p>
            <div class="clip-meta">
              <span class="clip-category">${escapeHtml(clip.category)}</span>
              <span class="clip-date">${formatDate(clip.createdAt)}</span>
            </div>
            <div class="rating-section">
              <div class="rating-stars ${disabledClass}" data-clip-id="${clip.id}">
                ${[1,2,3,4,5].map(i => `<span class="star ${i <= Math.round(clip.rating) ? 'active' : ''}" data-rating="${i}">★</span>`).join('')}
              </div>
              <span class="rating-count">(${clip.ratingCount} ratings)</span>
              <span class="average-rating">${(clip.rating || 0).toFixed(1)}</span>
            </div>
          </div>
        </div>`;
      }).join('');
    }

    // Rate a clip
    async function rateClip(clipId, rating) {
      try {
        if (isGitHubPages) {
          showInfo('Demo mode: Ratings are stored locally only');
          markRated(clipId);
          
          // Update display locally
          const clipCard = $(`.clip-card[data-id="${clipId}"]`);
          if (clipCard) {
            const ratingStars = clipCard.querySelector('.rating-stars');
            if (ratingStars) {
              ratingStars.classList.add('disabled');
            }
          }
          return;
        }

        const { status, data } = await api(`/clips/${clipId}/rate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating })
        });
        
        if (status === 401) {
          showInfo('Please log in to rate clips. Redirecting to Account...');
          setTimeout(() => window.location.href = 'account.html', 800);
          return;
        }

        if (data?.success) {
          markRated(clipId);
          showSuccess(`Thanks for rating! You gave this clip ${rating} stars.`);
          // Reload clips to get updated data
          loadClips();
        } else {
          showError(data?.error || 'Failed to submit rating');
        }
      } catch (error) {
        console.error('Error rating clip:', error);
        showError('Network error. Please try again.');
      }
    }

    // Open video modal
    window.openVideoModal = function(clipId) {
      const clip = clips.find(c => c.id === clipId);
      if (!clip) return;

      if (videoModal && modalVideo && modalTitle && modalDescription) {
        modalVideo.src = clip.url || '';
        modalTitle.textContent = clip.title;
        modalDescription.textContent = clip.description || 'No description provided';

        videoModal.style.display = 'block';
        document.body.classList.add('modal-open');
      }
    };

    // Event listeners
    if (categoryFilter) categoryFilter.addEventListener('change', loadClips);
    if (sortBy) sortBy.addEventListener('change', loadClips);
    if (refreshBtn) refreshBtn.addEventListener('click', loadClips);
    
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        showInfo('Load more functionality would be implemented with pagination');
      });
    }

    // Rating stars event delegation
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('star')) {
        const container = e.target.closest('.rating-stars');
        const clipId = container?.dataset.clipId;
        if (!clipId) return;
        if (container.classList.contains('disabled') || hasRated(clipId)) {
          showInfo('You have already rated this clip.');
          return;
        }
        const rating = parseInt(e.target.dataset.rating);
        rateClip(clipId, rating);
      }
    });

    // Modal functionality
    if (closeModal) {
      closeModal.addEventListener('click', () => {
        if (videoModal) {
          videoModal.style.display = 'none';
          modalVideo.pause();
          document.body.classList.remove('modal-open');
        }
      });
    }

    if (videoModal) {
      videoModal.addEventListener('click', (e) => {
        if (e.target === videoModal) {
          videoModal.style.display = 'none';
          modalVideo.pause();
          document.body.classList.remove('modal-open');
        }
      });
    }

    // Initialize
    loadClips();
  }

  // Submission form functionality 
  function initSubmissionForm() {
    const form = $('#clipForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      if (isGitHubPages) {
        showError('Demo mode: Clip submission is not available on GitHub Pages. Please run the full application locally.');
        return;
      }
      
      showInfo('Submission requires a backend server. Please run the full application.');
    });
  }

  // Auth page functionality
  function initAuthPage() {
    const signupForm = document.getElementById('signupForm');
    const loginUserForm = document.getElementById('loginUserForm');
    
    if (signupForm) {
      signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (isGitHubPages) {
          showError('Demo mode: Account creation is not available on GitHub Pages.');
          return;
        }
        showInfo('Authentication requires a backend server.');
      });
    }

    if (loginUserForm) {
      loginUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (isGitHubPages) {
          showError('Demo mode: Login is not available on GitHub Pages.');
          return;
        }
        showInfo('Authentication requires a backend server.');
      });
    }
  }

  // Messages page functionality
  function initMessagesPage() {
    if (isGitHubPages) {
      const container = document.querySelector('.container');
      if (container) {
        container.innerHTML = `
          <div style="text-align: center; padding: 40px;">
            <h2>Messages</h2>
            <p>This feature requires a backend server and is not available in demo mode.</p>
            <a href="index.html" class="btn primary">Back to Home</a>
          </div>
        `;
      }
    }
  }

  // Admin page functionality
  function initAdminPage() {
    if (isGitHubPages) {
      const container = document.querySelector('.container');
      if (container) {
        container.innerHTML = `
          <div style="text-align: center; padding: 40px;">
            <h2>Admin Panel</h2>
            <p>Admin features require a backend server and are not available in demo mode.</p>
            <a href="index.html" class="btn primary">Back to Home</a>
          </div>
        `;
      }
    }
  }

  // Utility functions
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  }

  function showSuccess(message) {
    showNotification(message, 'success');
  }

  function showError(message) {
    showNotification(message, 'error');
  }

  function showInfo(message) {
    showNotification(message, 'info');
  }

  function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    Object.assign(notification.style, {
      position: 'fixed',
      top: isGitHubPages ? '40px' : '20px', // Account for demo banner
      right: '20px',
      padding: '12px 20px',
      borderRadius: '8px',
      color: 'white',
      fontWeight: '600',
      zIndex: '10000',
      maxWidth: '300px',
      wordWrap: 'break-word',
      opacity: '0',
      transform: 'translateX(100%)',
      transition: 'all 0.3s ease'
    });

    const colors = {
      success: '#4ecdc4',
      error: '#ff6b6b',
      info: '#6ea1ff'
    };
    notification.style.backgroundColor = colors[type] || colors.info;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.opacity = '1';
      notification.style.transform = 'translateX(0)';
    }, 100);

    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transform = 'translateX(100%)';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 4000);
  }

  // Initialize based on current page
  document.addEventListener('DOMContentLoaded', () => {
    showDemoNotice();
    updateNavAuth();

    if (window.location.pathname.includes('submit.html') || window.location.pathname.endsWith('submit.html')) {
      initSubmissionForm();
    } else if (window.location.pathname.includes('admin.html') || window.location.pathname.endsWith('admin.html')) {
      initAdminPage();
    } else if (window.location.pathname.includes('account.html') || window.location.pathname.endsWith('account.html')) {
      initAuthPage();
    } else if (window.location.pathname.includes('messages.html') || window.location.pathname.endsWith('messages.html')) {
      initMessagesPage();
    } else {
      initLandingPage();
    }
  });
})();