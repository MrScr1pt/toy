// ==========================================
// TOY CHAT - Main Application
// ==========================================

// Display app version
if (window.electronAPI) {
  window.electronAPI.getAppVersion().then(version => {
    const versionEl = document.getElementById('version-display');
    if (versionEl) versionEl.textContent = `v${version}`;
  });
}

// Configuration
const SUPABASE_URL = 'https://wnyxdfoydxsbkhtujsxm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndueXhkZm95ZHhzYmtodHVqc3htIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU0NjMyMzgsImV4cCI6MjA4MTAzOTIzOH0.S062HvJChSfAOdwErBQYN1NCz6LbaxkSFuR2RJjpMEk';
const LIVEKIT_URL = 'wss://toy-cymt5c00.livekit.cloud';

// Initialize Supabase
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// App State
let currentUser = null;
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

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const usernameInput = document.getElementById('username-input');
const roomInput = document.getElementById('room-input');
const joinBtn = document.getElementById('join-btn');
const leaveBtn = document.getElementById('leave-btn');
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

// ==========================================
// INITIALIZATION
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
});

function setupEventListeners() {
  joinBtn.addEventListener('click', joinRoom);
  usernameInput.addEventListener('keypress', (e) => e.key === 'Enter' && joinRoom());
  roomInput.addEventListener('keypress', (e) => e.key === 'Enter' && joinRoom());
  leaveBtn.addEventListener('click', leaveRoom);
  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keypress', (e) => e.key === 'Enter' && sendMessage());
  
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
}

// ==========================================
// ROOM MANAGEMENT
// ==========================================

async function joinRoom() {
  const username = usernameInput.value.trim();
  const room = roomInput.value.trim() || 'general';
  
  if (!username) {
    showLoginError('Please enter a username');
    return;
  }
  
  // Check if username is already taken in this room
  const isTaken = await checkUsernameTaken(username, room);
  if (isTaken) {
    showLoginError('Username is already taken in this room. Please choose another.');
    return;
  }
  
  currentUser = username;
  currentRoom = room;
  
  // Switch screens
  loginScreen.classList.remove('active');
  chatScreen.classList.add('active');
  
  // Update UI
  roomNameEl.textContent = `Room: ${currentRoom}`;
  currentUserEl.textContent = currentUser;
  
  // Initialize services
  await initializePresence();
  await loadMessages();
  subscribeToMessages();
  
  addSystemMessage(`You joined the room "${currentRoom}"`);
}

async function checkUsernameTaken(username, room) {
  // Create a temporary channel to check presence
  const tempChannel = supabase.channel(`presence:${room}`);
  
  return new Promise((resolve) => {
    tempChannel.on('presence', { event: 'sync' }, () => {
      const state = tempChannel.presenceState();
      const users = Object.keys(state);
      const taken = users.includes(username);
      tempChannel.unsubscribe();
      resolve(taken);
    }).subscribe();
    
    // Timeout after 3 seconds
    setTimeout(() => {
      tempChannel.unsubscribe();
      resolve(false);
    }, 3000);
  });
}

function showLoginError(message) {
  let errorEl = document.querySelector('.login-error');
  if (!errorEl) {
    errorEl = document.createElement('p');
    errorEl.className = 'login-error';
    document.querySelector('.login-container').appendChild(errorEl);
  }
  errorEl.textContent = message;
}

async function leaveRoom() {
  // Cleanup
  if (isInCall) {
    await leaveCall();
  }
  
  if (messagesSubscription) {
    messagesSubscription.unsubscribe();
  }
  
  if (presenceChannel) {
    await presenceChannel.unsubscribe();
  }
  
  // Reset state
  currentUser = null;
  currentRoom = 'general';
  messagesEl.innerHTML = '';
  usersListEl.innerHTML = '';
  
  // Switch screens
  chatScreen.classList.remove('active');
  loginScreen.classList.add('active');
}

// ==========================================
// PRESENCE (Online Users)
// ==========================================

async function initializePresence() {
  presenceChannel = supabase.channel(`presence:${currentRoom}`, {
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
      updateUsersList(state);
      
      // Mark all current users as seen
      Object.keys(state).forEach(user => seenUsers.add(user));
    })
    .on('presence', { event: 'join' }, ({ key, newPresences }) => {
      if (key !== currentUser && !seenUsers.has(key)) {
        addSystemMessage(`${key} joined the room`);
        seenUsers.add(key);
      }
    })
    .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
      // Check if user is still in the room (just updating presence) or actually left
      const state = presenceChannel.presenceState();
      if (!state[key] && key !== currentUser) {
        addSystemMessage(`${key} left the room`);
        seenUsers.delete(key);
      }
    });
  
  await presenceChannel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await presenceChannel.track({
        user: currentUser,
        online_at: new Date().toISOString(),
        in_call: false,
      });
    }
  });
}

function updateUsersList(state) {
  const users = Object.keys(state);
  userCountEl.textContent = `${users.length} online`;
  
  usersListEl.innerHTML = users.map(user => {
    const userData = state[user][0];
    const inCall = userData?.in_call;
    return `
      <li class="${inCall ? 'in-call' : ''}">
        <span class="status"></span>
        ${user} ${inCall ? '🎤' : ''}
      </li>
    `;
  }).join('');
}

// ==========================================
// TEXT CHAT
// ==========================================

async function loadMessages() {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('room', currentRoom)
    .order('created_at', { ascending: true })
    .limit(50);
  
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
  messagesSubscription = supabase
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
      }
    )
    .subscribe();
}

async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;
  
  messageInput.value = '';
  
  const { error } = await supabase
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

function displayMessage(msg) {
  const isOwn = msg.username === currentUser;
  const time = new Date(msg.created_at).toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  const messageEl = document.createElement('div');
  messageEl.className = `message ${isOwn ? 'own' : ''}`;
  messageEl.innerHTML = `
    <div class="author">${msg.username}</div>
    <div class="text">${escapeHtml(msg.content)}</div>
    <div class="time">${time}</div>
  `;
  
  messagesEl.appendChild(messageEl);
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
// VOICE/VIDEO CHAT (LiveKit)
// ==========================================

async function joinCall() {
  try {
    addSystemMessage('Connecting to voice/video...');
    
    // Get token from Supabase Edge Function
    const { data, error } = await supabase.functions.invoke('livekit-token', {
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
// UTILITY
// ==========================================

console.log('Toy Chat initialized!');
