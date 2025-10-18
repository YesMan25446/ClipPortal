// Enhanced client-side behavior with backend API integration
(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  
  // API configuration
  const API_BASE = window.location.origin + '/api';

  // Helper: JSON fetch with credentials
  async function api(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...options });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, ok: res.ok, data };
  }

  // Auth helpers
  let CURRENT_USER = null;
  async function getCurrentUser(force = false) {
    if (CURRENT_USER && !force) return CURRENT_USER;
    const { data } = await api('/auth/me');
    CURRENT_USER = data?.user || null;
    return CURRENT_USER;
  }

  // Client identity (legacy fallback, no longer used for rating; rating requires login)
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
      // Fallback if storage unavailable
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

  // Update nav visibility based on auth
  // Previous counts for toasts
  let __prevIncoming = null;
  let __prevUnreadMsgs = null;
  let __prevPendingClips = null;

  // Soft notification sounds (Web Audio, very low volume)
  const SOUND_KEY = 'cp_sound_enabled';
  function isSoundEnabled() {
    try { return localStorage.getItem(SOUND_KEY) !== '0'; } catch (_) { return true; }
  }
  function setSoundEnabled(v) {
    try { localStorage.setItem(SOUND_KEY, v ? '1' : '0'); } catch (_) {}
  }
  let __audioCtx = null;
  function ensureAudio() {
    if (!isSoundEnabled()) return null;
    try {
      if (!__audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        __audioCtx = new Ctx();
      }
      if (__audioCtx.state === 'suspended') __audioCtx.resume();
      return __audioCtx;
    } catch (_) { return null; }
  }
  function beep({ frequency = 660, duration = 120, volume = 0.15, type = 'sine' } = {}) {
    if (!isSoundEnabled()) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = frequency;
    g.gain.value = volume;
    o.connect(g).connect(ctx.destination);
    const now = ctx.currentTime;
    o.start(now);
    o.stop(now + duration / 1000);
  }
  function playNotification(kind) {
    if (!isSoundEnabled()) return;
    // keep sounds subtle
    switch (kind) {
      case 'message':
        beep({ frequency: 900, duration: 90, volume: 0.14 });
        setTimeout(() => beep({ frequency: 700, duration: 90, volume: 0.14 }), 120);
        break;
      case 'friend':
        beep({ frequency: 600, duration: 120, volume: 0.13 });
        break;
      case 'admin':
        beep({ frequency: 520, duration: 90, volume: 0.13 });
        setTimeout(() => beep({ frequency: 740, duration: 90, volume: 0.13 }), 110);
        break;
      default:
        beep();
    }
  }
  // Prime/resume audio context on first user interaction
  ['click','keydown','touchstart'].forEach(evt => {
    window.addEventListener(evt, () => { try { ensureAudio(); } catch (_) {} }, { once: true });
  });

  async function updateNavAuth() {
    const me = await getCurrentUser(true);
    const adminLink = document.querySelector('a[href="admin.html"]');
    if (adminLink) adminLink.style.display = (me && me.isAdmin) ? '' : 'none';

    // Messages link badges (friend requests + unread messages)
    const msgLink = document.querySelector('a[href="messages.html"]');
    if (msgLink) {
      // Friend request badge
      let frBadge = msgLink.querySelector('#navIncomingBadge');
      const incoming = Number(me?.incomingRequests || 0);
      if (incoming > 0) {
        if (!frBadge) {
          frBadge = document.createElement('span');
          frBadge.id = 'navIncomingBadge';
          frBadge.className = 'badge';
          frBadge.style.marginLeft = '6px';
          frBadge.style.background = '#ff6b6b';
          frBadge.style.color = '#fff';
          frBadge.style.padding = '2px 6px';
          frBadge.style.borderRadius = '10px';
          frBadge.style.fontSize = '12px';
          msgLink.appendChild(frBadge);
        }
        frBadge.textContent = String(incoming);
        frBadge.style.display = '';
      } else if (frBadge) {
        frBadge.style.display = 'none';
      }

      // Unread messages badge
      let msgBadge = msgLink.querySelector('#navMsgBadge');
      try {
        const { data: unreadRes } = await api('/messages/unread-count');
        const unread = Number(unreadRes?.unread || 0);
        if (unread > 0) {
          if (!msgBadge) {
            msgBadge = document.createElement('span');
            msgBadge.id = 'navMsgBadge';
            msgBadge.className = 'badge';
            msgBadge.style.marginLeft = '6px';
            msgBadge.style.background = '#6ea1ff';
            msgBadge.style.color = '#fff';
            msgBadge.style.padding = '2px 6px';
            msgBadge.style.borderRadius = '10px';
            msgBadge.style.fontSize = '12px';
            msgLink.appendChild(msgBadge);
          }
          msgBadge.textContent = String(unread);
          msgBadge.style.display = '';
        } else if (msgBadge) {
          msgBadge.style.display = 'none';
        }

        // Toasts when counts increase
        if (__prevUnreadMsgs === null && unread > 0) {
          // First check and there are already unread messages
          showInfo('You have unread messages');
        } else if (__prevUnreadMsgs !== null && unread > __prevUnreadMsgs) {
          showInfo(`New message${unread-__prevUnreadMsgs>1?'s':''} received`);
          playNotification('message');
        }
        __prevUnreadMsgs = unread;
      } catch (_) {}

      if (__prevIncoming !== null && incoming > __prevIncoming) {
        showInfo('New friend request received');
        playNotification('friend');
      }
      __prevIncoming = incoming;
    }

    // Admin pending clips badge on Admin link
    if (me && me.isAdmin) {
      const a = document.querySelector('a[href="admin.html"]');
      if (a) {
        let aBadge = a.querySelector('#navAdminBadge');
        try {
          const { data: pend } = await api('/api/admin/pending-count');
          const pending = Number(pend?.pending || 0);
          if (pending > 0) {
            if (!aBadge) {
              aBadge = document.createElement('span');
              aBadge.id = 'navAdminBadge';
              aBadge.className = 'badge';
              aBadge.style.marginLeft = '6px';
              aBadge.style.background = '#ffbf47';
              aBadge.style.color = '#000';
              aBadge.style.padding = '2px 6px';
              aBadge.style.borderRadius = '10px';
              aBadge.style.fontSize = '12px';
              a.appendChild(aBadge);
            }
            aBadge.textContent = String(pending);
            aBadge.style.display = '';
          } else if (aBadge) {
            aBadge.style.display = 'none';
          }
          if (__prevPendingClips !== null && pending > __prevPendingClips) {
            showInfo('New clip submitted (pending approval)');
            playNotification('admin');
          }
          __prevPendingClips = pending;
        } catch (_) {}
      }
    }
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

    // Load clips from API
    async function loadClips() {
      try {
        const category = categoryFilter ? categoryFilter.value : '';
        const sort = sortBy ? sortBy.value : 'newest';
        
        const response = await fetch(`${API_BASE}/clips?category=${encodeURIComponent(category)}&sortBy=${sort}`);
        const data = await response.json();
        
        if (data.success) {
          clips = data.clips;
          updateStats(data.stats);
          renderClips(clips);
        } else {
          console.error('Failed to load clips:', data.error);
          showError('Failed to load clips. Please try again.');
        }
      } catch (error) {
        console.error('Error loading clips:', error);
        showError('Network error. Please check your connection.');
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
            <img src="${clip.thumbnail || '/images/video-placeholder.svg'}" alt="${clip.title}" onerror="this.onerror=null;this.src='/images/video-placeholder.svg';" />
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
              <span class="average-rating">${clip.rating.toFixed(1)}</span>
            </div>
          </div>
        </div>`;
      }).join('');
    }

    // Rate a clip
    async function rateClip(clipId, rating) {
      try {
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
          // Update the clip in our local array
          const clipIndex = clips.findIndex(c => c.id === clipId);
          if (clipIndex !== -1) {
            clips[clipIndex] = data.clip;
          }
          
          // Update the display
          const clipCard = $(`.clip-card[data-id="${clipId}"]`);
          if (clipCard) {
            const ratingStars = clipCard.querySelector('.rating-stars');
            const ratingCount = clipCard.querySelector('.rating-count');
            const averageRating = clipCard.querySelector('.average-rating');
            
            if (ratingStars) {
              ratingStars.classList.add('disabled');
              ratingStars.innerHTML = [1,2,3,4,5].map(i => 
                `<span class="star ${i <= Math.round(data.clip.rating) ? 'active' : ''}" data-rating="${i}">★</span>`
              ).join('');
            }
            if (ratingCount) ratingCount.textContent = `(${data.clip.ratingCount} ratings)`;
            if (averageRating) averageRating.textContent = data.clip.rating.toFixed(1);
          }

          // Update modal if open
          if (videoModal && videoModal.style.display === 'block') {
            const modalStars = videoModal.querySelector('.rating-stars');
            const modalCount = videoModal.querySelector('.rating-count');
            const modalAvg = videoModal.querySelector('.average-rating');
            if (modalStars) {
              modalStars.classList.add('disabled');
              modalStars.innerHTML = [1,2,3,4,5].map(i => 
                `<span class="star ${i <= Math.round(data.clip.rating) ? 'active' : ''}" data-rating="${i}">★</span>`
              ).join('');
            }
            if (modalCount) modalCount.textContent = `(${data.clip.ratingCount} ratings)`;
            if (modalAvg) modalAvg.textContent = data.clip.rating.toFixed(1);
          }
          
          showSuccess(`Thanks for rating! You gave this clip ${rating} stars.`);
        } else {
          showError(data.error || 'Failed to submit rating');
        }
      } catch (error) {
        console.error('Error rating clip:', error);
        showError('Network error. Please try again.');
      }
    }

    // Open video modal
    window.openVideoModal = async function(clipId) {
      try {
        const response = await fetch(`${API_BASE}/clips/${clipId}`, { headers: { 'X-Client-Id': CLIENT_ID }});
        const data = await response.json();
        
        if (data.success && videoModal && modalVideo && modalTitle && modalDescription) {
          const clip = data.clip;
          // Mark which clip is currently open in the modal
          videoModal.dataset.openClipId = clip.id;

          modalVideo.src = clip.url || clip.filePath;
          modalTitle.textContent = clip.title;
          modalDescription.textContent = clip.description || 'No description provided';

          // Configure modal rating block
          const modalStars = videoModal.querySelector('.rating-stars');
          const disabledClass = (clip.userHasRated || hasRated(clip.id)) ? 'disabled' : '';
          if (modalStars) {
            modalStars.dataset.clipId = clip.id;
            modalStars.className = `rating-stars ${disabledClass}`;
            modalStars.innerHTML = [1,2,3,4,5].map(i => 
              `<span class="star ${i <= Math.round(clip.rating) ? 'active' : ''}" data-rating="${i}">★</span>`
            ).join('');
          }

          // Also show current rating in modal header
          const modalInfo = videoModal.querySelector('.video-info .modal-rating');
          if (modalInfo) {
            // Ensure rating count and avg elements exist
            let count = videoModal.querySelector('.video-info .rating-count');
            let avg = videoModal.querySelector('.video-info .average-rating');
            if (!count) {
              count = document.createElement('span');
              count.className = 'rating-count';
              modalInfo.appendChild(count);
            }
            if (!avg) {
              avg = document.createElement('span');
              avg.className = 'average-rating';
              modalInfo.appendChild(avg);
            }
            count.textContent = `(${clip.ratingCount} ratings)`;
            avg.textContent = (clip.rating ?? 0).toFixed(1);
          }

          // Comments setup
          const commentsList = document.getElementById('commentsList');
          const commentComposer = document.getElementById('commentComposer');
          const commentLoginPrompt = document.getElementById('commentLoginPrompt');
          const sendCommentBtn = document.getElementById('sendCommentBtn');
          const commentText = document.getElementById('commentText');

          async function loadComments() {
            const { data } = await api(`/clips/${clip.id}/comments`);
            // If the modal switched to another clip while we were fetching, ignore this result
            if (!videoModal || videoModal.dataset.openClipId !== clip.id) return;
            if (data?.success && commentsList) {
              commentsList.innerHTML = data.comments.map(c => `
                <div style="margin:6px 0;">
                  <strong>${escapeHtml(c.username)}</strong>
                  <span class="muted" style="font-size:0.8rem;"> - ${new Date(c.createdAt).toLocaleString()}</span>
                  <div>${escapeHtml(c.text)}</div>
                </div>
              `).join('');
              commentsList.scrollTop = commentsList.scrollHeight;
            }
          }

          const me = await getCurrentUser(true);
          if (me) {
            if (commentComposer) commentComposer.style.display = '';
            if (commentLoginPrompt) commentLoginPrompt.style.display = 'none';
          } else {
            if (commentComposer) commentComposer.style.display = 'none';
            if (commentLoginPrompt) commentLoginPrompt.style.display = '';
          }

          if (sendCommentBtn) sendCommentBtn.onclick = async () => {
            // Ensure we're still on this clip
            if (!videoModal || videoModal.dataset.openClipId !== clip.id) return;
            const text = commentText.value.trim();
            if (!text) return;
            const { data } = await api(`/clips/${clip.id}/comments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text })
            });
            if (data?.success) {
              commentText.value = '';
              await loadComments();
            } else if (data?.error) {
              showError(data.error);
            }
          };

          await loadComments();

          videoModal.style.display = 'block';
          document.body.classList.add('modal-open');
        } else {
          showError('Failed to load video');
        }
      } catch (error) {
        console.error('Error loading video:', error);
        showError('Network error. Please try again.');
      }
    };

    // Event listeners
    if (categoryFilter) {
      categoryFilter.addEventListener('change', loadClips);
    }
    
    if (sortBy) {
      sortBy.addEventListener('change', loadClips);
    }
    
    if (refreshBtn) {
      refreshBtn.addEventListener('click', loadClips);
    }
    
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        // In a real app, this would implement pagination
        showInfo('Load more functionality would be implemented with pagination');
      });
    }

    // Rating stars event delegation
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('star')) {
        const container = e.target.closest('.rating-stars');
        const clipId = container?.dataset.clipId;
        if (!clipId) return; // not wired
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
          if (videoModal) delete videoModal.dataset.openClipId;
        }
      });
    }

    // Close modal when clicking outside
    if (videoModal) {
      videoModal.addEventListener('click', (e) => {
        if (e.target === videoModal) {
          videoModal.style.display = 'none';
          modalVideo.pause();
          document.body.classList.remove('modal-open');
          if (videoModal) delete videoModal.dataset.openClipId;
        }
      });
    }

    // Initialize
    loadClips();
  }

  // Submission form functionality
  function initSubmissionForm() {
    const form = $('#clipForm');
    const title = $('#title');
    const url = $('#url');
    const file = $('#file');
    const recentClips = $('#recentClips');

    if (!form) return;

    // Load recent submissions
    async function loadRecentSubmissions() {
      if (!recentClips) return;
      
      try {
        const response = await fetch(`${API_BASE}/clips?sortBy=newest&limit=3`);
        const data = await response.json();
        
        if (data.success && data.clips.length > 0) {
          recentClips.innerHTML = data.clips.map(clip => `
            <div class="recent-clip">
              <div class="recent-thumbnail">
<img src="${clip.thumbnail || '/images/video-placeholder.svg'}" alt="${escapeHtml(clip.title)}" onerror="this.onerror=null;this.src='/images/video-placeholder.svg';" />
              </div>
              <div class="recent-info">
                <h4>${escapeHtml(clip.title)}</h4>
                <span class="recent-category">${escapeHtml(clip.category)}</span>
                <span class="recent-time">${formatDate(clip.createdAt)}</span>
              </div>
            </div>
          `).join('');
        } else {
          recentClips.innerHTML = '<p class="no-recent">No recent submissions yet. Be the first!</p>';
        }
      } catch (error) {
        console.error('Error loading recent submissions:', error);
        recentClips.innerHTML = '<p class="no-recent">Failed to load recent submissions.</p>';
      }
    }

    // Load recent submissions on page load
    loadRecentSubmissions();

    function setError(input, msg) {
      const small = document.querySelector(`small.error[data-for="${input.id}"]`);
      if (small) small.textContent = msg || '';
    }

    function validURL(value) {
      if (!value) return true; // optional
      try {
        const u = new URL(value);
        return !!u.protocol && !!u.host;
      } catch (_) {
        return false;
      }
    }

    async function getFileDurationSeconds(f) {
      return new Promise((resolve, reject) => {
        try {
          const v = document.createElement('video');
          v.preload = 'metadata';
          v.src = URL.createObjectURL(f);
          v.onloadedmetadata = () => {
            const d = v.duration;
            URL.revokeObjectURL(v.src);
            resolve(isFinite(d) ? d : 0);
          };
          v.onerror = () => {
            try { URL.revokeObjectURL(v.src); } catch (_) {}
            resolve(0);
          };
        } catch (e) { resolve(0); }
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      let ok = true;

      // Reset errors
      ['title','url','file','description'].forEach(id => setError({ id }, ''));

      if (!title.value.trim()) {
        setError(title, 'Title is required.');
        ok = false;
      }

      if (url.value && !validURL(url.value)) {
        setError(url, 'Please enter a valid URL.');
        ok = false;
      }

      if (!url.value && !file.files?.length) {
        setError(file, 'Provide a URL or upload a file.');
        ok = false;
      }

      // Client-side duration check for uploaded file (30s max)
      if (file.files?.length) {
        const dur = await getFileDurationSeconds(file.files[0]);
        if (dur > 30.05) {
          setError(file, 'Clip must be 30 seconds or less.');
          showError('Maximum clip length is 30 seconds.');
          return;
        }
      }

      if (!ok) return;

      // Show loading state
      const submitBtn = form.querySelector('button[type="submit"]');
      const originalText = submitBtn.textContent;
      submitBtn.textContent = 'Submitting...';
      submitBtn.disabled = true;

      try {
        const formData = new FormData(form);
        
        const response = await fetch(`${API_BASE}/clips`, {
          method: 'POST',
          body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
          showSuccess('Clip submitted! It will appear after an admin approves it.');
          form.reset();
          loadRecentSubmissions(); // Refresh recent submissions
        } else {
          showError(data.error || 'Failed to submit clip');
        }
      } catch (error) {
        console.error('Error submitting clip:', error);
        showError('Network error. Please try again.');
      } finally {
        // Reset button state
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
      }
    });
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
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    // Style the notification
    Object.assign(notification.style, {
      position: 'fixed',
      top: '20px',
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

    // Set background color based on type
    const colors = {
      success: '#4ecdc4',
      error: '#ff6b6b',
      info: '#6ea1ff'
    };
    notification.style.backgroundColor = colors[type] || colors.info;

    // Add to page
    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => {
      notification.style.opacity = '1';
      notification.style.transform = 'translateX(0)';
    }, 100);

    // Remove after 4 seconds
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

  // Auth page functionality
  function initAuthPage() {
    const signupForm = document.getElementById('signupForm');
    const signupSection = document.getElementById('signupSection');
    const loginUserForm = document.getElementById('loginUserForm');
    const loginSection = document.getElementById('loginSection');
    const userInfoSection = document.getElementById('userInfoSection');
    const magicLinkForm = document.getElementById('magicLinkForm');
    const logoutButton = document.getElementById('logoutButton');
    const resendVerifyBtn = document.getElementById('resendVerifyBtn');
    const currentUsername = document.getElementById('currentUsername');
    const accountStatus = document.getElementById('accountStatus');
    // Social inputs
    const inputSteam = document.getElementById('inputSteam');
    const inputTwitter = document.getElementById('inputTwitter');
    const inputYouTube = document.getElementById('inputYouTube');
    const inputOther = document.getElementById('inputOther');
    const saveSocialLinksBtn = document.getElementById('saveSocialLinksBtn');

    // Update UI based on authentication state
    async function updateAuthUI() {
      const me = await getCurrentUser(true);
      
      if (me) {
        // User is logged in - show user info, hide login/signup
        if (signupSection) signupSection.style.display = 'none';
        if (loginSection) loginSection.style.display = 'none';
        if (userInfoSection) userInfoSection.style.display = 'block';
        
        // Update user info
        if (currentUsername) currentUsername.textContent = me.username;
        if (accountStatus) {
          const verifiedText = me.isVerified ? '✓ Verified' : '⚠ Not Verified';
          const adminText = me.isAdmin ? ' (Admin)' : '';
          accountStatus.innerHTML = `${verifiedText}${adminText}`;
        }
        // Populate social inputs
        const social = (me.profile && me.profile.social) || {};
        if (inputSteam) inputSteam.value = social.steam || '';
        if (inputTwitter) inputTwitter.value = social.twitter || '';
        if (inputYouTube) inputYouTube.value = social.youtube || '';
        if (inputOther) inputOther.value = social.other || '';
      } else {
        // User is not logged in - show login/signup, hide user info
        if (signupSection) signupSection.style.display = 'block';
        if (loginSection) loginSection.style.display = 'block';
        if (userInfoSection) userInfoSection.style.display = 'none';
      }
    }

    // Call on page load
    updateAuthUI();

    if (signupForm) {
      signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('su_username').value.trim();
        const email = document.getElementById('su_email').value.trim();
        const password = document.getElementById('su_password').value;
        const { data } = await api('/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, email, password })
        });
        if (data?.success) {
          showSuccess('Account created! Check your email for a magic link to verify and sign in.');
          signupForm.reset();
        } else {
          showError(data?.error || 'Sign up failed');
        }
      });
    }

    if (loginUserForm) {
      loginUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('li_username').value.trim();
        const password = document.getElementById('li_password').value;
        const { data } = await api('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        if (data?.success) {
          CURRENT_USER = data.user;
          showSuccess('Logged in!');
          updateAuthUI();
        } else {
          if (data?.needsVerification) {
            showError('Please verify your email before logging in.');
          } else {
            showError(data?.error || 'Login failed');
          }
        }
      });
    }

    // Magic link form
    if (magicLinkForm) {
      magicLinkForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('magic_email').value.trim();
        const { data } = await api('/auth/request-magic-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, redirectTo: '/account.html' })
        });
        if (data?.success) {
          showSuccess(data.message);
          magicLinkForm.reset();
        } else {
          showError(data?.error || 'Failed to send magic link');
        }
      });
    }

    if (logoutButton) {
      logoutButton.addEventListener('click', async () => {
        await api('/auth/logout', { method: 'POST' });
        CURRENT_USER = null;
        showInfo('Logged out');
        updateAuthUI();
      });
    }

    if (resendVerifyBtn) {
      resendVerifyBtn.addEventListener('click', async () => {
        const username = document.getElementById('li_username').value.trim();
        const { data } = await api('/auth/resend-verification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usernameOrEmail: username })
        });
        if (data?.success) showSuccess('Verification magic link sent.');
        else showError(data?.error || 'Could not send verification magic link');
      });
    }

    // Save social links
    if (saveSocialLinksBtn) {
      saveSocialLinksBtn.addEventListener('click', async () => {
        const payload = {
          social: {
            steam: (inputSteam?.value || '').trim(),
            twitter: (inputTwitter?.value || '').trim(),
            youtube: (inputYouTube?.value || '').trim(),
            other: (inputOther?.value || '').trim()
          }
        };
        const { data } = await api('/me/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (data?.success) {
          showSuccess('Social links saved');
          getCurrentUser(true); // refresh cache
        } else {
          showError(data?.error || 'Failed to save social links');
        }
      });
    }

    // Preferences: sound alerts toggle
    const soundToggle = document.getElementById('soundToggle');
    if (soundToggle) {
      try { soundToggle.checked = isSoundEnabled(); } catch (_) {}
      soundToggle.addEventListener('change', () => {
        setSoundEnabled(!!soundToggle.checked);
        showInfo(soundToggle.checked ? 'Sound alerts enabled' : 'Sound alerts disabled');
        // if enabling, ensure audio is ready on next interaction
      });
    }
  }

  // Profile page functionality
  function initProfilePage() {
    const params = new URLSearchParams(window.location.search);
    const usernameParam = params.get('u');
    const header = document.getElementById('profileHeader');

    function normalizeSocial(kind, value) {
      const v = (value || '').trim();
      if (!v) return '';
      const isUrl = /^https?:\/\//i.test(v);
      if (isUrl) return v;
      switch (kind) {
        case 'twitter':
          return `https://twitter.com/${v.replace(/^@+/, '')}`;
        case 'steam': {
          const digitsOnly = /^[0-9]+$/.test(v);
          return digitsOnly ? `https://steamcommunity.com/profiles/${v}` : `https://steamcommunity.com/id/${v}`;
        }
        case 'youtube': {
          if (/^(UC|HC)[A-Za-z0-9_-]+$/.test(v)) return `https://youtube.com/channel/${v}`;
          if (/^@/.test(v)) return `https://youtube.com/${v}`;
          return `https://youtube.com/@${v}`;
        }
        default:
          return `https://${v}`;
      }
    }

    function socialsHtml(profile) {
      const s = (profile && profile.social) || {};
      const entries = [
        s.steam ? { k: 'steam', href: normalizeSocial('steam', s.steam), label: 'Steam' } : null,
        s.twitter ? { k: 'twitter', href: normalizeSocial('twitter', s.twitter), label: 'Twitter' } : null,
        s.youtube ? { k: 'youtube', href: normalizeSocial('youtube', s.youtube), label: 'YouTube' } : null,
        s.other ? { k: 'other', href: normalizeSocial('other', s.other), label: 'Link' } : null
      ].filter(Boolean);
      if (!entries.length) return '';
      const aStyle = 'display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#fff;text-decoration:none;background:rgba(255,255,255,0.06)';
      const wrapStyle = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;';
      return `<div class="profile-socials" style="${wrapStyle}">` + entries.map(e => `<a href="${e.href}" target="_blank" rel="noopener" style="${aStyle}">${e.label}</a>`).join('') + `</div>`;
    }
    const clipsGrid = document.getElementById('profileClips');
    const editForm = document.getElementById('profileEditForm');
    const displayNameInput = document.getElementById('pf_displayName');
    const bioInput = document.getElementById('pf_bio');
    const colorInput = document.getElementById('pf_themeColor');
    const avatarInput = document.getElementById('pf_avatar');
    const bannerInput = document.getElementById('pf_banner');
    const saveBtn = document.getElementById('pf_save');

    async function load() {
      try {
        let res;
        let me = null;
        if (usernameParam) {
          res = await api(`/profile/${encodeURIComponent(usernameParam)}`);
          me = await getCurrentUser();
        } else {
          const my = await api('/me/profile');
          res = my;
          me = res.data?.user || null;
        }
        const data = res.data;
        if (!data?.success) { showError(data?.error || 'Failed to load profile'); return; }
        const user = data.user;
        const clips = data.clips || [];

        // Render header
        if (header) {
          const p = user.profile || {};
          header.innerHTML = `
            <div class="profile-banner" style="${p.banner ? `background-image:url('${p.banner}')` : `background:${p.themeColor || '#222'}`}"></div>
            <div class="profile-row">
              <div class="profile-avatar" style="${p.avatar ? `background-image:url('${p.avatar}')` : ''}"></div>
              <div class="profile-meta">
                <h2>${escapeHtml(p.displayName || user.username)}</h2>
                <div class="muted">@${escapeHtml(user.username)}</div>
                ${p.bio ? `<p class="profile-bio">${escapeHtml(p.bio)}</p>` : ''}
                ${socialsHtml(p)}
              </div>
            </div>`;
        }

        // Render clips
        if (clipsGrid) {
          clipsGrid.innerHTML = clips.map(clip => `
            <div class="clip-card" data-id="${clip.id}">
              <div class="clip-thumbnail" onclick="openVideoModal('${clip.id}')">
                <div class="play-button"><svg class="play-icon" width="22" height="22" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg></div>
                <img src="${clip.thumbnail || '/images/video-placeholder.svg'}" alt="${escapeHtml(clip.title)}" onerror="this.onerror=null;this.src='/images/video-placeholder.svg';" />
                <div class="clip-duration">${clip.duration || '0:00'}</div>
              </div>
              <div class="clip-info">
                <h3 class="clip-title">${escapeHtml(clip.title)}</h3>
                <div class="clip-meta">
                  <span class="clip-category">${escapeHtml(clip.category || 'Other')}</span>
                  <span class="clip-date">${formatDate(clip.createdAt)}</span>
                </div>
              </div>
            </div>`).join('');
        }

        // Show edit UI only if it's my profile (no username param)
        if (!usernameParam && editForm) {
          const p = (data.user && data.user.profile) || {};
          if (displayNameInput) displayNameInput.value = p.displayName || data.user.username || '';
          if (bioInput) bioInput.value = p.bio || '';
          if (colorInput) colorInput.value = p.themeColor || '#6ea1ff';
          editForm.style.display = '';
        } else if (editForm) {
          editForm.style.display = 'none';
        }
      } catch (e) {
        showError('Failed to load profile');
      }
    }

    if (saveBtn && editForm) {
      editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const displayName = displayNameInput.value.trim();
        const bio = bioInput.value.trim();
        const themeColor = colorInput.value;
        const { data } = await api('/me/profile', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName, bio, themeColor })
        });
        if (data?.success) { showSuccess('Profile updated'); load(); }
        else { showError(data?.error || 'Failed to update'); }
      });
    }

    if (avatarInput) {
      avatarInput.addEventListener('change', async () => {
        if (!avatarInput.files?.length) return;
        const fd = new FormData();
        fd.append('avatar', avatarInput.files[0]);
        const res = await fetch(`${API_BASE}/me/profile/avatar`, { method: 'POST', body: fd, credentials: 'include' });
        const data = await res.json();
        if (data?.success) { showSuccess('Avatar updated'); load(); }
        else { showError(data?.error || 'Failed to upload avatar'); }
      });
    }

    if (bannerInput) {
      bannerInput.addEventListener('change', async () => {
        if (!bannerInput.files?.length) return;
        const fd = new FormData();
        fd.append('banner', bannerInput.files[0]);
        const res = await fetch(`${API_BASE}/me/profile/banner`, { method: 'POST', body: fd, credentials: 'include' });
        const data = await res.json();
        if (data?.success) { showSuccess('Banner updated'); load(); }
        else { showError(data?.error || 'Failed to upload banner'); }
      });
    }

    load();
  }

  // Messages page functionality
  function initMessagesPage() {
    const friendList = document.getElementById('friendList');
    const incomingList = document.getElementById('incomingRequests');
    const incomingSection = document.getElementById('incomingSection');
    const searchInput = document.getElementById('userSearch');
    const searchBtn = document.getElementById('searchBtn');
    const searchResults = document.getElementById('searchResults');
    const convo = document.getElementById('conversation');
    const convoHeader = document.getElementById('conversationHeader');
    const convoTitle = document.getElementById('conversationTitle');
    const messageInput = document.getElementById('messageInput');
    const sendMessageBtn = document.getElementById('sendMessageBtn');

    let activeFriend = null;
    let friendsCache = [];
    let esStarted = false;

    async function ensureAuth() {
      const user = await getCurrentUser(true);
      if (!user) {
        showInfo('Please log in to use messages. Redirecting...');
        setTimeout(() => window.location.href = 'account.html', 800);
        return false;
      }
      return true;
    }

    function renderFriends(friends) {
      if (!friendList) return;
      friendList.innerHTML = [
        ...friends.map(u => `
          <div class=\"recent-clip\">\r
            <div class=\"recent-info\">\r
              <h4>${escapeHtml(u.username)}</h4>\r
              <span class=\"recent-time\">Friend</span>\r
            </div>\r
            <div class=\"actions\">
              <a class=\"btn\" href=\"profile.html?u=${encodeURIComponent(u.username)}\">View Profile</a>
              <button class=\"btn\" data-open-chat=\"${u.id}\" style=\"margin-left:6px;\">Open Chat</button>
            </div>\r
          </div>`)
      ].join('');
    }

    function renderIncoming(list) {
      if (!incomingList || !incomingSection) return;
      if (!list || list.length === 0) {
        incomingSection.style.display = 'none';
        incomingList.innerHTML = '';
        return;
      }
      incomingSection.style.display = '';
      incomingList.innerHTML = list.map(u => `
        <div class="recent-clip">
          <div class="recent-info">
            <h4>${escapeHtml(u.username)}</h4>
            <span class="recent-time">Request</span>
          </div>
          <div class="actions">
            <a class="btn" href="profile.html?u=${encodeURIComponent(u.username)}">View Profile</a>
            <button class="btn primary" data-accept-request="${u.id}" style="margin-left:6px;">Accept</button>
            <button class="btn danger" data-decline-request="${u.id}" style="margin-left:6px;">Decline</button>
          </div>
        </div>
      `).join('');
    }

    async function loadFriends() {
      const ok = await ensureAuth(); if (!ok) return;
      const { data } = await api('/friends');
      if (data?.success) {
        friendsCache = data.friends || [];
        renderFriends(friendsCache);
        renderIncoming(data.incomingRequests);
        // Update nav badge
        CURRENT_USER = await getCurrentUser(true);
        // Keep title accurate if a chat is open
        if (activeFriend && convoTitle) {
          const u = friendsCache.find(f => f.id === activeFriend);
          convoTitle.textContent = u ? u.username : 'Conversation';
        }
        // Force badge refresh
        updateNavAuth();
      }
    }

    async function loadConversation(friendId) {
      const { data } = await api(`/messages/with/${friendId}?limit=100`);
      if (data?.success) {
        convo.innerHTML = data.messages.map(m => `
          <div style=\"margin:6px 0; ${m.senderId=== (CURRENT_USER && CURRENT_USER.id) ? 'text-align:right;' : ''}\">\r
            <span style=\"display:inline-block; background:${m.senderId=== (CURRENT_USER && CURRENT_USER.id) ? 'var(--accent)' : 'rgba(255,255,255,0.08)'}; color:white; padding:6px 10px; border-radius:12px;\">${escapeHtml(m.text)}</span>
          </div>`).join('');
        const u = friendsCache.find(f => f.id === friendId);
        if (convoTitle) convoTitle.textContent = u ? u.username : 'Conversation';
        if (convoHeader) convoHeader.textContent = '';
        convo.scrollTop = convo.scrollHeight;
      }
    }

    if (friendList) {
      friendList.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-open-chat]');
        if (btn) {
          activeFriend = btn.getAttribute('data-open-chat');
          await loadConversation(activeFriend);
          // Mark messages from this friend as read and refresh badges
          try { await api(`/messages/mark-read/${activeFriend}`, { method: 'POST' }); } catch (_) {}
          updateNavAuth();
        }
      });
    }

    if (incomingList) {
      incomingList.addEventListener('click', async (e) => {
        const acceptBtn = e.target.closest('button[data-accept-request]');
        const declineBtn = e.target.closest('button[data-decline-request]');
        if (acceptBtn) {
          const id = acceptBtn.getAttribute('data-accept-request');
          const { data } = await api(`/friends/accept/${id}`, { method: 'POST' });
          if (data?.success) { showSuccess('Friend request accepted'); loadFriends(); }
          else { showError(data?.error || 'Failed to accept'); }
        } else if (declineBtn) {
          const id = declineBtn.getAttribute('data-decline-request');
          const { data } = await api(`/friends/decline/${id}`, { method: 'POST' });
          if (data?.success) { showInfo('Request declined'); loadFriends(); }
          else { showError(data?.error || 'Failed to decline'); }
        }
      });
    }

    async function sendMessage() {
      const text = messageInput.value.trim();
      if (!text || !activeFriend) return;
      const { data } = await api(`/messages/${activeFriend}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      if (data?.success) {
        messageInput.value = '';
        // Conversation will also update via SSE; reload as fallback
        await loadConversation(activeFriend);
      }
    }
    if (sendMessageBtn) {
      sendMessageBtn.addEventListener('click', sendMessage);
    }
    if (messageInput) {
      messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
      });
    }

    if (searchBtn) {
      searchBtn.addEventListener('click', async () => {
        const q = searchInput.value.trim();
        const { data } = await api(`/users/search?q=${encodeURIComponent(q)}`);
        if (data?.success) {
          searchResults.innerHTML = data.users.map(u => `
            <div class="recent-clip">
              <div class="recent-info">
                <h4>${escapeHtml(u.username)}</h4>
              </div>
              <div class="actions">
                <a class="btn" href="profile.html?u=${encodeURIComponent(u.username)}">View Profile</a>
                <button class="btn" data-add-friend="${u.id}" style="margin-left:6px;">Add Friend</button>
              </div>
            </div>`).join('');
        }
      });

      searchResults?.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-add-friend]');
        if (btn) {
          const id = btn.getAttribute('data-add-friend');
          btn.disabled = true;
          btn.textContent = 'Sending...';
          const { data } = await api(`/friends/request/${id}`, { method: 'POST' });
          if (data?.success) {
            showSuccess('Friend request sent!');
            btn.textContent = 'Requested';
          } else {
            showError(data?.error || 'Failed to send request');
            btn.disabled = false;
            btn.textContent = 'Add Friend';
          }
          // Refresh nav badge periodically anyway (no effect for sender, but harmless)
          updateNavAuth();
        }
      });
    }

    async function startSse() {
      if (esStarted) return; esStarted = true;
      try {
        const es = new EventSource(`${API_BASE}/messages/stream`);
        es.onmessage = async (evt) => {
          try {
            const payload = JSON.parse(evt.data || '{}');
            const msg = payload.message;
            if (!msg) return;
            const me = await getCurrentUser();
            const otherId = msg.senderId === (me && me.id) ? msg.recipientId : msg.senderId;
            if (activeFriend && otherId === activeFriend) {
              // Append live to current conversation
              const html = `<div style=\"margin:6px 0; ${msg.senderId=== (me && me.id) ? 'text-align:right;' : ''}\"><span style=\"display:inline-block; background:${msg.senderId=== (me && me.id) ? 'var(--accent)' : 'rgba(255,255,255,0.08)'}; color:white; padding:6px 10px; border-radius:12px;\">${escapeHtml(msg.text)}</span></div>`;
              if (convo) {
                convo.insertAdjacentHTML('beforeend', html);
                convo.scrollTop = convo.scrollHeight;
              }
              // Mark as read if it's from the friend
              if (msg.senderId !== (me && me.id)) {
                try { await api(`/messages/mark-read/${otherId}`, { method: 'POST' }); } catch (_) {}
                updateNavAuth();
              }
            } else {
              // Not the open chat => update badges and optionally ping
              updateNavAuth();
              playNotification('message');
            }
          } catch (_) {}
        };
        window.addEventListener('beforeunload', () => { try { es.close(); } catch (_) {} });
      } catch (_) { /* ignore */ }
    }

    loadFriends();
    startSse();

    // Auto-refresh friends and requests every 20s
    if (!window.__friendsPoll) {
      window.__friendsPoll = setInterval(() => {
        loadFriends();
      }, 20000);
      window.addEventListener('beforeunload', () => {
        try { clearInterval(window.__friendsPoll); } catch (_) {}
        window.__friendsPoll = null;
      });
    }
  }

  // Friend Requests page functionality
  function initRequestsPage() {
    const incomingList = document.getElementById('incomingRequestsOnly');
    const info = document.getElementById('requestsInfo');

    async function load() {
      const { data } = await api('/friends');
      if (data?.success) {
        const list = data.incomingRequests || [];
        if (!list.length) {
          if (incomingList) incomingList.innerHTML = '<p class="muted">No friend requests.</p>';
          return;
        }
        if (incomingList) incomingList.innerHTML = list.map(u => `
          <div class="recent-clip">
            <div class="recent-info">
              <h4>${escapeHtml(u.username)}</h4>
            </div>
            <div class="actions">
              <a class="btn" href="profile.html?u=${encodeURIComponent(u.username)}">View Profile</a>
              <button class="btn primary" data-accept-request="${u.id}" style="margin-left:6px;">Accept</button>
              <button class="btn danger" data-decline-request="${u.id}" style="margin-left:6px;">Decline</button>
            </div>
          </div>
        `).join('');
      }
    }

    if (incomingList) {
      incomingList.addEventListener('click', async (e) => {
        const a = e.target.closest('button[data-accept-request]');
        const d = e.target.closest('button[data-decline-request]');
        if (a) {
          const id = a.getAttribute('data-accept-request');
          const { data } = await api(`/friends/accept/${id}`, { method: 'POST' });
          if (data?.success) { showSuccess('Friend request accepted'); load(); updateNavAuth(); }
          else { showError(data?.error || 'Failed to accept'); }
        } else if (d) {
          const id = d.getAttribute('data-decline-request');
          const { data } = await api(`/friends/decline/${id}`, { method: 'POST' });
          if (data?.success) { showInfo('Request declined'); load(); updateNavAuth(); }
          else { showError(data?.error || 'Failed to decline'); }
        }
      });
    }

    load();
  }

  // Admin page functionality
  function initAdminPage() {
    const loginSection = $('#loginSection');
    const adminPanel = $('#adminPanel');
    const logoutBtn = $('#logoutBtn');
    const adminClipsGrid = $('#adminClipsGrid');
    const adminCategoryFilter = $('#adminCategoryFilter');
    const adminSortBy = $('#adminSortBy');
    const adminStatusFilter = $('#adminStatusFilter');
    const refreshAdminBtn = $('#refreshAdminBtn');
    const manageModal = $('#manageModal');
    const confirmDeleteBtn = $('#confirmDeleteBtn');
    const cancelDeleteBtn = $('#cancelDeleteBtn');
    const closeModal = $('.close');
    const approveClipBtn = $('#approveClipBtn');
    const previewVideo = $('#adminPreviewVideo');
    const adminUserSearch = $('#adminUserSearch');
    const adminSearchBtn = $('#adminSearchBtn');
    const adminUsersResults = $('#adminUsersResults');

    let currentClipToDelete = null;

    async function ensureAdmin() {
      const me = await getCurrentUser(true);
      if (!me) {
        const msg = document.getElementById('adminAccessMsg');
        if (msg) msg.textContent = 'You must be logged in as an admin to access this page.';
        if (loginSection) loginSection.style.display = 'block';
        if (adminPanel) adminPanel.style.display = 'none';
        return false;
      }
      if (!me.isAdmin) {
        const msg = document.getElementById('adminAccessMsg');
        if (msg) msg.textContent = 'You are logged in but not an admin.';
        if (loginSection) loginSection.style.display = 'block';
        if (adminPanel) adminPanel.style.display = 'none';
        return false;
      }
      if (loginSection) loginSection.style.display = 'none';
      if (adminPanel) adminPanel.style.display = 'block';
      return true;
    }

    // Logout (account logout)
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await api('/auth/logout', { method: 'POST' });
        if (loginSection) loginSection.style.display = 'block';
        if (adminPanel) adminPanel.style.display = 'none';
        showInfo('Logged out successfully');
        setTimeout(() => window.location.href = 'index.html', 600);
      });
    }

    // Load admin clips
    async function loadAdminClips() {
      if (!adminClipsGrid) return;

      try {
        const category = adminCategoryFilter?.value || '';
        const sort = adminSortBy?.value || 'newest';
        const status = adminStatusFilter?.value || 'pending';
        
        const response = await fetch(`${API_BASE}/clips?category=${encodeURIComponent(category)}&sortBy=${sort}&status=${status}`);
        const data = await response.json();
        
        if (data.success) {
          renderAdminClips(data.clips);
          updateAdminStats(data.stats);
        } else {
          showError('Failed to load clips');
        }
      } catch (error) {
        console.error('Error loading admin clips:', error);
        showError('Network error. Please try again.');
      }
    }

    // Render admin clips
    function renderAdminClips(clips) {
      if (!adminClipsGrid) return;

      if (clips.length === 0) {
        adminClipsGrid.innerHTML = '<p class="no-results">No clips found.</p>';
        return;
      }

      adminClipsGrid.innerHTML = clips.map(clip => `
        <div class="admin-clip-card" data-clip-id="${clip.id}">
          <div class="admin-clip-thumbnail">
<img src="${clip.thumbnail || '/images/video-placeholder.svg'}" alt="${escapeHtml(clip.title)}" onerror="this.onerror=null;this.src='/images/video-placeholder.svg';" />
          </div>
          <div class="admin-clip-info">
            <h3 class="admin-clip-title">${escapeHtml(clip.title)}</h3>
            <p class="admin-clip-description">${escapeHtml(clip.description || 'No description')}</p>
            <div class="admin-clip-meta">
              <span class="admin-clip-category">${escapeHtml(clip.category)}</span>
              <span class="admin-clip-date">${formatDate(clip.createdAt)}</span>
              <span class="admin-clip-rating">${(clip.rating || 0).toFixed(1)} ⭐</span>
              <span class="badge" style="margin-left:6px; ${clip.status==='pending' ? 'background:#ffbf47;color:#000;padding:2px 6px;border-radius:6px;' : 'background:#2ecc71;color:#000;padding:2px 6px;border-radius:6px;'}">
                ${clip.status==='pending' ? 'Pending' : 'Approved'}
              </span>
            </div>
          </div>
        </div>
      `).join('');

      // Add click handlers for management modal
      adminClipsGrid.querySelectorAll('.admin-clip-card').forEach(card => {
        card.addEventListener('click', () => {
          const clipId = card.dataset.clipId;
          const clip = clips.find(c => c.id === clipId);
          if (clip) {
            showManageModal(clip);
          }
        });
      });
    }

    // Update admin stats
    function updateAdminStats(stats) {
      const totalClipsCount = $('#totalClipsCount');
      const totalRatingsCount = $('#totalRatingsCount');
      const averageRatingValue = $('#averageRatingValue');

      if (totalClipsCount) totalClipsCount.textContent = stats.totalClips || 0;
      if (totalRatingsCount) totalRatingsCount.textContent = stats.totalRatings || 0;
      if (averageRatingValue) averageRatingValue.textContent = stats.averageRating || '0.0';
    }

    // Show management modal
    function showManageModal(clip) {
      currentClipToDelete = clip;
      const deleteClipPreview = $('#deleteClipPreview');
      
      if (deleteClipPreview) {
        deleteClipPreview.innerHTML = `
          <h4 style="margin:6px 0;">${escapeHtml(clip.title)}</h4>
          <p><strong>Status:</strong> ${clip.status==='pending' ? 'Pending' : 'Approved'}</p>
          <p><strong>Category:</strong> ${escapeHtml(clip.category)}</p>
          <p><strong>Rating:</strong> ${(clip.rating || 0).toFixed(1)} ⭐ (${clip.ratingCount || 0} ratings)</p>
          <p><strong>Submitted:</strong> ${formatDate(clip.createdAt)}</p>
          ${clip.submittedByName ? `<p><strong>By:</strong> ${escapeHtml(clip.submittedByName)}</p>` : ''}
          <p><strong>Description:</strong> ${escapeHtml(clip.description || 'No description')}</p>
        `;
      }

      if (previewVideo) {
        previewVideo.src = clip.url || clip.filePath || '';
        try { previewVideo.load(); } catch (_) {}
      }
      
      if (approveClipBtn) {
        approveClipBtn.style.display = clip.status === 'pending' ? '' : 'none';
      }

      if (manageModal) {
        manageModal.style.display = 'block';
        document.body.classList.add('modal-open');
      }
    }

    // Delete clip
    async function deleteClip(clipId) {
      try {
        const response = await fetch(`${API_BASE}/clips/${clipId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (data.success) {
          showSuccess('Clip deleted successfully!');
          if (manageModal) manageModal.style.display = 'none';
          loadAdminClips(); // Refresh the list
        } else {
          showError(data.error || 'Failed to delete clip');
        }
      } catch (error) {
        console.error('Error deleting clip:', error);
        showError('Network error. Please try again.');
      }
    }

    // Event listeners
    if (adminCategoryFilter) {
      adminCategoryFilter.addEventListener('change', loadAdminClips);
    }
    
    if (adminSortBy) {
      adminSortBy.addEventListener('change', loadAdminClips);
    }

    if (adminStatusFilter) {
      adminStatusFilter.addEventListener('change', loadAdminClips);
    }
    
    if (refreshAdminBtn) {
      refreshAdminBtn.addEventListener('click', loadAdminClips);
    }

    // Admin management: search users, make admin
    async function searchUsers() {
      const q = (adminUserSearch?.value || '').trim();
      const me = await getCurrentUser();
      const { data } = await api(`/admin/users?q=${encodeURIComponent(q)}`);
      if (data?.success && adminUsersResults) {
        adminUsersResults.innerHTML = data.users.map(u => {
          let actions = '';
          if (!u.isAdmin) actions += `<button class="btn" data-make-admin="${u.id}">Make Admin</button>`;
          if (u.id !== me.id) actions += `<button class="btn danger" style="margin-left:8px" data-delete-user="${u.id}">Delete</button>`;
          return `
            <div class="recent-clip">
              <div class="recent-info">
                <h4>${escapeHtml(u.username)} ${u.isAdmin ? '(admin)' : ''}</h4>
              </div>
              <div class="actions">
                ${actions}
              </div>
            </div>
          `;
        }).join('');
      }
    }

    if (adminSearchBtn) adminSearchBtn.addEventListener('click', searchUsers);
    if (adminUsersResults) adminUsersResults.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-make-admin]');
      if (btn) {
        const id = btn.getAttribute('data-make-admin');
        const { data } = await api(`/admin/users/${id}/make-admin`, { method: 'POST' });
        if (data?.success) {
          showSuccess('User promoted to admin');
          searchUsers();
        } else {
          showError(data?.error || 'Failed to promote');
        }
        return;
      }
      const delBtn = e.target.closest('button[data-delete-user]');
      if (delBtn) {
        const id = delBtn.getAttribute('data-delete-user');
        if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) return;
        const { data } = await api(`/admin/users/${id}`, { method: 'DELETE' });
        if (data?.success) {
          showSuccess('User deleted');
          searchUsers();
        } else {
          showError(data?.error || 'Failed to delete user');
        }
      }
    });

    // Modal events
    if (confirmDeleteBtn) {
      confirmDeleteBtn.addEventListener('click', () => {
        if (currentClipToDelete) {
          deleteClip(currentClipToDelete.id);
          currentClipToDelete = null;
        }
      });
    }

    if (approveClipBtn) {
      approveClipBtn.addEventListener('click', async () => {
        if (!currentClipToDelete) return;
        const { data } = await api(`/admin/clips/${currentClipToDelete.id}/approve`, { method: 'POST' });
        if (data?.success) {
          showSuccess('Clip approved');
          if (manageModal) manageModal.style.display = 'none';
          document.body.classList.remove('modal-open');
          loadAdminClips();
        } else {
          showError(data?.error || 'Failed to approve clip');
        }
      });
    }

    if (cancelDeleteBtn) {
      cancelDeleteBtn.addEventListener('click', () => {
        if (manageModal) manageModal.style.display = 'none';
        document.body.classList.remove('modal-open');
        currentClipToDelete = null;
      });
    }

    if (closeModal) {
      closeModal.addEventListener('click', () => {
        if (manageModal) manageModal.style.display = 'none';
        document.body.classList.remove('modal-open');
        currentClipToDelete = null;
      });
    }

    // Close modal when clicking outside
    if (manageModal) {
      manageModal.addEventListener('click', (e) => {
        if (e.target === manageModal) {
          manageModal.style.display = 'none';
          document.body.classList.remove('modal-open');
          currentClipToDelete = null;
        }
      });
    }

    // Initialize admin view
    (async () => {
      if (await ensureAdmin()) {
        try { await searchUsers(); } catch (_) {}
        await loadAdminClips();
      }
    })();
  }

  // Enhance nav with Messages dropdown (Messages / Friend Requests)
  (function setupMessagesDropdown(){
    try {
      const nav = document.querySelector('.nav');
      const link = nav && nav.querySelector('a[href="messages.html"]');
      if (!link || link.closest('.nav-dropdown')) return;
      const wrapper = document.createElement('span');
      wrapper.className = 'nav-dropdown';
      wrapper.style.position = 'relative';
      wrapper.style.display = 'inline-flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.verticalAlign = 'middle';
      link.parentNode.insertBefore(wrapper, link);
      wrapper.appendChild(link);
      const menu = document.createElement('div');
      menu.className = 'submenu';
      Object.assign(menu.style, {
        display: 'none', position: 'absolute', top: '100%', left: '0',
        background: 'rgba(0,0,0,0.9)', padding: '8px 10px', borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.1)', minWidth: '160px'
      });
      const mkItem = (href, text) => {
        const a = document.createElement('a');
        a.href = href; a.textContent = text;
        a.style.display = 'block'; a.style.color = '#fff'; a.style.padding = '6px 8px'; a.style.textDecoration = 'none';
        a.onmouseenter = () => { a.style.background = 'rgba(255,255,255,0.08)'; };
        a.onmouseleave = () => { a.style.background = 'transparent'; };
        return a;
      };
      menu.appendChild(mkItem('messages.html', 'Messages'));
      menu.appendChild(mkItem('requests.html', 'Friend Requests'));
      wrapper.appendChild(menu);
      wrapper.addEventListener('mouseenter', () => { menu.style.display = 'block'; });
      wrapper.addEventListener('mouseleave', () => { menu.style.display = 'none'; });
    } catch (_) {}
  })();

  // Initialize based on current page
  updateNavAuth();

  if (window.location.pathname.includes('submit.html') || window.location.pathname.endsWith('submit.html')) {
    initSubmissionForm();
  } else if (window.location.pathname.includes('admin.html') || window.location.pathname.endsWith('admin.html')) {
    initAdminPage();
  } else if (window.location.pathname.includes('account.html') || window.location.pathname.endsWith('account.html')) {
    initAuthPage();
  } else if (window.location.pathname.includes('messages.html') || window.location.pathname.endsWith('messages.html')) {
    initMessagesPage();
  } else if (window.location.pathname.includes('requests.html') || window.location.pathname.endsWith('requests.html')) {
    initRequestsPage();
  } else if (window.location.pathname.includes('profile.html') || window.location.pathname.endsWith('profile.html')) {
    initProfilePage();
  } else {
    initLandingPage();
  }

  // Auto-refresh nav badges and notifications every 10s
  if (!window.__navBadgePoll) {
    window.__navBadgePoll = setInterval(() => {
      updateNavAuth();
    }, 10000);
    window.addEventListener('beforeunload', () => {
      try { clearInterval(window.__navBadgePoll); } catch (_) {}
      window.__navBadgePoll = null;
    });
  }
})();
