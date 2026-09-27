/**
 * WhisperDuo - Main Controller (WhatsApp-Style Call Experience)
 * - Initiates as Voice Call by default
 * - Live Call Duration Timer & WhatsApp Ringing state
 * - Audio speech detection for glowing avatar pulse
 * - 1-tap seamless conversion to Video Call with Front/Rear flip
 * - Reliable two-way Video & Audio Casting
 * - AES-256-GCM E2EE DataChannel & Low Tower Signal Telemetry
 */

class WhisperApp {
  constructor() {
    this.crypto = new DuoCrypto();
    this.webrtc = null;
    this.localStream = null;

    // Call state
    this.isCallActive = false;
    this.isMicMuted = false;
    this.isVideoActive = false;
    this.peerVideoActive = false;
    this.isLowSignalMode = false;
    this.isChatOpen = false;
    this.unreadMessages = 0;

    // Call Timer
    this.callTimerInterval = null;
    this.callSeconds = 0;

    // Audio Speech Analyser
    this.audioContext = null;
    this.analyser = null;
    this.vuAnimationId = null;

    this.dom = {};
  }

  async init() {
    this.cacheDom();
    this.bindEvents();
    this.parseUrlHash();
    await this.initLobbyAudio();
  }

  cacheDom() {
    this.dom = {
      mainNavbar: document.getElementById('main-navbar'),
      lobbyView: document.getElementById('lobby-view'),
      callView: document.getElementById('call-view'),
      roomInput: document.getElementById('room-input'),
      passphraseInput: document.getElementById('passphrase-input'),
      btnGenRoom: document.getElementById('btn-gen-room'),
      btnGenKey: document.getElementById('btn-gen-key'),
      btnTogglePwd: document.getElementById('btn-toggle-pwd'),
      btnCopyInvite: document.getElementById('btn-copy-invite'),
      btnJoinRoom: document.getElementById('btn-join-room'),

      // Lobby Meter
      audioMeterFill: document.getElementById('audio-meter-fill'),

      // Call Stage Elements
      callPartnerName: document.getElementById('call-partner-name'),
      callStatusTimer: document.getElementById('call-status-timer'),
      voiceStage: document.getElementById('voice-stage-center'),
      videoStage: document.getElementById('video-stage-container'),
      callerAvatar: document.getElementById('caller-avatar'),
      btnQuickUpgradeVideo: document.getElementById('btn-quick-upgrade-video'),

      // Videos
      remoteVideo: document.getElementById('remote-video'),
      localVideo: document.getElementById('local-video'),
      remoteCamOffOverlay: document.getElementById('remote-cam-off-overlay'),

      // HUD & Indicators
      hudSignalBtn: document.getElementById('hud-signal-btn'),
      hudSignalLabel: document.getElementById('hud-signal-label'),
      hudE2eeVerify: document.getElementById('hud-e2ee-verify'),
      sigBars: [
        document.getElementById('sig-bar-1'),
        document.getElementById('sig-bar-2'),
        document.getElementById('sig-bar-3'),
        document.getElementById('sig-bar-4'),
        document.getElementById('sig-bar-5')
      ],

      // Bottom WhatsApp Controls
      btnCallMic: document.getElementById('btn-call-mic'),
      btnCallVideo: document.getElementById('btn-call-video'),
      btnCallFlip: document.getElementById('btn-call-flip'),
      btnCallLowSignal: document.getElementById('btn-call-low-signal'),
      btnCallChat: document.getElementById('btn-call-chat'),
      btnCallEnd: document.getElementById('btn-call-end'),
      chatUnreadBadge: document.getElementById('chat-unread-badge'),

      // Chat Drawer
      chatDrawer: document.getElementById('chat-drawer'),
      btnCloseChat: document.getElementById('btn-close-chat'),
      btnClearChat: document.getElementById('btn-clear-chat'),
      chatMessagesContainer: document.getElementById('chat-messages-container'),
      chatInput: document.getElementById('chat-input'),

      // Modals & Banner
      modalSafety: document.getElementById('modal-safety'),
      modalTelemetry: document.getElementById('modal-telemetry'),
      modalRejected: document.getElementById('modal-rejected'),
      rejectedMessage: document.getElementById('rejected-message'),
      safetyEmojis: document.getElementById('safety-emojis'),
      safetyDigits: document.getElementById('safety-digits'),
      toastBanner: document.getElementById('toast-banner'),
      toastText: document.getElementById('toast-text'),

      // Stats
      statRtt: document.getElementById('stat-rtt'),
      statLoss: document.getElementById('stat-loss'),
      statBitrate: document.getElementById('stat-bitrate'),
      statJitter: document.getElementById('stat-jitter')
    };
  }

  bindEvents() {
    this.dom.btnGenRoom.addEventListener('click', () => {
      this.dom.roomInput.value = this.generateRoomName();
      this.updateUrlHash();
    });

    this.dom.btnGenKey.addEventListener('click', () => {
      this.dom.passphraseInput.value = DuoCrypto.generateRandomSecret();
      this.updateUrlHash();
    });

    this.dom.btnTogglePwd.addEventListener('click', () => {
      const type = this.dom.passphraseInput.getAttribute('type') === 'password' ? 'text' : 'password';
      this.dom.passphraseInput.setAttribute('type', type);
    });

    this.dom.btnCopyInvite.addEventListener('click', () => this.copyInviteLink());
    this.dom.roomInput.addEventListener('input', () => this.updateUrlHash());
    this.dom.passphraseInput.addEventListener('input', () => this.updateUrlHash());

    // Call Action Controls
    this.dom.btnCallMic.addEventListener('click', () => this.toggleMic());
    this.dom.btnCallVideo.addEventListener('click', () => this.toggleVideo());
    this.dom.btnQuickUpgradeVideo.addEventListener('click', () => this.toggleVideo());
    this.dom.btnCallFlip.addEventListener('click', () => this.flipCamera());
    this.dom.btnCallLowSignal.addEventListener('click', () => this.toggleLowSignalMode());
    this.dom.btnCallChat.addEventListener('click', () => this.toggleChatDrawer());
    this.dom.btnCallEnd.addEventListener('click', () => this.endCall());

    // Chat Drawer
    this.dom.btnCloseChat.addEventListener('click', () => this.toggleChatDrawer(false));
    this.dom.btnClearChat.addEventListener('click', () => this.clearChatHistory());

    // Modals
    this.dom.hudSignalBtn.addEventListener('click', () => this.openModal('modal-telemetry'));
    this.dom.hudE2eeVerify.addEventListener('click', () => this.openModal('modal-safety'));
  }

  generateRoomName() {
    const adjectives = ['stealth', 'quantum', 'cipher', 'silent', 'aurora', 'shadow', 'secure'];
    const nouns = ['falcon', 'panther', 'viper', 'matrix', 'echo', 'pulse', 'orbit'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(10 + Math.random() * 90);
    return `${adj}-${noun}-${num}`;
  }

  parseUrlHash() {
    const hash = window.location.hash.substring(1);
    if (hash) {
      const params = new URLSearchParams(hash);
      const room = params.get('room');
      const key = params.get('key');
      if (room) this.dom.roomInput.value = room;
      if (key) this.dom.passphraseInput.value = key;
    }

    if (!this.dom.roomInput.value) this.dom.roomInput.value = this.generateRoomName();
    if (!this.dom.passphraseInput.value) this.dom.passphraseInput.value = DuoCrypto.generateRandomSecret();
    this.updateUrlHash();
  }

  updateUrlHash() {
    const room = encodeURIComponent(this.dom.roomInput.value.trim());
    const key = encodeURIComponent(this.dom.passphraseInput.value.trim());
    if (room && key) {
      window.history.replaceState(null, '', `#room=${room}&key=${key}`);
    }
  }

  copyInviteLink() {
    this.updateUrlHash();
    navigator.clipboard.writeText(window.location.href).then(() => {
      this.showToast('Secure room link copied to clipboard!', false);
    }).catch(() => {
      prompt('Copy this link:', window.location.href);
    });
  }

  showToast(text, isWarning = false) {
    this.dom.toastText.textContent = text;
    this.dom.toastBanner.className = isWarning ? 'toast-banner show warning' : 'toast-banner show';
    setTimeout(() => {
      this.dom.toastBanner.className = 'toast-banner';
    }, 4000);
  }

  async initLobbyAudio() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.setupAudioAnalyser(this.localStream);
    } catch (err) {
      console.warn('Lobby mic permission error:', err);
    }
  }

  setupAudioAnalyser(stream) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 64;
      source.connect(this.analyser);

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      const renderVU = () => {
        if (!this.analyser) return;
        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;

        // Lobby VU bar
        if (this.dom.audioMeterFill) {
          const pct = Math.min(100, Math.round((avg / 128) * 100));
          this.dom.audioMeterFill.style.width = `${pct}%`;
        }

        // WhatsApp Caller Avatar active speaking glow
        if (this.isCallActive && this.dom.callerAvatar) {
          if (avg > 18) {
            this.dom.callerAvatar.classList.add('speaking');
          } else {
            this.dom.callerAvatar.classList.remove('speaking');
          }
        }

        this.vuAnimationId = requestAnimationFrame(renderVU);
      };
      renderVU();
    } catch (e) {
      console.warn('Audio analyser error:', e);
    }
  }

  /**
   * Starts call (Voice-first mode)
   */
  async joinRoom() {
    const roomId = this.dom.roomInput.value.trim();
    const passphrase = this.dom.passphraseInput.value.trim();

    if (!roomId || !passphrase) {
      alert('Please provide both Room ID and Passphrase');
      return;
    }

    this.dom.btnJoinRoom.disabled = true;
    this.dom.btnJoinRoom.textContent = 'Calling...';

    // 1. Derive 256-bit AES-GCM Key & Visual Safety Fingerprint
    const fingerprint = await this.crypto.initKey(passphrase, `salt-room-${roomId}`);
    this.dom.safetyEmojis.textContent = fingerprint.emojis;
    this.dom.safetyDigits.textContent = fingerprint.digits;

    // 2. Initialize WebRTC Manager
    this.webrtc = new WebRTCManager({
      cryptoEngine: this.crypto,
      onRemoteStream: (stream, track) => this.handleRemoteStream(stream, track),
      onDataMessage: (msg) => this.handleDataMessage(msg),
      onConnectionState: (state) => this.handleConnectionState(state),
      onSignalUpdate: (stats) => this.handleSignalStats(stats),
      onPeerVideoState: (videoEnabled) => this.handlePeerVideoState(videoEnabled)
    });

    // Acquire initial media (Audio + Video placeholder, with videoTrack.enabled = false)
    this.localStream = await this.webrtc.getInitialMedia();
    this.setupAudioAnalyser(this.localStream);

    // Bind local stream to PiP video element
    this.dom.localVideo.srcObject = this.localStream;

    // 3. Connect to signaling
    this.webrtc.connectSignaling(roomId);

    // Switch UI to WhatsApp Call View
    this.dom.mainNavbar.style.display = 'none';
    this.dom.lobbyView.style.display = 'none';
    this.dom.callView.style.display = 'block';
    this.dom.callPartnerName.textContent = roomId;
    this.dom.callStatusTimer.textContent = 'Ringing...';

    this.isCallActive = true;
  }

  handleRemoteStream(remoteStream, track) {
    console.log('[handleRemoteStream]', track.kind);

    // Bind remote stream to remoteVideo (plays both audio and video)
    if (this.dom.remoteVideo.srcObject !== remoteStream) {
      this.dom.remoteVideo.srcObject = remoteStream;
    }

    this.dom.remoteVideo.play().catch(e => {
      console.log('Remote playback waiting for gesture:', e);
    });
  }

  handleConnectionState(event) {
    console.log('[Call State]', event);

    if (event.status === 'waiting') {
      this.dom.callStatusTimer.textContent = 'Calling...';
    } else if (event.status === 'initiating') {
      this.dom.callStatusTimer.textContent = 'Connecting...';
    } else if (event.status === 'connected') {
      this.startCallTimer();
      this.showToast('Voice call connected (End-to-End Encrypted)', false);
    } else if (event.status === 'rejected') {
      this.dom.rejectedMessage.textContent = event.message || 'Room is already occupied by 2 persons and locked.';
      this.openModal('modal-rejected');
    } else if (event.status === 'disconnected') {
      this.stopCallTimer();
      this.dom.callStatusTimer.textContent = 'Call Ended';
      this.showToast('The other person disconnected.', true);
      setTimeout(() => window.location.reload(), 2500);
    }
  }

  startCallTimer() {
    if (this.callTimerInterval) clearInterval(this.callTimerInterval);
    this.callSeconds = 0;
    this.callTimerInterval = setInterval(() => {
      this.callSeconds++;
      const mins = String(Math.floor(this.callSeconds / 60)).padStart(2, '0');
      const secs = String(this.callSeconds % 60).padStart(2, '0');
      this.dom.callStatusTimer.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  stopCallTimer() {
    if (this.callTimerInterval) {
      clearInterval(this.callTimerInterval);
      this.callTimerInterval = null;
    }
  }

  /**
   * Convert between Voice Call and Video Call
   */
  async toggleVideo() {
    if (!this.isVideoActive) {
      // START VIDEO CASTING
      try {
        await this.webrtc.startVideo();
        this.isVideoActive = true;

        this.dom.btnCallVideo.classList.add('active');
        this.dom.btnCallFlip.style.display = 'flex';

        // Transition view to Video Stage
        this.dom.voiceStage.style.display = 'none';
        this.dom.videoStage.style.display = 'block';

        this.updateVideoStageView();
        this.showToast('Camera turned on', false);
      } catch (err) {
        this.showToast('Could not access camera: ' + err.message, true);
        this.dom.btnCallVideo.classList.remove('active');
      }
    } else {
      // STOP VIDEO CASTING (Return to Voice)
      await this.webrtc.stopVideo();
      this.isVideoActive = false;

      this.dom.btnCallVideo.classList.remove('active');
      this.dom.btnCallFlip.style.display = 'none';

      if (!this.peerVideoActive) {
        this.dom.videoStage.style.display = 'none';
        this.dom.voiceStage.style.display = 'flex';
      } else {
        this.updateVideoStageView();
      }

      this.showToast('Camera turned off', false);
    }
  }

  handlePeerVideoState(enabled) {
    console.log('[Peer Video State Changed]:', enabled);
    this.peerVideoActive = enabled;

    if (enabled) {
      // Peer is broadcasting video: switch to video stage so their feed is shown
      this.dom.voiceStage.style.display = 'none';
      this.dom.videoStage.style.display = 'block';
      this.dom.remoteCamOffOverlay.style.display = 'none';
      this.dom.remoteVideo.play().catch(e => console.log('Autoplay:', e));
      this.showToast('Partner turned video on', false);
    } else {
      // Peer paused video
      if (this.isVideoActive) {
        this.dom.remoteCamOffOverlay.style.display = 'flex';
      } else {
        this.dom.videoStage.style.display = 'none';
        this.dom.voiceStage.style.display = 'flex';
      }
      this.showToast('Partner turned video off', false);
    }

    this.updateVideoStageView();
  }

  updateVideoStageView() {
    if (this.peerVideoActive) {
      this.dom.remoteCamOffOverlay.style.display = 'none';
    } else {
      this.dom.remoteCamOffOverlay.style.display = 'flex';
    }

    if (this.isVideoActive) {
      this.dom.localVideo.parentElement.style.display = 'block';
    } else {
      this.dom.localVideo.parentElement.style.display = 'none';
    }
  }

  async flipCamera() {
    try {
      await this.webrtc.flipCamera();
      this.dom.localVideo.srcObject = this.webrtc.localStream;
      this.showToast('Camera flipped', false);
    } catch (e) {
      this.showToast('Camera flip not supported on this device', true);
    }
  }

  toggleMic() {
    this.isMicMuted = !this.isMicMuted;
    this.webrtc.toggleMicrophone(!this.isMicMuted);
    this.dom.btnCallMic.classList.toggle('muted', this.isMicMuted);
    this.showToast(this.isMicMuted ? 'Microphone muted' : 'Microphone unmuted', false);
  }

  toggleLowSignalMode() {
    this.isLowSignalMode = !this.isLowSignalMode;
    this.webrtc.signalHUD.setManualLowSignalMode(this.isLowSignalMode);
    this.dom.btnCallLowSignal.classList.toggle('active', this.isLowSignalMode);

    if (this.isLowSignalMode) {
      this.showToast('Low-Signal Saver ON: HD Voice Prioritized', true);
    } else {
      this.showToast('Low-Signal Saver OFF', false);
    }
  }

  handleSignalStats(stats) {
    const { bars, rtt, packetLossPct, downloadBitrateKbps, uploadBitrateKbps, jitter } = stats;

    let barClass = 'active';
    if (bars <= 2) barClass = 'low';
    else if (bars === 3) barClass = 'medium';

    this.dom.sigBars.forEach((bar, idx) => {
      bar.className = 'signal-bar';
      if (idx < bars) bar.classList.add(barClass);
    });

    this.dom.hudSignalLabel.textContent = `${stats.label}`;

    this.dom.statRtt.textContent = `${rtt} ms`;
    this.dom.statLoss.textContent = `${packetLossPct}%`;
    this.dom.statBitrate.textContent = `↓ ${downloadBitrateKbps} / ↑ ${uploadBitrateKbps} kbps`;
    this.dom.statJitter.textContent = `${jitter} ms`;
  }

  toggleChatDrawer(forceState = null) {
    this.isChatOpen = forceState !== null ? forceState : !this.isChatOpen;
    this.dom.chatDrawer.classList.toggle('open', this.isChatOpen);
    this.dom.btnCallChat.classList.toggle('active', this.isChatOpen);

    if (this.isChatOpen) {
      this.unreadMessages = 0;
      this.dom.chatUnreadBadge.style.display = 'none';
      this.dom.chatInput.focus();
    }
  }

  async sendChatMessage() {
    const text = this.dom.chatInput.value.trim();
    if (!text) return;

    try {
      this.dom.chatInput.value = '';
      const timestamp = await this.webrtc.sendEncryptedMessage(text);
      this.appendChatMessage({ text, timestamp, sender: 'self' });
    } catch (err) {
      this.showToast('Message not sent: partner not connected', true);
    }
  }

  handleDataMessage(msg) {
    if (msg.type === 'chat') {
      this.appendChatMessage(msg);
      if (!this.isChatOpen) {
        this.unreadMessages++;
        this.dom.chatUnreadBadge.textContent = this.unreadMessages;
        this.dom.chatUnreadBadge.style.display = 'flex';
      }
    }
  }

  appendChatMessage({ text, timestamp, sender }) {
    const item = document.createElement('div');
    item.className = `message-item ${sender === 'self' ? 'sent' : 'received'}`;

    const content = document.createElement('div');
    content.textContent = text;
    item.appendChild(content);

    const time = document.createElement('div');
    time.className = 'message-time';
    const date = new Date(timestamp || Date.now());
    time.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    item.appendChild(time);

    this.dom.chatMessagesContainer.appendChild(item);
    this.dom.chatMessagesContainer.scrollTop = this.dom.chatMessagesContainer.scrollHeight;
  }

  clearChatHistory() {
    if (confirm('Wipe encrypted chat history from browser memory?')) {
      this.dom.chatMessagesContainer.innerHTML = `
        <div style="text-align: center; color: var(--text-secondary); font-size: 0.74rem; padding: 10px;">
          🔒 Chat cleared. Volatile memory wiped.
        </div>
      `;
    }
  }

  endCall() {
    if (confirm('End this call?')) {
      this.stopCallTimer();
      if (this.webrtc) this.webrtc.cleanupCall();
      window.location.reload();
    }
  }

  openModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'flex';
  }

  closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new WhisperApp();
  window.app.init();
});
