/**
 * WebRTC Peer-to-Peer Manager (Robust Voice & HD Video Casting)
 * - Starts as Voice-First Call (video track enabled = false, 0 video bandwidth)
 * - 1-tap instant Video Casting (enables video track & broadcasts immediately)
 * - Dual-layer video state notification (DataChannel + WebSocket fallback)
 * - Single persistent MediaStream binding for audio + video playback
 * - Supports Front / Back Camera Flipping
 * - Opus SDP Munging for in-band FEC & DTX on weak towers
 */

class WebRTCManager {
  constructor({ cryptoEngine, onRemoteStream, onDataMessage, onConnectionState, onSignalUpdate, onPeerVideoState }) {
    this.crypto = cryptoEngine;
    this.onRemoteStream = onRemoteStream;
    this.onDataMessage = onDataMessage;
    this.onConnectionState = onConnectionState;
    this.onSignalUpdate = onSignalUpdate;
    this.onPeerVideoState = onPeerVideoState;

    this.pc = null;
    this.dataChannel = null;
    this.localStream = null;
    this.remoteStream = null;
    this.ws = null;
    this.roomId = null;
    this.isInitiator = false;

    // Media states
    this.isVideoActive = false;
    this.currentFacingMode = 'user'; // 'user' (front) or 'environment' (back)
    this.videoSender = null;
    this.audioSender = null;

    // ICE servers configuration
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' }
      ],
      iceCandidatePoolSize: 4
    };

    this.signalHUD = new SignalHUD(
      null,
      (event) => this.handleNetworkModeChange(event),
      (stats) => {
        if (this.onSignalUpdate) this.onSignalUpdate(stats);
      }
    );
  }

  /**
   * Initializes local media:
   * Requests both Audio and Video so transceivers and SDP are negotiated cleanly,
   * but IMMEDIATELY sets videoTrack.enabled = false so the call starts strictly as VOICE.
   */
  async getInitialMedia() {
    const audioConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      sampleRate: 48000 // 48kHz HD Audio
    };

    const videoConstraints = {
      facingMode: this.currentFacingMode,
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 720, max: 1080 },
      frameRate: { ideal: 30, max: 30 }
    };

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: videoConstraints
      });

      // Mute video track immediately -> Starts in Voice-Only mode
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = false;
      }
      this.isVideoActive = false;

      return this.localStream;
    } catch (err) {
      console.warn('Could not get video+audio, trying audio only fallback:', err);
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: false
        });
        this.isVideoActive = false;
        return this.localStream;
      } catch (audioErr) {
        console.error('Microphone also failed:', audioErr);
        throw audioErr;
      }
    }
  }

  /**
   * Turns ON video casting immediately
   */
  async startVideo() {
    if (!this.localStream) return;

    let videoTrack = this.localStream.getVideoTracks()[0];

    if (!videoTrack) {
      // If user joined without a video track initially, acquire one now
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: this.currentFacingMode,
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 30, max: 30 }
          }
        });
        videoTrack = stream.getVideoTracks()[0];
        this.localStream.addTrack(videoTrack);

        if (this.videoSender) {
          await this.videoSender.replaceTrack(videoTrack);
        } else if (this.pc) {
          this.videoSender = this.pc.addTrack(videoTrack, this.localStream);
        }
      } catch (e) {
        console.error('Failed to acquire camera on demand:', e);
        throw e;
      }
    }

    if (videoTrack) {
      videoTrack.enabled = true;
    }

    this.isVideoActive = true;
    this.broadcastVideoState(true);
    return videoTrack;
  }

  /**
   * Turns OFF video casting (returns to Voice Only)
   */
  async stopVideo() {
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = false;
      }
    }

    this.isVideoActive = false;
    this.broadcastVideoState(false);
  }

  /**
   * Flips camera between Front and Back (Mobile)
   */
  async flipCamera() {
    this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: this.currentFacingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

      const newTrack = newStream.getVideoTracks()[0];

      if (this.localStream) {
        const oldTrack = this.localStream.getVideoTracks()[0];
        if (oldTrack) {
          oldTrack.stop();
          this.localStream.removeTrack(oldTrack);
        }
        this.localStream.addTrack(newTrack);
      }

      if (this.videoSender) {
        await this.videoSender.replaceTrack(newTrack);
      }

      this.isVideoActive = true;
      newTrack.enabled = true;
      this.broadcastVideoState(true);
      return newTrack;
    } catch (err) {
      console.error('Camera flip failed:', err);
      throw err;
    }
  }

  /**
   * Broadcasts video state over both DataChannel and WebSocket signaling
   */
  broadcastVideoState(enabled) {
    const payload = {
      type: 'peer-video-state',
      videoEnabled: enabled
    };

    // 1. DataChannel
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        this.dataChannel.send(JSON.stringify(payload));
      } catch (e) {
        console.warn('DataChannel send state error:', e);
      }
    }

    // 2. WebSocket signaling fallback
    this.sendSignaling(payload);
  }

  /**
   * Connects to signaling server
   */
  connectSignaling(roomId) {
    this.roomId = roomId;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({
        type: 'join',
        roomId: this.roomId
      }));
    };

    this.ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        await this.handleSignalingMessage(data);
      } catch (err) {
        console.error('Signaling handling error:', err);
      }
    };

    this.ws.onclose = () => {
      console.warn('Signaling WebSocket closed');
    };
  }

  async handleSignalingMessage(data) {
    switch (data.type) {
      case 'joined':
        this.isInitiator = data.isInitiator;
        if (this.onConnectionState) {
          this.onConnectionState({
            status: 'waiting',
            message: this.isInitiator ? 'Calling... Waiting for answer' : 'Connecting call...'
          });
        }
        break;

      case 'ready':
        if (this.onConnectionState) {
          this.onConnectionState({
            status: 'initiating',
            message: 'Connected. Securing voice link...'
          });
        }
        this.createPeerConnection();
        if (this.isInitiator) {
          await this.createOffer();
        }
        break;

      case 'room-full':
        if (this.onConnectionState) {
          this.onConnectionState({
            status: 'rejected',
            message: data.message
          });
        }
        break;

      case 'offer':
        if (!this.pc) this.createPeerConnection();
        await this.pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await this.pc.createAnswer();
        const optimizedAnswer = this.mungSdpForLowSignal(answer);
        await this.pc.setLocalDescription(optimizedAnswer);
        this.sendSignaling({
          type: 'answer',
          answer: optimizedAnswer
        });
        break;

      case 'answer':
        await this.pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        break;

      case 'ice-candidate':
        if (data.candidate && this.pc) {
          try {
            await this.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (e) {
            console.error('Error adding ICE candidate:', e);
          }
        }
        break;

      case 'peer-video-state':
        if (this.onPeerVideoState) {
          this.onPeerVideoState(data.videoEnabled);
        }
        break;

      case 'peer-left':
        if (this.onConnectionState) {
          this.onConnectionState({
            status: 'disconnected',
            message: 'Call Ended'
          });
        }
        this.cleanupCall();
        break;
    }
  }

  sendSignaling(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  createPeerConnection() {
    if (this.pc) return;

    this.pc = new RTCPeerConnection(this.rtcConfig);
    this.signalHUD.setPeerConnection(this.pc);

    // Add local tracks (Audio + Video placeholder)
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        const sender = this.pc.addTrack(track, this.localStream);
        if (track.kind === 'video') this.videoSender = sender;
        if (track.kind === 'audio') this.audioSender = sender;
      });
    }

    // Single persistent remote MediaStream container
    this.remoteStream = new MediaStream();

    this.pc.ontrack = (event) => {
      console.log('[WebRTC ontrack]', event.track.kind, event.track.id);

      // Add track to remote stream
      this.remoteStream.addTrack(event.track);

      // Track mute / unmute events for automatic video status detection
      if (event.track.kind === 'video') {
        event.track.onunmute = () => {
          console.log('[Remote Video Track Unmuted - Casting Active]');
          if (this.onPeerVideoState) this.onPeerVideoState(true);
        };
        event.track.onmute = () => {
          console.log('[Remote Video Track Muted - Casting Paused]');
          if (this.onPeerVideoState) this.onPeerVideoState(false);
        };
      }

      if (this.onRemoteStream) {
        this.onRemoteStream(this.remoteStream, event.track);
      }
    };

    // ICE Candidates
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignaling({
          type: 'ice-candidate',
          candidate: event.candidate
        });
      }
    };

    // Connection state
    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      if (this.onConnectionState) {
        this.onConnectionState({ status: state });
      }

      if (state === 'connected') {
        this.signalHUD.start();
        // Send initial video state
        setTimeout(() => this.broadcastVideoState(this.isVideoActive), 300);
      } else if (state === 'disconnected' || state === 'failed') {
        this.attemptIceRestart();
      }
    };

    // DataChannel
    if (this.isInitiator) {
      this.dataChannel = this.pc.createDataChannel('p2p-duo-secure-channel', {
        ordered: true
      });
      this.setupDataChannel(this.dataChannel);
    } else {
      this.pc.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel(this.dataChannel);
      };
    }
  }

  setupDataChannel(channel) {
    channel.onopen = () => {
      console.log('Secure P2P DataChannel opened');
      this.broadcastVideoState(this.isVideoActive);
    };

    channel.onmessage = async (event) => {
      try {
        const payload = JSON.parse(event.data);

        if (payload.type === 'peer-video-state') {
          if (this.onPeerVideoState) {
            this.onPeerVideoState(payload.videoEnabled);
          }
        } else if (payload.type === 'chat') {
          const plaintext = await this.crypto.decryptText(payload.encrypted);
          if (this.onDataMessage) {
            this.onDataMessage({
              type: 'chat',
              text: plaintext,
              timestamp: payload.timestamp,
              sender: 'peer'
            });
          }
        }
      } catch (err) {
        console.error('DataChannel message error:', err);
      }
    };
  }

  mungSdpForLowSignal(description) {
    let sdp = description.sdp;

    // Opus audio tuning for low tower signals
    if (sdp.includes('opus/48000')) {
      sdp = sdp.replace(/a=rtpmap:(\d+) opus\/48000\/2/i, (match, pt) => {
        return `${match}\r\na=fmtp:${pt} useinbandfec=1;usedtx=1;maxaveragebitrate=32000;stereo=0;cbr=0`;
      });
    }

    return new RTCSessionDescription({
      type: description.type,
      sdp: sdp
    });
  }

  async createOffer() {
    try {
      const offer = await this.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      const optimizedOffer = this.mungSdpForLowSignal(offer);
      await this.pc.setLocalDescription(optimizedOffer);
      this.sendSignaling({
        type: 'offer',
        offer: optimizedOffer
      });
    } catch (err) {
      console.error('Create offer error:', err);
    }
  }

  async attemptIceRestart() {
    if (this.isInitiator && this.pc) {
      try {
        const offer = await this.pc.createOffer({ iceRestart: true });
        const optimizedOffer = this.mungSdpForLowSignal(offer);
        await this.pc.setLocalDescription(optimizedOffer);
        this.sendSignaling({
          type: 'offer',
          offer: optimizedOffer
        });
      } catch (e) {
        console.warn('ICE restart offer failed:', e);
      }
    }
  }

  async sendEncryptedMessage(text) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('P2P DataChannel is not open');
    }

    const encrypted = await this.crypto.encryptText(text);
    const packet = {
      type: 'chat',
      encrypted: encrypted,
      timestamp: Date.now()
    };

    this.dataChannel.send(JSON.stringify(packet));
    return packet.timestamp;
  }

  async handleNetworkModeChange(event) {
    const { audioOnly, reason } = event;

    if (this.videoSender && this.videoSender.track) {
      this.videoSender.track.enabled = !audioOnly && this.isVideoActive;
    }

    if (this.onConnectionState) {
      this.onConnectionState({
        status: 'signal-mode-change',
        audioOnly,
        reason,
        message: event.message
      });
    }
  }

  toggleMicrophone(enabled) {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = enabled;
        return audioTrack.enabled;
      }
    }
    return false;
  }

  cleanupCall() {
    this.signalHUD.stop();

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
  }
}

window.WebRTCManager = WebRTCManager;
