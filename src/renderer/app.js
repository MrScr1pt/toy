// ==========================================
// TOY CHAT - Main Application
// ==========================================

// Display app version (runs immediately since script is at bottom of body)
(async function() {
  const versionEl = document.getElementById('version-display');
  console.log('Version element:', versionEl);
  console.log('electronAPI:', window.electronAPI);
  
  if (versionEl) versionEl.textContent = 'Checking...';
  
  if (window.electronAPI && window.electronAPI.getAppVersion) {
    try {
      const version = await window.electronAPI.getAppVersion();
      console.log('Got version:', version);
      if (versionEl) versionEl.textContent = `v${version}`;
    } catch (err) {
      console.error('Version error:', err);
      if (versionEl) versionEl.textContent = 'Error!';
    }
  } else {
    console.log('No electronAPI');
    if (versionEl) versionEl.textContent = 'No API!';
  }
})();

// Configuration
const SUPABASE_URL = 'https://wnyxdfoydxsbkhtujsxm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndueXhkZm95ZHhzYmtodHVqc3htIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU0NjMyMzgsImV4cCI6MjA4MTAzOTIzOH0.S062HvJChSfAOdwErBQYN1NCz6LbaxkSFuR2RJjpMEk';
const LIVEKIT_URL = 'wss://toy-cymt5c00.livekit.cloud';

// Initialize Supabase
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// App State
let currentUser = null;
let currentUserId = null;
let currentRoom = 'general';
let messagesSubscription = null;
let presenceChannel = null;
let livekitRoom = null;
let localVideoTrack = null;
let localAudioTrack = null;
let isInCall = false;
let isMicMuted = false;
let isCameraMuted = true;
let isScreenSharing = false;

// Device settings
let selectedMicId = null;
let selectedSpeakerId = null;
let selectedCameraId = null;

// Sound settings
let soundEnabled = true;
let messageCount = 0;

// Search state
let searchResults = [];
let currentSearchIndex = 0;

// DM state
let activeDMs = []; // List of users we have DMs with
let currentDM = null; // Currently open DM (username)
let isInDM = false; // Are we viewing a DM or a channel?

// DOM Elements - Auth
const authScreen = document.getElementById('auth-screen');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const signupUsername = document.getElementById('signup-username');
const signupEmail = document.getElementById('signup-email');
const signupPassword = document.getElementById('signup-password');
const signupConfirm = document.getElementById('signup-confirm');
const loginError = document.getElementById('login-error');
const signupError = document.getElementById('signup-error');

// DOM Elements - Chat
const chatScreen = document.getElementById('chat-screen');
const roomNameEl = document.getElementById('room-name');
const userCountEl = document.getElementById('user-count');
const usersListEl = document.getElementById('users-list');
const currentUserEl = document.getElementById('current-user');
const messagesEl = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const videoContainer = document.getElementById('video-container');
const videoGrid = document.getElementById('video-grid');
const micBtn = document.getElementById('mic-btn');
const cameraBtn = document.getElementById('camera-btn');
const screenBtn = document.getElementById('screen-btn');
const settingsBtn = document.getElementById('settings-btn');
const callBtn = document.getElementById('call-btn');
const hangupBtn = document.getElementById('hangup-btn');
const logoutBtn = document.getElementById('logout-btn');

// Modal elements
const screenPickerModal = document.getElementById('screen-picker-modal');
const screenSourcesEl = document.getElementById('screen-sources');
const cancelScreenPicker = document.getElementById('cancel-screen-picker');
const settingsModal = document.getElementById('settings-modal');
const micSelect = document.getElementById('mic-select');
const speakerSelect = document.getElementById('speaker-select');
const cameraSelect = document.getElementById('camera-select');
const saveSettings = document.getElementById('save-settings');
const cancelSettings = document.getElementById('cancel-settings');

// Profile modal elements
const profileModal = document.getElementById('profile-modal');
const profileBtn = document.getElementById('profile-btn');
const closeProfileBtn = document.getElementById('close-profile-btn');
const userAvatarSmall = document.getElementById('user-avatar-small');

// ==========================================
// AUTHENTICATION
// ==========================================

// Handle auth callback from deep link
async function handleAuthCallback(url) {
  console.log('Processing auth callback:', url);
  
  // Parse the URL - format: toy://auth#access_token=xxx&refresh_token=xxx...
  const hashPart = url.split('#')[1];
  if (!hashPart) return;
  
  const params = new URLSearchParams(hashPart);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  
  if (accessToken && refreshToken) {
    // Set the session
    const { data, error } = await supabaseClient.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });
    
    if (error) {
      console.error('Auth callback error:', error);
      showAuthError(loginError, 'Email verification failed. Please try again.');
      return;
    }
    
    if (data.session) {
      // Get or create profile
      let { data: profile } = await supabaseClient
        .from('profiles')
        .select('username')
        .eq('id', data.session.user.id)
        .single();
      
      // Create profile if doesn't exist
      if (!profile) {
        const username = data.session.user.user_metadata?.username || 
                        localStorage.getItem('pending_username');
        
        if (username) {
          await supabaseClient.from('profiles').upsert({
            id: data.session.user.id,
            username: username
          }, { onConflict: 'id' });
          
          localStorage.removeItem('pending_username');
          localStorage.removeItem('pending_user_id');
          profile = { username };
        }
      }
      
      if (profile) {
        currentUser = profile.username;
        currentUserId = data.session.user.id;
        enterChat();
      }
    }
  }
}

// Check for existing session on load
async function checkExistingSession() {
  // Check for auth callback from deep link
  if (window.electronAPI && window.electronAPI.getAuthCallback) {
    const callbackUrl = await window.electronAPI.getAuthCallback();
    if (callbackUrl) {
      await handleAuthCallback(callbackUrl);
      return;
    }
  }
  
  const { data: { session }, error } = await supabaseClient.auth.getSession();
  
  if (session) {
    // User is logged in, get their profile
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('username')
      .eq('id', session.user.id)
      .single();
    
    if (profile) {
      currentUser = profile.username;
      currentUserId = session.user.id;
      enterChat();
    }
  }
}

// Sign up
async function handleSignup(e) {
  e.preventDefault();
  
  const username = signupUsername.value.trim();
  const email = signupEmail.value.trim();
  const password = signupPassword.value;
  const confirm = signupConfirm.value;
  
  // Validation
  if (!username || !email || !password) {
    showAuthError(signupError, 'All fields are required');
    return;
  }
  
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    showAuthError(signupError, 'Username can only contain letters, numbers, and underscores');
    return;
  }
  
  if (password !== confirm) {
    showAuthError(signupError, 'Passwords do not match');
    return;
  }
  
  if (password.length < 6) {
    showAuthError(signupError, 'Password must be at least 6 characters');
    return;
  }
  
  // Check if username is taken
  const { data: existingUser } = await supabaseClient
    .from('profiles')
    .select('username')
    .eq('username', username)
    .single();
  
  if (existingUser) {
    showAuthError(signupError, 'Username is already taken');
    return;
  }
  
  // Sign up with Supabase Auth
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        username: username
      },
      emailRedirectTo: 'toy://auth'
    }
  });
  
  if (error) {
    showAuthError(signupError, error.message);
    return;
  }
  
  // Check if this is a fake success (email already exists)
  // Supabase returns user with identities=[] if email exists but unconfirmed
  // or just doesn't create a new user if email already confirmed
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    showAuthError(signupError, 'An account with this email already exists. Please sign in.');
    return;
  }
  
  // Check if email confirmation is required
  if (data.user && !data.session) {
    // Email confirmation required - show message
    showAuthError(signupError, 'Check your email to confirm your account, then sign in!');
    
    // Store username temporarily for after confirmation
    localStorage.setItem('pending_username', username);
    localStorage.setItem('pending_user_id', data.user.id);
    
    // Switch to login tab
    document.querySelector('[data-tab="login"]').click();
    return;
  }
  
  // No email confirmation - create profile and enter
  if (data.user && data.session) {
    const { error: profileError } = await supabaseClient
      .from('profiles')
      .upsert({
        id: data.user.id,
        username: username
      }, { onConflict: 'id' });
    
    if (profileError) {
      console.error('Profile creation error:', profileError);
      showAuthError(signupError, 'Failed to create profile: ' + profileError.message);
      return;
    }
    
    // Success - log them in immediately
    currentUser = username;
    currentUserId = data.user.id;
    enterChat();
  }
}

// Sign in
async function handleLogin(e) {
  e.preventDefault();
  
  const email = loginEmail.value.trim();
  const password = loginPassword.value;
  
  if (!email || !password) {
    showAuthError(loginError, 'Email and password are required');
    return;
  }
  
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });
  
  if (error) {
    showAuthError(loginError, error.message);
    return;
  }
  
  // Get profile
  let { data: profile } = await supabaseClient
    .from('profiles')
    .select('username')
    .eq('id', data.user.id)
    .single();
  
  // If no profile exists (first login after email confirmation), create it
  if (!profile) {
    const pendingUsername = localStorage.getItem('pending_username');
    const pendingUserId = localStorage.getItem('pending_user_id');
    
    if (pendingUsername && pendingUserId === data.user.id) {
      // Create the profile now
      const { error: profileError } = await supabaseClient
        .from('profiles')
        .insert({
          id: data.user.id,
          username: pendingUsername
        });
      
      if (profileError) {
        console.error('Profile creation error:', profileError);
        showAuthError(loginError, 'Failed to create profile: ' + profileError.message);
        return;
      }
      
      // Clear pending data
      localStorage.removeItem('pending_username');
      localStorage.removeItem('pending_user_id');
      
      profile = { username: pendingUsername };
    } else {
      // Try to use username from user metadata
      const metaUsername = data.user.user_metadata?.username;
      if (metaUsername) {
        const { error: profileError } = await supabaseClient
          .from('profiles')
          .insert({
            id: data.user.id,
            username: metaUsername
          });
        
        if (!profileError) {
          profile = { username: metaUsername };
        }
      }
    }
  }
  
  if (profile) {
    currentUser = profile.username;
    currentUserId = data.user.id;
    enterChat();
  } else {
    showAuthError(loginError, 'Profile not found. Please sign up again.');
  }
}

// Log out
async function handleLogout() {
  // Clean up subscriptions
  if (messagesSubscription) {
    supabaseClient.removeChannel(messagesSubscription);
    messagesSubscription = null;
  }
  if (presenceChannel) {
    await presenceChannel.untrack();
    supabaseClient.removeChannel(presenceChannel);
    presenceChannel = null;
  }
  
  // Sign out from Supabase
  await supabaseClient.auth.signOut();
  
  // Reset state
  currentUser = null;
  currentUserId = null;
  currentRoom = 'general';
  isInDM = false;
  currentDM = null;
  activeDMs = [];
  
  // Switch to auth screen
  chatScreen.classList.remove('active');
  authScreen.classList.add('active');
  
  // Clear form fields
  loginEmail.value = '';
  loginPassword.value = '';
  hideAuthError(loginError);
}

function showAuthError(element, message) {
  element.textContent = message;
  element.classList.add('visible');
}

function hideAuthError(element) {
  element.classList.remove('visible');
}

// Enter chat after successful auth
async function enterChat() {
  // Switch screens
  authScreen.classList.remove('active');
  chatScreen.classList.add('active');
  
  // Update UI
  roomNameEl.textContent = `Room: ${currentRoom}`;
  currentUserEl.textContent = currentUser;
  
  // Update user avatar with initial
  if (userAvatarSmall) {
    userAvatarSmall.textContent = currentUser.charAt(0).toUpperCase();
  }
  
  // Initialize services
  await initializePresence();
  await loadMessages();
  subscribeToMessages();
  loadDMList();
  await loadChannelsFromDB();
  subscribeToChannels();
  subscribeToAllDMs();
  
  addSystemMessage(`Welcome back, ${currentUser}!`);
}

// ==========================================
// INITIALIZATION
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkExistingSession();
  
  // Listen for auth callbacks while app is running
  if (window.electronAPI && window.electronAPI.onAuthCallback) {
    window.electronAPI.onAuthCallback((url) => {
      handleAuthCallback(url);
    });
  }
});

function setupEventListeners() {
  // Auth tabs
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      
      // Update tabs
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Update forms
      loginForm.classList.toggle('active', tabName === 'login');
      signupForm.classList.toggle('active', tabName === 'signup');
      
      // Clear errors
      hideAuthError(loginError);
      hideAuthError(signupError);
    });
  });
  
  // Auth forms
  loginForm.addEventListener('submit', handleLogin);
  signupForm.addEventListener('submit', handleSignup);
  
  // Username sanitization
  signupUsername.addEventListener('input', () => {
    signupUsername.value = signupUsername.value.replace(/[^a-zA-Z0-9_]/g, '');
  });
  
  // Logout button
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }
  
  // Use handleSendMessage which checks for DM mode
  sendBtn.addEventListener('click', handleSendMessage);
  messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });
  
  // Media controls
  micBtn.addEventListener('click', toggleMicrophone);
  cameraBtn.addEventListener('click', toggleCamera);
  screenBtn.addEventListener('click', shareScreen);
  settingsBtn.addEventListener('click', openSettings);
  callBtn.addEventListener('click', joinCall);
  hangupBtn.addEventListener('click', leaveCall);
  
  // Modal controls
  cancelScreenPicker.addEventListener('click', () => screenPickerModal.classList.add('hidden'));
  cancelSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));
  saveSettings.addEventListener('click', saveDeviceSettings);
  
  // Profile controls
  if (profileBtn) {
    profileBtn.addEventListener('click', openProfile);
  }
  if (closeProfileBtn) {
    closeProfileBtn.addEventListener('click', () => profileModal.classList.add('hidden'));
  }
  
  // Settings tabs
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const tabName = e.target.dataset.tab;
      // Update active tab
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      // Update active section
      document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
      document.querySelector(`[data-section="${tabName}"]`)?.classList.add('active');
    });
  });
  
  // Close modals on backdrop click
  [profileModal, settingsModal, screenPickerModal].forEach(modal => {
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
      });
    }
  });
}

// ==========================================
// ROOM MANAGEMENT
// ==========================================

// ==========================================
// PRESENCE (Online Users)
// ==========================================

async function initializePresence() {
  // Use a global presence channel for all users in the server
  // Not tied to specific text channels
  presenceChannel = supabaseClient.channel('presence:global', {
    config: {
      presence: {
        key: currentUser,
      },
    },
  });
  
  // Track users we've already seen to avoid duplicate join messages
  const seenUsers = new Set();
  
  presenceChannel
    .on('presence', { event: 'sync' }, () => {
      const state = presenceChannel.presenceState();
      console.log('Presence sync:', Object.keys(state));
      updateUsersList(state);
      updateTypingIndicator(state);
      
      // Mark all current users as seen
      Object.keys(state).forEach(user => seenUsers.add(user));
    })
    .on('presence', { event: 'join' }, ({ key, newPresences }) => {
      console.log('User joined:', key);
      if (key !== currentUser && !seenUsers.has(key)) {
        addSystemMessage(`${key} joined the room`);
        seenUsers.add(key);
      }
    })
    .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
      console.log('User left:', key);
      // Check if user is still in the room (just updating presence) or actually left
      const state = presenceChannel.presenceState();
      if (!state[key] && key !== currentUser) {
        addSystemMessage(`${key} left the room`);
        seenUsers.delete(key);
      }
    });
  
  await presenceChannel.subscribe(async (status) => {
    console.log('Presence subscription status:', status);
    if (status === 'SUBSCRIBED') {
      await presenceChannel.track({
        user: currentUser,
        online_at: new Date().toISOString(),
        in_call: false,
      });
    }
  });
  
  // Clean up presence when window closes
  window.addEventListener('beforeunload', async () => {
    if (presenceChannel) {
      await presenceChannel.untrack();
      await supabaseClient.removeChannel(presenceChannel);
    }
  });
}

function updateUsersList(state) {
  const users = Object.keys(state);
  userCountEl.textContent = `${users.length} online`;
  
  usersListEl.innerHTML = users.map(user => {
    const userData = state[user][0];
    const inCall = userData?.in_call;
    const initial = user.charAt(0).toUpperCase();
    
    return `
      <li class="user-item ${inCall ? 'in-call' : ''}" data-username="${user}" data-incall="${inCall || false}">
        <div class="user-item-avatar">
          <div class="avatar-circle">${initial}</div>
          <span class="status-indicator online"></span>
        </div>
        <div class="user-item-info">
          <div class="user-item-name">${user}</div>
          ${inCall ? '<div class="user-item-status">🎤 In voice</div>' : '<div class="user-item-status">Online</div>'}
        </div>
      </li>
    `;
  }).join('');
  
  // Add click handlers for user popovers
  usersListEl.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent click from bubbling up
      const username = li.dataset.username;
      const inCall = li.dataset.incall === 'true';
      showUserPopover(username, li, inCall);
    });
  });
}

// ==========================================
// TEXT CHAT
// ==========================================

async function loadMessages() {
  let query = supabaseClient
    .from('messages')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(50);
  
  // For general room, also include messages with no room set (legacy messages)
  if (currentRoom === 'general') {
    query = query.or(`room.eq.general,room.eq.General,room.is.null`);
  } else {
    query = query.eq('room', currentRoom);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('Error loading messages:', error);
    if (error.code === '42P01') {
      addSystemMessage('⚠️ Database table not set up. See setup instructions.');
    }
    return;
  }
  
  data?.forEach(msg => displayMessage(msg));
  scrollToBottom();
}

function subscribeToMessages() {
  messagesSubscription = supabaseClient
    .channel(`messages:${currentRoom}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `room=eq.${currentRoom}`,
      },
      (payload) => {
        displayMessage(payload.new);
        scrollToBottom();
        
        // Desktop notification for channel messages
        if (payload.new.username !== currentUser) {
          showDesktopNotification(
            `#${currentRoom} - ${payload.new.username}`,
            payload.new.content
          );
        }
      }
    )
    .subscribe();
}

async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;
  
  messageInput.value = '';
  
  const { error } = await supabaseClient
    .from('messages')
    .insert({
      room: currentRoom,
      username: currentUser,
      content: text,
    });
  
  if (error) {
    console.error('Error sending message:', error);
    messageInput.value = text; // Restore message on error
    if (error.code === '42P01') {
      addSystemMessage('⚠️ Cannot send message. Database table not set up.');
    }
  }
}

// Handle send - routes to DM or channel
async function handleSendMessage() {
  if (isInDM && currentDM) {
    await sendDMMessage();
  } else {
    await sendMessage();
  }
}

// Send DM message
async function sendDMMessage() {
  const content = messageInput.value.trim();
  if (!content) return;
  
  const dmRoom = getDMRoomId(currentUser, currentDM);
  console.log('Sending DM to room:', dmRoom, 'to user:', currentDM);
  
  messageInput.value = ''; // Clear immediately for better UX
  
  const { data, error } = await supabaseClient
    .from('messages')
    .insert({
      room: dmRoom,
      username: currentUser,
      content: content
    })
    .select()
    .single();
  
  if (error) {
    console.error('Error sending DM:', error);
    showToast('Failed to send message', 'error');
    messageInput.value = content; // Restore on error
    return;
  }
  
  // Display our own message immediately
  displayMessage(data);
  scrollToBottom();
  
  // Broadcast DM to recipient
  const recipientChannel = supabaseClient.channel(`dm-broadcast-${currentDM}`);
  await recipientChannel.send({
    type: 'broadcast',
    event: 'new-dm',
    payload: {
      from: currentUser,
      to: currentDM,
      content: content,
      room: dmRoom,
      messageData: data
    }
  });
  console.log('DM broadcast sent to:', currentDM);
}

function displayMessage(msg) {
  const isOwn = msg.username === currentUser;
  const time = new Date(msg.created_at).toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  const messageEl = document.createElement('div');
  messageEl.className = `message ${isOwn ? 'own' : ''}`;
  messageEl.dataset.messageId = msg.id;
  
  // Check if it's an image message (content starts with [IMG])
  let contentHtml = '';
  if (msg.content && msg.content.startsWith('[IMG]')) {
    const imageData = msg.content.substring(5); // Remove [IMG] prefix
    contentHtml = `
      <div class="message-image">
        <img src="${imageData}" alt="Shared image" onclick="openImageViewer(this.src)">
      </div>
    `;
  } else {
    // Escape HTML first, then linkify URLs
    const escapedText = escapeHtml(msg.content);
    const linkedText = linkifyText(escapedText);
    contentHtml = `<div class="text">${linkedText}</div>`;
  }
  
  // Build action buttons - include edit/delete for own messages
  const ownActions = isOwn ? `
      <button class="message-action-btn" data-action="edit" title="Edit">✏️</button>
      <button class="message-action-btn" data-action="delete" title="Delete">🗑️</button>
  ` : '';
  
  // Check if message is pinned (from localStorage)
  const isPinned = isMessagePinned(msg.id);
  const pinnedBadge = isPinned ? '<span class="pinned-badge">📌 Pinned</span>' : '';
  const editedLabel = msg.edited_at ? '<span class="edited-label">(edited)</span>' : '';
  
  messageEl.innerHTML = `
    ${pinnedBadge}
    <div class="message-header">
      <span class="author">${msg.username}</span>
      <span class="time">${time}</span>
      ${editedLabel}
    </div>
    ${contentHtml}
    <div class="message-actions">
      <button class="message-action-btn" data-action="react" title="Add Reaction">😀</button>
      <button class="message-action-btn" data-action="reply" title="Reply">↩️</button>
      <button class="message-action-btn" data-action="pin" title="${isPinned ? 'Unpin' : 'Pin'}">📌</button>
      ${ownActions}
    </div>
    <div class="message-reactions"></div>
  `;
  
  // Add reaction handler
  const reactBtn = messageEl.querySelector('[data-action="react"]');
  reactBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showReactionPicker(messageEl, msg.id);
  });
  
  // Add reply handler
  const replyBtn = messageEl.querySelector('[data-action="reply"]');
  replyBtn.addEventListener('click', () => {
    messageInput.value = `@${msg.username} `;
    messageInput.focus();
  });
  
  // Add pin handler - use localStorage state
  const pinBtn = messageEl.querySelector('[data-action="pin"]');
  pinBtn.addEventListener('click', () => {
    const currentlyPinned = isMessagePinned(msg.id);
    togglePinMessage(msg.id, !currentlyPinned, messageEl);
  });
  
  // Add edit handler (only for own messages)
  const editBtn = messageEl.querySelector('[data-action="edit"]');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      startEditMessage(messageEl, msg);
    });
  }
  
  // Add delete handler (only for own messages)
  const deleteBtn = messageEl.querySelector('[data-action="delete"]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      confirmDeleteMessage(msg.id);
    });
  }
  
  // Add pinned class if pinned (from localStorage)
  if (isPinned) {
    messageEl.classList.add('pinned');
  }
  
  messagesEl.appendChild(messageEl);
  
  // Play sound for new messages from others
  if (!isOwn && messageCount > 0) {
    if (msg.content && msg.content.includes(`@${currentUser}`)) {
      playSound('mention');
    } else {
      playSound('message');
    }
  }
  messageCount++;
}

function addSystemMessage(text) {
  const messageEl = document.createElement('div');
  messageEl.className = 'message system';
  messageEl.textContent = text;
  messagesEl.appendChild(messageEl);
  scrollToBottom();
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==========================================
// MESSAGE EDITING & DELETION
// ==========================================

let editingMessageId = null;

function startEditMessage(messageEl, msg) {
  // Don't allow editing image messages
  if (msg.content && msg.content.startsWith('[IMG]')) {
    showToast('Cannot edit image messages', 'error');
    return;
  }
  
  editingMessageId = msg.id;
  const textEl = messageEl.querySelector('.text');
  const originalText = msg.content;
  
  // Create container
  const container = document.createElement('div');
  container.className = 'edit-message-container';
  
  // Create input and set value safely (handles quotes)
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'edit-message-input';
  input.value = originalText;
  
  // Create buttons
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'edit-message-actions';
  actionsDiv.innerHTML = `
    <button class="btn-sm btn-primary save-edit">Save</button>
    <button class="btn-sm btn-secondary cancel-edit">Cancel</button>
  `;
  
  container.appendChild(input);
  container.appendChild(actionsDiv);
  
  // Clear and add new content
  textEl.innerHTML = '';
  textEl.appendChild(container);
  
  const saveBtn = textEl.querySelector('.save-edit');
  const cancelBtn = textEl.querySelector('.cancel-edit');
  
  input.focus();
  input.select();
  
  // Save edit
  const saveEdit = async () => {
    const newContent = input.value.trim();
    if (!newContent) {
      showToast('Message cannot be empty', 'error');
      return;
    }
    
    console.log('Attempting to edit message:', msg.id, 'New content:', newContent);
    
    // Only update content field (edited_at might not exist in DB)
    const { data, error } = await supabaseClient
      .from('messages')
      .update({ content: newContent })
      .eq('id', msg.id)
      .eq('username', currentUser) // Ensure only own messages
      .select();
    
    console.log('Edit result:', { data, error });
    
    if (error) {
      console.error('Error editing message:', error);
      showToast('Failed to edit: ' + error.message, 'error');
      cancelEdit();
    } else if (!data || data.length === 0) {
      console.error('No rows updated - may be RLS policy issue');
      showToast('Could not update message', 'error');
      cancelEdit();
    } else {
      textEl.innerHTML = escapeHtml(newContent);
      // Add edited label if not already there
      const header = messageEl.querySelector('.message-header');
      if (!header.querySelector('.edited-label')) {
        header.insertAdjacentHTML('beforeend', '<span class="edited-label">(edited)</span>');
      }
      showToast('Message edited', 'success');
    }
    editingMessageId = null;
  };
  
  // Cancel edit
  const cancelEdit = () => {
    textEl.innerHTML = escapeHtml(originalText);
    editingMessageId = null;
  };
  
  saveBtn.addEventListener('click', saveEdit);
  cancelBtn.addEventListener('click', cancelEdit);
  
  // Enter to save, Escape to cancel
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  });
}

function confirmDeleteMessage(messageId) {
  // Create confirmation modal
  const modal = document.createElement('div');
  modal.className = 'delete-modal-overlay';
  modal.innerHTML = `
    <div class="delete-modal">
      <div class="delete-modal-icon">🗑️</div>
      <h3 class="delete-modal-title">Delete Message</h3>
      <p class="delete-modal-text">Are you sure you want to delete this message?<br>This action cannot be undone.</p>
      <div class="delete-modal-buttons">
        <button class="delete-modal-btn cancel-btn">Cancel</button>
        <button class="delete-modal-btn danger-btn delete-btn">Delete</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const cancelBtn = modal.querySelector('.cancel-btn');
  const deleteBtn = modal.querySelector('.delete-btn');
  
  cancelBtn.addEventListener('click', () => {
    modal.remove();
  });
  
  deleteBtn.addEventListener('click', async () => {
    const { error } = await supabaseClient
      .from('messages')
      .delete()
      .eq('id', messageId);
    
    if (error) {
      console.error('Error deleting message:', error);
      showToast('Failed to delete message', 'error');
    } else {
      // Remove from DOM
      const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
      if (messageEl) {
        messageEl.remove();
      }
      showToast('Message deleted', 'success');
    }
    modal.remove();
  });
  
  // Click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// ==========================================
// PINNED MESSAGES
// ==========================================

// Load pinned messages from localStorage - stored globally since message IDs are unique
function getPinnedMessages() {
  try {
    const stored = localStorage.getItem('toy_pinned_messages');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function savePinnedMessages(pinnedIds) {
  localStorage.setItem('toy_pinned_messages', JSON.stringify(pinnedIds));
}

function isMessagePinned(messageId) {
  const pinned = getPinnedMessages();
  return pinned.includes(String(messageId));
}

async function togglePinMessage(messageId, pin, messageEl) {
  // Store pinned state in localStorage for persistence
  const pinnedIds = getPinnedMessages();
  const msgIdStr = String(messageId);
  
  if (pin) {
    if (!pinnedIds.includes(msgIdStr)) {
      pinnedIds.push(msgIdStr);
    }
    messageEl.classList.add('pinned');
    const header = messageEl.querySelector('.message-header');
    if (!messageEl.querySelector('.pinned-badge')) {
      header.insertAdjacentHTML('beforebegin', '<span class="pinned-badge">📌 Pinned</span>');
    }
    showToast('Message pinned', 'success');
  } else {
    const index = pinnedIds.indexOf(msgIdStr);
    if (index > -1) {
      pinnedIds.splice(index, 1);
    }
    messageEl.classList.remove('pinned');
    const badge = messageEl.querySelector('.pinned-badge');
    if (badge) badge.remove();
    showToast('Message unpinned', 'success');
  }
  
  // Save to localStorage
  savePinnedMessages(pinnedIds);
  
  // Update pin button title
  const pinBtn = messageEl.querySelector('[data-action="pin"]');
  if (pinBtn) {
    pinBtn.title = pin ? 'Unpin' : 'Pin';
  }
}

function showPinnedMessages() {
  const pinnedEls = document.querySelectorAll('.message.pinned');
  
  if (pinnedEls.length === 0) {
    showToast('No pinned messages', 'info');
    return;
  }
  
  // Create pinned messages panel
  const panel = document.createElement('div');
  panel.className = 'pinned-panel-overlay';
  panel.innerHTML = `
    <div class="pinned-panel">
      <div class="pinned-panel-header">
        <h3>📌 Pinned Messages</h3>
        <button class="pinned-panel-close">✕</button>
      </div>
      <div class="pinned-panel-content"></div>
    </div>
  `;
  
  const content = panel.querySelector('.pinned-panel-content');
  
  pinnedEls.forEach(msgEl => {
    const author = msgEl.querySelector('.author')?.textContent || 'Unknown';
    const text = msgEl.querySelector('.text')?.textContent || '[Image]';
    const time = msgEl.querySelector('.time')?.textContent || '';
    const messageId = msgEl.dataset.messageId;
    
    const item = document.createElement('div');
    item.className = 'pinned-item';
    item.innerHTML = `
      <div class="pinned-item-header">
        <span class="pinned-item-author">${author}</span>
        <span class="pinned-item-time">${time}</span>
      </div>
      <div class="pinned-item-text">${escapeHtml(text.substring(0, 100))}${text.length > 100 ? '...' : ''}</div>
    `;
    
    item.addEventListener('click', () => {
      panel.remove();
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      msgEl.classList.add('highlight-flash');
      setTimeout(() => msgEl.classList.remove('highlight-flash'), 2000);
    });
    
    content.appendChild(item);
  });
  
  document.body.appendChild(panel);
  
  // Close handlers
  panel.querySelector('.pinned-panel-close').addEventListener('click', () => panel.remove());
  panel.addEventListener('click', (e) => {
    if (e.target === panel) panel.remove();
  });
}

// Setup pinned messages button
document.addEventListener('DOMContentLoaded', () => {
  const pinToggle = document.getElementById('pin-toggle-btn');
  if (pinToggle) {
    pinToggle.addEventListener('click', showPinnedMessages);
  }
});

// ==========================================
// VOICE/VIDEO CHAT (LiveKit)
// ==========================================

async function joinCall() {
  try {
    addSystemMessage('Connecting to voice/video...');
    
    // Get token from Supabase Edge Function
    const { data, error } = await supabaseClient.functions.invoke('livekit-token', {
      body: { 
        roomName: currentRoom, 
        participantName: currentUser 
      },
    });
    
    if (error) {
      console.error('Error getting token:', error);
      addSystemMessage('⚠️ Could not connect to voice/video. Edge function not set up.');
      return;
    }
    
    const token = data.token;
    
    // Create LiveKit room
    livekitRoom = new LivekitClient.Room({
      adaptiveStream: true,
      dynacast: true,
    });
    
    // Set up event listeners
    setupLiveKitListeners();
    
    // Connect to room
    await livekitRoom.connect(LIVEKIT_URL, token);
    
    isInCall = true;
    callBtn.classList.add('hidden');
    hangupBtn.classList.remove('hidden');
    videoContainer.classList.remove('hidden');
    
    // Update presence
    await presenceChannel.track({
      user: currentUser,
      online_at: new Date().toISOString(),
      in_call: true,
    });
    
    addSystemMessage('Connected to voice/video!');
    
    // Show voice status bar
    updateVoiceStatusBar(true);
    showToast('Voice channel connected', 'success', 'Connected');
    
    // Enable microphone by default (use selected device if set)
    if (selectedMicId) {
      await livekitRoom.localParticipant.setMicrophoneEnabled(true, {
        deviceId: selectedMicId
      });
    } else {
      await livekitRoom.localParticipant.setMicrophoneEnabled(true);
    }
    isMicMuted = false;
    micBtn.classList.add('active');
    
  } catch (err) {
    console.error('Error joining call:', err);
    addSystemMessage(`⚠️ Error joining call: ${err.message}`);
  }
}

async function leaveCall() {
  if (livekitRoom) {
    await livekitRoom.disconnect();
    livekitRoom = null;
  }
  
  isInCall = false;
  isMicMuted = false;
  isCameraMuted = true;
  isScreenSharing = false;
  
  callBtn.classList.remove('hidden');
  hangupBtn.classList.add('hidden');
  videoContainer.classList.add('hidden');
  videoGrid.innerHTML = '';
  
  micBtn.classList.remove('active', 'muted');
  cameraBtn.classList.remove('active');
  screenBtn.classList.remove('active');
  
  // Hide voice status bar
  updateVoiceStatusBar(false);
  
  // Update presence
  if (presenceChannel) {
    await presenceChannel.track({
      user: currentUser,
      online_at: new Date().toISOString(),
      in_call: false,
    });
  }
  
  addSystemMessage('Left the call');
}

function setupLiveKitListeners() {
  livekitRoom
    .on(LivekitClient.RoomEvent.TrackSubscribed, handleTrackSubscribed)
    .on(LivekitClient.RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)
    .on(LivekitClient.RoomEvent.TrackMuted, handleTrackMuted)
    .on(LivekitClient.RoomEvent.TrackUnmuted, handleTrackUnmuted)
    .on(LivekitClient.RoomEvent.ParticipantConnected, handleParticipantConnected)
    .on(LivekitClient.RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
    .on(LivekitClient.RoomEvent.LocalTrackPublished, handleLocalTrackPublished)
    .on(LivekitClient.RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished)
    .on(LivekitClient.RoomEvent.Disconnected, handleDisconnected);
}

function handleTrackSubscribed(track, publication, participant) {
  console.log('Track subscribed:', track.kind, track.source, participant.identity);
  
  if (track.kind === 'video') {
    const element = track.attach();
    const isScreen = track.source === LivekitClient.Track.Source.ScreenShare;
    const tileName = isScreen ? participant.identity + ' (Screen)' : participant.identity;
    addVideoTile(tileName, element, false);
  } else if (track.kind === 'audio') {
    const element = track.attach();
    document.body.appendChild(element); // Audio doesn't need visual
  }
}

function handleTrackUnsubscribed(track, publication, participant) {
  console.log('Track unsubscribed:', track.kind, track.source, participant.identity);
  track.detach().forEach(el => el.remove());
  
  if (track.kind === 'video') {
    const isScreen = track.source === LivekitClient.Track.Source.ScreenShare;
    const tileName = isScreen ? participant.identity + ' (Screen)' : participant.identity;
    removeVideoTile(tileName);
  }
}

function handleTrackMuted(publication, participant) {
  console.log('Track muted:', publication.kind, participant.identity);
  if (publication.kind === 'video') {
    const isScreen = publication.source === LivekitClient.Track.Source.ScreenShare;
    const tileName = isScreen ? participant.identity + ' (Screen)' : participant.identity;
    removeVideoTile(tileName);
  }
}

function handleTrackUnmuted(publication, participant) {
  console.log('Track unmuted:', publication.kind, participant.identity);
  if (publication.kind === 'video' && publication.track) {
    const element = publication.track.attach();
    addVideoTile(participant.identity, element, participant.identity === currentUser);
  }
}

function handleParticipantConnected(participant) {
  addSystemMessage(`${participant.identity} joined the call`);
}

function handleParticipantDisconnected(participant) {
  addSystemMessage(`${participant.identity} left the call`);
  removeVideoTile(participant.identity);
  removeVideoTile(participant.identity + ' (Screen)');
}

function handleLocalTrackPublished(publication, participant) {
  if (publication.track.kind === 'video') {
    // Check if it's a screen share or camera
    const isScreen = publication.source === LivekitClient.Track.Source.ScreenShare || 
                     publication.track.source === LivekitClient.Track.Source.ScreenShare ||
                     publication.trackName === 'screen';
    
    if (!isScreen) {
      // Only add camera tile here, screen share is handled in selectScreenSource
      const element = publication.track.attach();
      addVideoTile(currentUser + ' (You)', element, true);
    }
  }
}

function handleLocalTrackUnpublished(publication, participant) {
  if (publication.track.kind === 'video') {
    publication.track.detach().forEach(el => el.remove());
    
    const isScreen = publication.source === LivekitClient.Track.Source.ScreenShare || 
                     publication.track.source === LivekitClient.Track.Source.ScreenShare ||
                     publication.trackName === 'screen';
    
    if (isScreen) {
      removeVideoTile(currentUser + ' (Screen)');
    } else {
      removeVideoTile(currentUser + ' (You)');
    }
  }
}

function handleDisconnected() {
  addSystemMessage('Disconnected from call');
  leaveCall();
}

function addVideoTile(identity, videoElement, isLocal) {
  // Remove existing tile for this user
  removeVideoTile(identity);
  
  const tile = document.createElement('div');
  tile.className = 'video-tile';
  tile.id = `video-${identity.replace(/[^a-zA-Z0-9]/g, '_')}`;
  tile.innerHTML = `<span class="video-label">${identity}</span>`;
  
  videoElement.autoplay = true;
  videoElement.muted = isLocal; // Mute local video to prevent echo
  tile.insertBefore(videoElement, tile.firstChild);
  
  videoGrid.appendChild(tile);
}

function removeVideoTile(identity) {
  const tile = document.getElementById(`video-${identity.replace(/[^a-zA-Z0-9]/g, '_')}`);
  if (tile) {
    tile.remove();
  }
}

// Media Controls
async function toggleMicrophone() {
  if (!isInCall) {
    addSystemMessage('Join a call first to use microphone');
    return;
  }
  
  isMicMuted = !isMicMuted;
  await livekitRoom.localParticipant.setMicrophoneEnabled(!isMicMuted);
  
  micBtn.classList.toggle('active', !isMicMuted);
  micBtn.classList.toggle('muted', isMicMuted);
}

async function toggleCamera() {
  if (!isInCall) {
    addSystemMessage('Join a call first to use camera');
    return;
  }
  
  isCameraMuted = !isCameraMuted;
  
  // Use selected camera if set
  if (!isCameraMuted && selectedCameraId) {
    await livekitRoom.localParticipant.setCameraEnabled(true, {
      deviceId: selectedCameraId
    });
  } else {
    await livekitRoom.localParticipant.setCameraEnabled(!isCameraMuted);
  }
  
  // Manually remove video tile when camera is off
  if (isCameraMuted) {
    removeVideoTile(currentUser + ' (You)');
  }
  
  cameraBtn.classList.toggle('active', !isCameraMuted);
}

async function shareScreen() {
  if (!isInCall) {
    addSystemMessage('Join a call first to share screen');
    return;
  }
  
  // If already sharing, stop
  if (isScreenSharing) {
    await livekitRoom.localParticipant.setScreenShareEnabled(false);
    isScreenSharing = false;
    screenBtn.classList.remove('active');
    removeVideoTile(currentUser + ' (Screen)');
    return;
  }
  
  // Show screen picker
  try {
    const sources = await window.electronAPI.getScreenSources();
    
    screenSourcesEl.innerHTML = sources.map(source => `
      <div class="screen-source" data-id="${source.id}">
        <img src="${source.thumbnail}" alt="${source.name}">
        <span>${source.name}</span>
      </div>
    `).join('');
    
    // Add click handlers
    document.querySelectorAll('.screen-source').forEach(el => {
      el.addEventListener('click', () => selectScreenSource(el.dataset.id));
    });
    
    screenPickerModal.classList.remove('hidden');
  } catch (err) {
    console.error('Error getting screen sources:', err);
    addSystemMessage('Could not get screen sources');
  }
}

async function selectScreenSource(sourceId) {
  screenPickerModal.classList.add('hidden');
  
  try {
    // Get stream for selected source
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId
        }
      }
    });
    
    // Create track from stream
    const videoTrack = stream.getVideoTracks()[0];
    
    // Publish the screen share track
    await livekitRoom.localParticipant.publishTrack(videoTrack, {
      name: 'screen',
      source: LivekitClient.Track.Source.ScreenShare
    });
    
    isScreenSharing = true;
    screenBtn.classList.add('active');
    
    // Add video tile for screen share
    const videoEl = document.createElement('video');
    videoEl.srcObject = stream;
    videoEl.autoplay = true;
    videoEl.muted = true;
    addVideoTile(currentUser + ' (Screen)', videoEl, true);
    
    // Handle when user stops sharing via system dialog
    videoTrack.onended = () => {
      isScreenSharing = false;
      screenBtn.classList.remove('active');
      removeVideoTile(currentUser + ' (Screen)');
    };
    
  } catch (err) {
    console.error('Error sharing screen:', err);
    addSystemMessage('Could not share screen');
  }
}

// ==========================================
// DEVICE SETTINGS
// ==========================================

async function openSettings() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    
    // Populate microphone options
    const mics = devices.filter(d => d.kind === 'audioinput');
    micSelect.innerHTML = mics.map(d => 
      `<option value="${d.deviceId}" ${d.deviceId === selectedMicId ? 'selected' : ''}>
        ${d.label || 'Microphone ' + (mics.indexOf(d) + 1)}
      </option>`
    ).join('');
    
    // Populate speaker options
    const speakers = devices.filter(d => d.kind === 'audiooutput');
    speakerSelect.innerHTML = speakers.map(d => 
      `<option value="${d.deviceId}" ${d.deviceId === selectedSpeakerId ? 'selected' : ''}>
        ${d.label || 'Speaker ' + (speakers.indexOf(d) + 1)}
      </option>`
    ).join('');
    
    // Populate camera options
    const cameras = devices.filter(d => d.kind === 'videoinput');
    cameraSelect.innerHTML = cameras.map(d => 
      `<option value="${d.deviceId}" ${d.deviceId === selectedCameraId ? 'selected' : ''}>
        ${d.label || 'Camera ' + (cameras.indexOf(d) + 1)}
      </option>`
    ).join('');
    
    settingsModal.classList.remove('hidden');
  } catch (err) {
    console.error('Error getting devices:', err);
    addSystemMessage('Could not get device list. Make sure to allow permissions.');
  }
}

async function saveDeviceSettings() {
  selectedMicId = micSelect.value;
  selectedSpeakerId = speakerSelect.value;
  selectedCameraId = cameraSelect.value;
  
  // Apply speaker to all audio elements
  if (selectedSpeakerId) {
    document.querySelectorAll('audio, video').forEach(el => {
      if (el.setSinkId) {
        el.setSinkId(selectedSpeakerId).catch(console.error);
      }
    });
  }
  
  // If in call, switch microphone
  if (isInCall && livekitRoom && selectedMicId) {
    try {
      await livekitRoom.switchActiveDevice('audioinput', selectedMicId);
    } catch (err) {
      console.error('Error switching microphone:', err);
    }
  }
  
  // If camera is on, switch it
  if (isInCall && livekitRoom && !isCameraMuted && selectedCameraId) {
    try {
      await livekitRoom.switchActiveDevice('videoinput', selectedCameraId);
    } catch (err) {
      console.error('Error switching camera:', err);
    }
  }
  
  settingsModal.classList.add('hidden');
  addSystemMessage('Device settings saved');
}

// ==========================================
// USER PROFILE
// ==========================================

function openProfile() {
  if (!profileModal) return;
  
  // Update profile with current user data
  const profileUsername = document.getElementById('profile-username');
  const profileInitial = document.getElementById('profile-initial');
  const profileRoom = document.getElementById('profile-room');
  
  if (profileUsername) profileUsername.textContent = currentUser;
  if (profileInitial) profileInitial.textContent = currentUser.charAt(0).toUpperCase();
  if (profileRoom) profileRoom.textContent = currentRoom;
  
  // Set joined date to today (session-based)
  const profileJoined = document.getElementById('profile-joined');
  if (profileJoined) {
    const today = new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    profileJoined.textContent = today;
  }
  
  profileModal.classList.remove('hidden');
}

// ==========================================
// TOAST NOTIFICATIONS
// ==========================================

const toastContainer = document.getElementById('toast-container');

function showToast(message, type = 'info', title = null) {
  if (!toastContainer) return;
  
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
    gold: '◆'
  };
  
  const titles = {
    success: 'Success',
    error: 'Error',
    warning: 'Warning',
    info: 'Info',
    gold: 'Notice'
  };
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-content">
      <div class="toast-title">${title || titles[type]}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close">✕</button>
  `;
  
  // Close button
  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.style.animation = 'toastFadeOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  });
  
  toastContainer.appendChild(toast);
  
  // Auto remove after 5 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.remove();
    }
  }, 5000);
}

// ==========================================
// VOICE STATUS BAR
// ==========================================

const voiceStatusBar = document.getElementById('voice-status-bar');
const voiceRoomName = document.getElementById('voice-room-name');
const voiceDisconnectBtn = document.getElementById('voice-disconnect-btn');

function updateVoiceStatusBar(connected) {
  if (voiceStatusBar) {
    voiceStatusBar.classList.toggle('active', connected);
  }
  if (voiceRoomName) {
    voiceRoomName.textContent = `/ ${currentRoom}`;
  }
}

// Hook up voice disconnect button
if (voiceDisconnectBtn) {
  voiceDisconnectBtn.addEventListener('click', leaveCall);
}

// ==========================================
// EMOJI PICKER
// ==========================================

const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');
const emojiGrid = document.getElementById('emoji-grid');
const emojiSearch = document.getElementById('emoji-search');

const emojiData = {
  recent: ['😀', '❤️', '👍', '🔥', '😂', '🎉', '💯', '✨'],
  smileys: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '😱', '😨', '😰', '😥', '😢', '😭', '😤', '😠', '😡', '🤬', '😈', '👿', '💀', '☠️'],
  people: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁️', '👅', '👄'],
  nature: ['🌿', '🍀', '🌸', '🌺', '🌻', '🌹', '🥀', '🌷', '🌱', '🌴', '🌵', '🌲', '🌳', '🍃', '🍂', '🍁', '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦟', '🦗', '🕷️', '🦂', '🐢', '🐍', '🦎', '🐙', '🦑', '🦐', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊'],
  food: ['🍕', '🍔', '🍟', '🌭', '🍿', '🧂', '🥓', '🥚', '🍳', '🧇', '🥞', '🧈', '🍞', '🥐', '🥖', '🥨', '🧀', '🥗', '🥙', '🥪', '🌮', '🌯', '🫔', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤', '🍚', '🍘', '🍙', '🍡', '🥮', '🍧', '🍨', '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍩', '🍪', '☕', '🍵', '🧃', '🥤', '🧋', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉'],
  activities: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '⛹️', '🤾', '🏌️', '🏇', '🧘', '🏄', '🏊', '🤽', '🚣', '🧗', '🚵', '🚴', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🏵️', '🎗️', '🎫', '🎟️', '🎪', '🎭', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🪕', '🎻', '🎲', '♟️', '🎯', '🎳', '🎮', '🎰', '🧩'],
  objects: ['💡', '🔦', '🏮', '🪔', '📱', '💻', '🖥️', '🖨️', '⌨️', '🖱️', '💿', '📀', '💾', '📷', '📹', '🎥', '📺', '📻', '🎙️', '⏰', '⏱️', '⏲️', '🕰️', '⌛', '📡', '🔋', '🔌', '💸', '💵', '💴', '💶', '💷', '💰', '💳', '💎', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🔩', '⚙️', '🔗', '⛓️', '🧰', '🧲', '🔫', '💣', '🧨', '🪓', '🔪', '🗡️', '⚔️', '🛡️', '🚬', '⚰️', '🪦', '⚱️', '🏺', '🔮', '📿', '🧿', '💈', '⚗️', '🔭', '🔬', '🕳️', '🩹', '🩺', '💊', '💉', '🩸', '🧬', '🦠', '🧫', '🧪'],
  symbols: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🛗', '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '⚧️', '🚻', '🚮', '🎦', '📶', '🈁', '🔣', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🔢', '#️⃣', '*️⃣', '▶️', '⏸️', '⏯️', '⏹️', '⏺️', '⏭️', '⏮️', '⏩', '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↪️', '↩️', '⤴️', '⤵️', '🔀', '🔁', '🔂', '🔄', '🔃', '🎵', '🎶', '➕', '➖', '➗', '✖️', '♾️', '💲', '💱', '™️', '©️', '®️', '〰️', '➰', '➿', '🔚', '🔙', '🔛', '🔝', '🔜', '✔️', '☑️', '🔘', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '🔺', '🔻', '🔸', '🔹', '🔶', '🔷', '🔳', '🔲', '▪️', '▫️', '◾', '◽', '◼️', '◻️', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛', '⬜', '🟫', '🔈', '🔇', '🔉', '🔊', '🔔', '🔕', '📣', '📢', '👁️‍🗨️', '💬', '💭', '🗯️', '♠️', '♣️', '♥️', '♦️', '🃏', '🎴', '🀄', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '🕜', '🕝', '🕞', '🕟', '🕠', '🕡', '🕢', '🕣', '🕤', '🕥', '🕦', '🕧']
};

let currentEmojiCategory = 'recent';

// Initialize emoji picker
function initEmojiPicker() {
  if (!emojiBtn || !emojiPicker || !emojiGrid) return;
  
  // Toggle picker
  emojiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    emojiPicker.classList.toggle('hidden');
    if (!emojiPicker.classList.contains('hidden')) {
      renderEmojiGrid(currentEmojiCategory);
    }
  });
  
  // Close on click outside
  document.addEventListener('click', (e) => {
    if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
      emojiPicker.classList.add('hidden');
    }
  });
  
  // Category buttons
  document.querySelectorAll('.emoji-category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.emoji-category-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentEmojiCategory = btn.dataset.category;
      renderEmojiGrid(currentEmojiCategory);
    });
  });
  
  // Search
  if (emojiSearch) {
    emojiSearch.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      if (query) {
        const allEmojis = Object.values(emojiData).flat();
        renderEmojiGrid('search', allEmojis.slice(0, 64)); // Limit results
      } else {
        renderEmojiGrid(currentEmojiCategory);
      }
    });
  }
  
  // Initial render
  renderEmojiGrid('recent');
}

function renderEmojiGrid(category, customEmojis = null) {
  if (!emojiGrid) return;
  
  const emojis = customEmojis || emojiData[category] || emojiData.recent;
  
  emojiGrid.innerHTML = emojis.map(emoji => 
    `<button class="emoji-item" data-emoji="${emoji}">${emoji}</button>`
  ).join('');
  
  // Add click handlers
  emojiGrid.querySelectorAll('.emoji-item').forEach(item => {
    item.addEventListener('click', () => {
      const emoji = item.dataset.emoji;
      if (messageInput) {
        messageInput.value += emoji;
        messageInput.focus();
      }
      emojiPicker.classList.add('hidden');
    });
  });
}

// Initialize emoji picker on load
document.addEventListener('DOMContentLoaded', initEmojiPicker);

// ==========================================
// USER POPOVER (Sidebar Users)
// ==========================================

let activePopover = null;

function showUserPopover(username, targetElement, inCall = false) {
  // Remove existing popover
  if (activePopover) {
    activePopover.remove();
    activePopover = null;
  }
  
  const rect = targetElement.getBoundingClientRect();
  
  const popover = document.createElement('div');
  popover.className = 'user-popover';
  popover.innerHTML = `
    <div class="user-popover-header">
      <div class="user-popover-avatar">${username.charAt(0).toUpperCase()}</div>
      <div class="user-popover-info">
        <div class="user-popover-name">${username}</div>
        <div class="user-popover-status">
          <span class="user-popover-status-dot ${inCall ? 'in-call' : ''}"></span>
          <span>${inCall ? 'In Voice' : 'Online'}</span>
        </div>
      </div>
    </div>
    <div class="user-popover-body">
      <div class="user-popover-actions">
        <button class="user-popover-action" data-action="message">
          <span class="action-icon">💬</span>
          <span>Message</span>
        </button>
        <button class="user-popover-action" data-action="profile">
          <span class="action-icon">👤</span>
          <span>View Profile</span>
        </button>
        ${username !== currentUser ? `
        <button class="user-popover-action" data-action="mute">
          <span class="action-icon">🔇</span>
          <span>Mute</span>
        </button>
        ` : ''}
      </div>
    </div>
  `;
  
  document.body.appendChild(popover);
  
  // Position popover
  const popoverRect = popover.getBoundingClientRect();
  let left = rect.right + 10;
  let top = rect.top;
  
  // Adjust if off screen
  if (left + popoverRect.width > window.innerWidth) {
    left = rect.left - popoverRect.width - 10;
  }
  if (top + popoverRect.height > window.innerHeight) {
    top = window.innerHeight - popoverRect.height - 10;
  }
  
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  
  activePopover = popover;
  
  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', closePopoverOnClickOutside);
  }, 0);
  
  // Action handlers
  popover.querySelectorAll('.user-popover-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'message') {
        if (username !== currentUser) {
          startDM(username);
          popover.remove();
          activePopover = null;
        } else {
          showToast("You can't DM yourself", 'error');
        }
      } else if (action === 'profile') {
        showToast(`Viewing ${username}'s profile`, 'info');
      } else if (action === 'mute') {
        showToast(`${username} muted`, 'warning');
      }
      popover.remove();
      activePopover = null;
    });
  });
}

function closePopoverOnClickOutside(e) {
  // Don't close if clicking on a user item (new popover will be shown)
  if (e.target.closest('.user-item')) return;
  
  if (activePopover && !activePopover.contains(e.target)) {
    activePopover.remove();
    activePopover = null;
    document.removeEventListener('click', closePopoverOnClickOutside);
  }
}

// ==========================================
// MESSAGE REACTIONS
// ==========================================

const quickReactions = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀'];
let activeReactionPicker = null;

function showReactionPicker(messageEl, messageId) {
  // Remove existing picker
  if (activeReactionPicker) {
    activeReactionPicker.remove();
    activeReactionPicker = null;
  }
  
  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  picker.innerHTML = quickReactions.map(emoji => 
    `<button class="reaction-picker-item" data-emoji="${emoji}">${emoji}</button>`
  ).join('');
  
  messageEl.appendChild(picker);
  activeReactionPicker = picker;
  
  // Position it
  picker.style.position = 'absolute';
  picker.style.bottom = '100%';
  picker.style.left = '0';
  
  // Handle reaction click
  picker.querySelectorAll('.reaction-picker-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      addReactionToMessage(messageEl, btn.dataset.emoji);
      picker.remove();
      activeReactionPicker = null;
    });
  });
  
  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', function closeReactionPicker(e) {
      if (!picker.contains(e.target)) {
        picker.remove();
        activeReactionPicker = null;
        document.removeEventListener('click', closeReactionPicker);
      }
    });
  }, 0);
}

function addReactionToMessage(messageEl, emoji) {
  const reactionsContainer = messageEl.querySelector('.message-reactions');
  
  // Check if reaction already exists
  let existingReaction = reactionsContainer.querySelector(`[data-emoji="${emoji}"]`);
  
  if (existingReaction) {
    // Toggle off if already reacted
    if (existingReaction.classList.contains('active')) {
      const count = parseInt(existingReaction.querySelector('.reaction-count').textContent);
      if (count <= 1) {
        existingReaction.remove();
      } else {
        existingReaction.querySelector('.reaction-count').textContent = count - 1;
        existingReaction.classList.remove('active');
      }
    } else {
      // Add to existing reaction
      const count = parseInt(existingReaction.querySelector('.reaction-count').textContent);
      existingReaction.querySelector('.reaction-count').textContent = count + 1;
      existingReaction.classList.add('active');
    }
  } else {
    // Create new reaction
    const reaction = document.createElement('button');
    reaction.className = 'message-reaction active';
    reaction.dataset.emoji = emoji;
    reaction.innerHTML = `
      <span class="reaction-emoji">${emoji}</span>
      <span class="reaction-count">1</span>
    `;
    
    reaction.addEventListener('click', () => {
      addReactionToMessage(messageEl, emoji);
    });
    
    reactionsContainer.appendChild(reaction);
  }
}

// ==========================================
// TYPING INDICATOR
// ==========================================

let typingTimeout = null;
let isTyping = false;

function setupTypingIndicator() {
  if (!messageInput) return;
  
  messageInput.addEventListener('input', () => {
    if (!isTyping) {
      isTyping = true;
      broadcastTyping(true);
    }
    
    // Clear existing timeout
    if (typingTimeout) clearTimeout(typingTimeout);
    
    // Stop typing after 2 seconds of no input
    typingTimeout = setTimeout(() => {
      isTyping = false;
      broadcastTyping(false);
    }, 2000);
  });
}

function broadcastTyping(typing) {
  if (presenceChannel && currentUser) {
    // Include context about WHERE the user is typing
    const typingContext = isInDM && currentDM ? `dm:${currentDM}` : `channel:${currentRoom || 'general'}`;
    presenceChannel.track({
      user: currentUser,
      online_at: new Date().toISOString(),
      in_call: isInCall || false,
      typing: typing,
      typing_in: typingContext
    });
  }
}

function updateTypingIndicator(state) {
  // Determine current context
  const currentContext = isInDM && currentDM ? `dm:${currentDM}` : `channel:${currentRoom || 'general'}`;
  
  // Only show typing for users in the same context
  const typingUsers = Object.keys(state).filter(user => {
    const userData = state[user][0];
    return userData?.typing && 
           user !== currentUser && 
           userData?.typing_in === currentContext;
  });
  
  let typingIndicator = document.getElementById('typing-indicator');
  
  if (typingUsers.length === 0) {
    if (typingIndicator) typingIndicator.remove();
    return;
  }
  
  if (!typingIndicator) {
    typingIndicator = document.createElement('div');
    typingIndicator.id = 'typing-indicator';
    typingIndicator.className = 'typing-indicator';
    messagesEl.parentNode.insertBefore(typingIndicator, messagesEl.nextSibling);
  }
  
  if (typingUsers.length === 1) {
    typingIndicator.innerHTML = `<span class="typing-dots"></span> ${typingUsers[0]} is typing...`;
  } else if (typingUsers.length === 2) {
    typingIndicator.innerHTML = `<span class="typing-dots"></span> ${typingUsers[0]} and ${typingUsers[1]} are typing...`;
  } else {
    typingIndicator.innerHTML = `<span class="typing-dots"></span> Several people are typing...`;
  }
}

// Initialize typing indicator
document.addEventListener('DOMContentLoaded', setupTypingIndicator);

// ==========================================
// SOUND EFFECTS
// ==========================================

const sounds = {
  message: null,
  mention: null,
  join: null,
  leave: null,
  call: null
};

// Generate sounds using Web Audio API (no external files needed)
function initSounds() {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  
  // Create simple notification sounds
  sounds.message = () => playTone(audioContext, 800, 0.1, 'sine');
  sounds.mention = () => {
    playTone(audioContext, 1000, 0.1, 'sine');
    setTimeout(() => playTone(audioContext, 1200, 0.1, 'sine'), 100);
  };
  sounds.join = () => playTone(audioContext, 600, 0.15, 'sine');
  sounds.leave = () => playTone(audioContext, 400, 0.15, 'sine');
  sounds.call = () => {
    playTone(audioContext, 523, 0.1, 'sine');
    setTimeout(() => playTone(audioContext, 659, 0.1, 'sine'), 120);
    setTimeout(() => playTone(audioContext, 784, 0.15, 'sine'), 240);
  };
}

function playTone(audioContext, frequency, duration, type) {
  if (!soundEnabled) return;
  
  try {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = frequency;
    oscillator.type = type;
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + duration);
  } catch (e) {
    console.log('Sound playback error:', e);
  }
}

function playSound(soundName) {
  if (soundEnabled && sounds[soundName]) {
    sounds[soundName]();
  }
}

// Initialize sounds on first user interaction
document.addEventListener('click', () => {
  if (!sounds.message) {
    initSounds();
  }
}, { once: true });

// ==========================================
// IMAGE/FILE SHARING
// ==========================================

function setupImageSharing() {
  const imageBtn = document.getElementById('image-btn');
  const imageInput = document.getElementById('image-input');
  
  if (!imageBtn || !imageInput) {
    console.log('Image sharing elements not found');
    return;
  }
  
  console.log('Setting up image sharing...');
  
  imageBtn.addEventListener('click', () => {
    imageInput.click();
  });
  
  imageInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Validate file
    if (!file.type.startsWith('image/')) {
      showToast('Only images are supported', 'error');
      return;
    }
    
    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      showToast('Image must be under 5MB', 'error');
      return;
    }
    
    // Convert to base64 and send
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result;
      await sendImageMessage(base64, file.name);
    };
    reader.readAsDataURL(file);
    
    // Reset input
    imageInput.value = '';
  });
  
  // Drag and drop support
  const chatArea = document.querySelector('.chat-area');
  if (chatArea) {
    chatArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      chatArea.classList.add('drag-over');
    });
    
    chatArea.addEventListener('dragleave', () => {
      chatArea.classList.remove('drag-over');
    });
    
    chatArea.addEventListener('drop', async (e) => {
      e.preventDefault();
      chatArea.classList.remove('drag-over');
      
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        if (file.size > 5 * 1024 * 1024) {
          showToast('Image must be under 5MB', 'error');
          return;
        }
        
        const reader = new FileReader();
        reader.onload = async () => {
          await sendImageMessage(reader.result, file.name);
        };
        reader.readAsDataURL(file);
      }
    });
  }
}

async function sendImageMessage(base64, fileName) {
  // Determine the room - could be a channel or DM
  const targetRoom = isInDM ? getDMRoomId(currentUser, currentDM) : currentRoom;
  
  // Store image as special message format: [IMG]base64data
  const { data, error } = await supabaseClient
    .from('messages')
    .insert({
      room: targetRoom,
      username: currentUser,
      content: `[IMG]${base64}`
    })
    .select()
    .single();
  
  if (error) {
    console.error('Error sending image:', error);
    showToast('Failed to send image', 'error');
  } else {
    showToast('Image sent!', 'success');
    
    // If in DM, display our own image and broadcast to recipient
    if (isInDM && currentDM) {
      displayMessage(data);
      scrollToBottom();
      
      // Broadcast to recipient
      const recipientChannel = supabaseClient.channel(`dm-broadcast-${currentDM}`);
      await recipientChannel.send({
        type: 'broadcast',
        event: 'new-dm',
        payload: {
          from: currentUser,
          to: currentDM,
          content: data.content,
          room: targetRoom,
          messageData: data
        }
      });
    }
  }
}

// Enhanced displayMessage to handle images
function displayMessageWithImage(msg) {
  const isOwn = msg.username === currentUser;
  const time = new Date(msg.created_at).toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  const messageEl = document.createElement('div');
  messageEl.className = `message ${isOwn ? 'own' : ''}`;
  messageEl.dataset.messageId = msg.id;
  
  let contentHtml = '';
  
  if (msg.image_data) {
    contentHtml = `
      <div class="message-image">
        <img src="${msg.image_data}" alt="Shared image" onclick="openImageViewer(this.src)">
      </div>
    `;
  } else {
    contentHtml = `<div class="text">${escapeHtml(msg.content)}</div>`;
  }
  
  messageEl.innerHTML = `
    <div class="message-header">
      <span class="author">${msg.username}</span>
      <span class="time">${time}</span>
    </div>
    ${contentHtml}
    <div class="message-actions">
      <button class="message-action-btn" data-action="react" title="Add Reaction">😀</button>
      <button class="message-action-btn" data-action="reply" title="Reply">↩️</button>
    </div>
    <div class="message-reactions"></div>
  `;
  
  // Add reaction handler
  const reactBtn = messageEl.querySelector('[data-action="react"]');
  reactBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showReactionPicker(messageEl, msg.id);
  });
  
  // Add reply handler
  const replyBtn = messageEl.querySelector('[data-action="reply"]');
  replyBtn.addEventListener('click', () => {
    messageInput.value = `@${msg.username} `;
    messageInput.focus();
  });
  
  messagesEl.appendChild(messageEl);
  
  // Play sound for new messages from others
  if (!isOwn && messageCount > 0) {
    if (msg.content.includes(`@${currentUser}`)) {
      playSound('mention');
    } else {
      playSound('message');
    }
  }
  messageCount++;
}

// Image viewer modal
function openImageViewer(src) {
  const viewer = document.createElement('div');
  viewer.className = 'image-viewer';
  viewer.innerHTML = `
    <div class="image-viewer-backdrop"></div>
    <div class="image-viewer-content">
      <img src="${src}" alt="Full size image">
      <button class="image-viewer-close">✕</button>
    </div>
  `;
  
  document.body.appendChild(viewer);
  
  // Close handlers
  viewer.querySelector('.image-viewer-backdrop').addEventListener('click', () => viewer.remove());
  viewer.querySelector('.image-viewer-close').addEventListener('click', () => viewer.remove());
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') {
      viewer.remove();
      document.removeEventListener('keydown', escHandler);
    }
  });
}

// Make openImageViewer globally accessible
window.openImageViewer = openImageViewer;

// Initialize image sharing
document.addEventListener('DOMContentLoaded', setupImageSharing);

// ==========================================
// MESSAGE SEARCH
// ==========================================

function setupMessageSearch() {
  const searchToggle = document.getElementById('search-toggle-btn');
  const searchBar = document.getElementById('search-bar');
  const searchInput = document.getElementById('search-input');
  const searchClose = document.getElementById('search-close');
  const searchPrev = document.getElementById('search-prev');
  const searchNext = document.getElementById('search-next');
  const searchCount = document.getElementById('search-results-count');
  
  if (!searchToggle || !searchBar) return;
  
  // Toggle search bar
  searchToggle.addEventListener('click', () => {
    searchBar.classList.toggle('hidden');
    if (!searchBar.classList.contains('hidden')) {
      searchInput.focus();
    } else {
      clearSearch();
    }
  });
  
  // Close search
  searchClose.addEventListener('click', () => {
    searchBar.classList.add('hidden');
    clearSearch();
  });
  
  // Escape to close
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchBar.classList.add('hidden');
      clearSearch();
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        navigateSearch(-1);
      } else {
        navigateSearch(1);
      }
    }
  });
  
  // Search on input
  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      performSearch(searchInput.value);
    }, 200);
  });
  
  // Navigation buttons
  searchPrev.addEventListener('click', () => navigateSearch(-1));
  searchNext.addEventListener('click', () => navigateSearch(1));
}

function performSearch(query) {
  clearSearchHighlights();
  searchResults = [];
  currentSearchIndex = 0;
  
  const searchCount = document.getElementById('search-results-count');
  
  if (!query.trim()) {
    searchCount.textContent = '';
    return;
  }
  
  const messages = document.querySelectorAll('.message:not(.system)');
  const lowerQuery = query.toLowerCase();
  
  messages.forEach(msg => {
    const textEl = msg.querySelector('.text');
    if (textEl) {
      const text = textEl.textContent.toLowerCase();
      if (text.includes(lowerQuery)) {
        searchResults.push(msg);
        msg.classList.add('search-match');
      }
    }
  });
  
  if (searchResults.length > 0) {
    searchCount.textContent = `${currentSearchIndex + 1}/${searchResults.length}`;
    highlightCurrentResult();
  } else {
    searchCount.textContent = 'No results';
  }
}

function clearSearch() {
  searchResults = [];
  currentSearchIndex = 0;
  clearSearchHighlights();
  const searchInput = document.getElementById('search-input');
  const searchCount = document.getElementById('search-results-count');
  if (searchInput) searchInput.value = '';
  if (searchCount) searchCount.textContent = '';
}

function clearSearchHighlights() {
  document.querySelectorAll('.search-match').forEach(el => {
    el.classList.remove('search-match');
  });
  document.querySelectorAll('.search-current').forEach(el => {
    el.classList.remove('search-current');
  });
}

function highlightCurrentResult() {
  document.querySelectorAll('.search-current').forEach(el => {
    el.classList.remove('search-current');
  });
  
  if (searchResults[currentSearchIndex]) {
    const current = searchResults[currentSearchIndex];
    current.classList.add('search-current');
    current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function navigateSearch(direction) {
  if (searchResults.length === 0) return;
  
  currentSearchIndex += direction;
  
  if (currentSearchIndex >= searchResults.length) {
    currentSearchIndex = 0;
  } else if (currentSearchIndex < 0) {
    currentSearchIndex = searchResults.length - 1;
  }
  
  const searchCount = document.getElementById('search-results-count');
  searchCount.textContent = `${currentSearchIndex + 1}/${searchResults.length}`;
  
  highlightCurrentResult();
}

// Initialize search
document.addEventListener('DOMContentLoaded', setupMessageSearch);

// ==========================================
// ROOM SWITCHING
// ==========================================

function setupRoomSwitcher() {
  const roomList = document.getElementById('room-list');
  const addRoomBtn = document.getElementById('add-room-btn');
  
  if (!roomList) return;
  
  // Click handler for room items
  roomList.addEventListener('click', async (e) => {
    const roomItem = e.target.closest('.room-item');
    if (!roomItem) return;
    
    const newRoom = roomItem.dataset.room;
    if (newRoom === currentRoom) return;
    
    await switchRoom(newRoom);
  });
  
  // Add room button
  if (addRoomBtn) {
    addRoomBtn.addEventListener('click', showCreateRoomModal);
  }
}

async function switchRoom(newRoom) {
  // Don't switch if same room (and not in DM)
  if (newRoom === currentRoom && !isInDM) return;
  
  // Exit DM mode
  isInDM = false;
  currentDM = null;
  
  // Remove old messages subscription only (keep presence global)
  if (messagesSubscription) {
    supabaseClient.removeChannel(messagesSubscription);
    messagesSubscription = null;
  }
  
  // Clear messages
  messagesEl.innerHTML = '';
  messageCount = 0;
  
  // Update current room
  currentRoom = newRoom;
  
  // Update UI immediately for responsiveness
  document.querySelectorAll('.room-item').forEach(item => {
    item.classList.toggle('active', item.dataset.room === newRoom);
  });
  document.querySelectorAll('.dm-item').forEach(item => {
    item.classList.remove('active');
  });
  
  // Update chat header
  const chatHeaderName = document.querySelector('.chat-header-name');
  const chatHeaderIcon = document.querySelector('.chat-header-icon');
  if (chatHeaderName) {
    chatHeaderName.textContent = newRoom;
  }
  if (chatHeaderIcon) {
    chatHeaderIcon.textContent = '#';
  }
  
  // Load messages for new room
  await loadMessages();
  
  // Subscribe to new messages
  messagesSubscription = supabaseClient
    .channel(`messages:${currentRoom}:${Date.now()}`)
    .on('postgres_changes', 
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `room=eq.${currentRoom}` },
      (payload) => {
        displayMessage(payload.new);
        scrollToBottom();
      }
    )
    .subscribe();
  
  // Just add system message
  addSystemMessage(`Joined #${newRoom}`);
  scrollToBottom();
}

function showCreateRoomModal() {
  const modal = document.createElement('div');
  modal.className = 'create-room-modal-overlay';
  modal.innerHTML = `
    <div class="create-room-modal">
      <div class="create-room-header">
        <h3>Create Channel</h3>
        <button class="create-room-close">✕</button>
      </div>
      <div class="create-room-body">
        <label>Channel Name</label>
        <input type="text" id="new-room-name" placeholder="e.g. music" maxlength="20">
        <p class="create-room-hint">Lowercase letters, numbers, and hyphens only</p>
      </div>
      <div class="create-room-footer">
        <button class="btn btn-secondary cancel-btn">Cancel</button>
        <button class="btn btn-primary create-btn">Create</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const input = modal.querySelector('#new-room-name');
  const createBtn = modal.querySelector('.create-btn');
  const cancelBtn = modal.querySelector('.cancel-btn');
  const closeBtn = modal.querySelector('.create-room-close');
  
  input.focus();
  
  // Sanitize input
  input.addEventListener('input', () => {
    input.value = input.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
  });
  
  const createRoom = async () => {
    const roomName = input.value.trim();
    if (!roomName) {
      showToast('Please enter a room name', 'error');
      return;
    }
    
    // Add to room list
    const roomList = document.getElementById('room-list');
    const existingRoom = roomList.querySelector(`[data-room="${roomName}"]`);
    
    if (existingRoom) {
      showToast('Channel already exists', 'error');
      return;
    }
    
    // Try to save channel to database (if table exists)
    try {
      await supabaseClient
        .from('channels')
        .upsert({ name: roomName, created_by: currentUser }, { onConflict: 'name' });
    } catch (e) {
      console.log('Channels table may not exist, using broadcast');
    }
    
    // Broadcast channel creation to other users
    if (channelBroadcast) {
      await channelBroadcast.send({
        type: 'broadcast',
        event: 'new-channel',
        payload: { name: roomName, created_by: currentUser }
      });
    }
    
    const newRoomEl = document.createElement('div');
    newRoomEl.className = 'room-item';
    newRoomEl.dataset.room = roomName;
    newRoomEl.innerHTML = `
      <span class="room-icon">#</span>
      <span class="room-name">${roomName}</span>
    `;
    roomList.appendChild(newRoomEl);
    
    modal.remove();
    switchRoom(roomName);
  };
  
  createBtn.addEventListener('click', createRoom);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createRoom();
    if (e.key === 'Escape') modal.remove();
  });
  cancelBtn.addEventListener('click', () => modal.remove());
  closeBtn.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

// Initialize room switcher
document.addEventListener('DOMContentLoaded', setupRoomSwitcher);

// ==========================================
// CHANNEL SYNC
// ==========================================

async function loadChannelsFromDB() {
  const { data, error } = await supabaseClient
    .from('channels')
    .select('name')
    .order('created_at', { ascending: true });
  
  if (error) {
    console.log('No channels table or error:', error.message);
    return;
  }
  
  const roomList = document.getElementById('room-list');
  if (!roomList || !data) return;
  
  // Add any channels that don't already exist in the DOM
  data.forEach(channel => {
    const existingRoom = roomList.querySelector(`[data-room="${channel.name}"]`);
    if (!existingRoom) {
      const newRoomEl = document.createElement('div');
      newRoomEl.className = 'room-item';
      newRoomEl.dataset.room = channel.name;
      newRoomEl.innerHTML = `
        <span class="room-icon">#</span>
        <span class="room-name">${channel.name}</span>
      `;
      roomList.appendChild(newRoomEl);
    }
  });
}

// Subscribe to new channels created by other users (using broadcast)
let channelBroadcast = null;

function subscribeToChannels() {
  console.log('Setting up channel broadcast subscription...');
  channelBroadcast = supabaseClient.channel('channel-broadcast', {
    config: { broadcast: { self: false } } // Don't receive own broadcasts
  });
  
  channelBroadcast
    .on('broadcast', { event: 'new-channel' }, (payload) => {
      console.log('Channel broadcast received:', payload);
      const roomList = document.getElementById('room-list');
      if (!roomList) return;
      
      const channelName = payload.payload.name;
      const existingRoom = roomList.querySelector(`[data-room="${channelName}"]`);
      
      if (!existingRoom) {
        const newRoomEl = document.createElement('div');
        newRoomEl.className = 'room-item';
        newRoomEl.dataset.room = channelName;
        newRoomEl.innerHTML = `
          <span class="room-icon">#</span>
          <span class="room-name">${channelName}</span>
        `;
        roomList.appendChild(newRoomEl);
        showToast(`New channel #${channelName} created`, 'info');
      }
    })
    .subscribe((status) => {
      console.log('Channel broadcast subscription status:', status);
    });
}

// ==========================================
// GLOBAL DM LISTENER
// ==========================================

let dmNotificationSubscription = null;
let dmBroadcastChannel = null;

function subscribeToAllDMs() {
  console.log('Setting up DM subscription for:', currentUser);
  
  // Use broadcast channel for DMs (more reliable than postgres_changes)
  dmBroadcastChannel = supabaseClient.channel(`dm-broadcast-${currentUser}`, {
    config: { broadcast: { self: false } }
  });
  
  dmBroadcastChannel
    .on('broadcast', { event: 'new-dm' }, (payload) => {
      console.log('DM broadcast received:', payload);
      const { from, to, content, room, messageData } = payload.payload;
      
      // Check if this DM is for us
      if (to === currentUser && from !== currentUser) {
        console.log('DM is for us from:', from);
        
        // Add sender to DM list if not there
        if (!activeDMs.includes(from)) {
          activeDMs.push(from);
          saveDMList();
        }
        
        // If we're currently viewing this DM, DON'T display here
        // The openDM postgres subscription will handle it to avoid duplicates
        if (isInDM && currentDM === from) {
          // Message will be displayed by openDM subscription
          console.log('Viewing this DM, letting openDM subscription handle display');
        } else {
          // Increment unread count
          unreadDMs[from] = (unreadDMs[from] || 0) + 1;
          // Show notification
          showDesktopNotification(`DM from ${from}`, content);
          showToast(`New message from ${from}`, 'info');
        }
        
        // Always re-render to update unread badges
        renderDMList();
      }
    })
    .subscribe((status) => {
      console.log('DM broadcast subscription status:', status);
    });
  
  // Also keep postgres_changes as backup
  dmNotificationSubscription = supabaseClient
    .channel(`dm-notifications-${currentUser}-${Date.now()}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => {
        console.log('DM postgres_changes received:', payload);
        const room = payload.new.room;
        const sender = payload.new.username;
        
        // Check if this is a DM for us
        if (room && room.startsWith('dm_') && sender !== currentUser) {
          // Check if this DM involves us (format: dm_user1_user2)
          const parts = room.substring(3).split('_');
          if (parts.length === 2 && (parts[0] === currentUser || parts[1] === currentUser)) {
            // Add sender to DM list if not there
            if (!activeDMs.includes(sender)) {
              activeDMs.push(sender);
              saveDMList();
              renderDMList();
            }
            
            // If we're currently viewing this DM, display the message
            if (isInDM && currentDM === sender) {
              // Check if message already displayed (from broadcast)
              const existingMsg = document.querySelector(`[data-message-id="${payload.new.id}"]`);
              if (!existingMsg) {
                displayMessage(payload.new);
                scrollToBottom();
              }
            } else {
              showDesktopNotification(`DM from ${sender}`, payload.new.content);
              showToast(`New message from ${sender}`, 'info');
            }
          }
        }
      }
    )
    .subscribe((status) => {
      console.log('DM postgres subscription status:', status);
    });
}

// ==========================================
// URL LINK PREVIEWS
// ==========================================

function linkifyText(text) {
  // URL regex
  const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
  
  return text.replace(urlRegex, (url) => {
    return `<a href="${url}" class="message-link" target="_blank" rel="noopener">${url}</a>`;
  });
}

// ==========================================
// DIRECT MESSAGES
// ==========================================

function getDMRoomId(user1, user2) {
  // Create consistent room ID regardless of order
  // Use underscores instead of colons to avoid PostgreSQL filter issues
  const sorted = [user1, user2].sort();
  return `dm_${sorted[0]}_${sorted[1]}`;
}

function loadDMList() {
  // Load DM list from localStorage
  try {
    const stored = localStorage.getItem(`toy_dms_${currentUser}`);
    activeDMs = stored ? JSON.parse(stored) : [];
    renderDMList();
  } catch {
    activeDMs = [];
  }
}

function saveDMList() {
  localStorage.setItem(`toy_dms_${currentUser}`, JSON.stringify(activeDMs));
}

// Track unread DMs
let unreadDMs = {};

function renderDMList() {
  const dmList = document.getElementById('dm-list');
  if (!dmList) return;
  
  dmList.innerHTML = activeDMs.map(username => {
    const unreadCount = unreadDMs[username] || 0;
    return `
    <div class="dm-item ${currentDM === username ? 'active' : ''}" data-user="${username}">
      <div class="dm-avatar">${username.charAt(0).toUpperCase()}</div>
      <span class="dm-name">${username}</span>
      ${unreadCount > 0 ? `<span class="dm-unread">${unreadCount}</span>` : ''}
    </div>
  `;
  }).join('');
  
  // Add click handlers
  dmList.querySelectorAll('.dm-item').forEach(item => {
    item.addEventListener('click', () => {
      const user = item.dataset.user;
      // Clear unread count when opening DM
      unreadDMs[user] = 0;
      openDM(user);
    });
  });
}

function startDM(username) {
  if (username === currentUser) {
    showToast("You can't DM yourself", 'error');
    return;
  }
  
  // Add to DM list if not already there
  if (!activeDMs.includes(username)) {
    activeDMs.push(username);
    saveDMList();
    renderDMList();
  }
  
  openDM(username);
}

async function openDM(username) {
  // Remove old subscription
  if (messagesSubscription) {
    supabaseClient.removeChannel(messagesSubscription);
    messagesSubscription = null;
  }
  
  // Set DM state
  currentDM = username;
  isInDM = true;
  
  // Clear unread count for this DM
  unreadDMs[username] = 0;
  
  // Clear messages
  messagesEl.innerHTML = '';
  messageCount = 0;
  
  // Update UI - deselect channels
  document.querySelectorAll('.room-item').forEach(item => {
    item.classList.remove('active');
  });
  
  // Re-render DM list to update unread badges
  renderDMList();
  
  // Update chat header
  const chatHeaderName = document.querySelector('.chat-header-name');
  const chatHeaderIcon = document.querySelector('.chat-header-icon');
  if (chatHeaderName) chatHeaderName.textContent = username;
  if (chatHeaderIcon) chatHeaderIcon.textContent = '@';
  
  // Load DM messages
  const dmRoom = getDMRoomId(currentUser, username);
  const { data, error } = await supabaseClient
    .from('messages')
    .select('*')
    .eq('room', dmRoom)
    .order('created_at', { ascending: true })
    .limit(50);
  
  if (!error && data) {
    data.forEach(msg => displayMessage(msg));
  }
  
  // Subscribe to new DM messages (only for messages from the OTHER user)
  // Our own messages are displayed immediately when sent
  messagesSubscription = supabaseClient
    .channel(`dm:${dmRoom}:${Date.now()}`)
    .on('postgres_changes', 
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `room=eq.${dmRoom}` },
      (payload) => {
        // Only display if it's from the other user (our messages are shown when sent)
        // And check if not already displayed
        const existingMsg = document.querySelector(`[data-message-id="${payload.new.id}"]`);
        if (!existingMsg && payload.new.username !== currentUser) {
          displayMessage(payload.new);
          scrollToBottom();
        }
      }
    )
    .subscribe();
  
  scrollToBottom();
}

// ==========================================
// DESKTOP NOTIFICATIONS
// ==========================================

let notificationsEnabled = false;

async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.log('Notifications not supported');
    return false;
  }
  
  if (Notification.permission === 'granted') {
    notificationsEnabled = true;
    return true;
  }
  
  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    notificationsEnabled = permission === 'granted';
    return notificationsEnabled;
  }
  
  return false;
}

function showDesktopNotification(title, body) {
  if (!notificationsEnabled) return;
  
  // Don't show if window is focused
  if (document.hasFocus()) return;
  
  // Truncate long messages
  const truncatedBody = body.length > 100 ? body.substring(0, 100) + '...' : body;
  
  const notification = new Notification(title, {
    body: truncatedBody,
    icon: '💬',
    silent: false
  });
  
  notification.onclick = () => {
    window.focus();
    notification.close();
  };
  
  // Auto close after 5 seconds
  setTimeout(() => notification.close(), 5000);
}

// Request notification permission on load
document.addEventListener('DOMContentLoaded', () => {
  requestNotificationPermission();
});

// ==========================================
// UTILITY
// ==========================================

console.log('Toy Chat initialized!');
