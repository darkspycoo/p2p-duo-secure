/**
 * Low Tower Signal & Network Health Monitor
 * Analyzes WebRTC getStats() metrics in real-time.
 * Manages cellular signal bar levels, adaptive bitrate scaling, and audio-first fallback.
 */

class SignalHUD {
  constructor(peerConnection, onModeChange, onStatsUpdate) {
    this.pc = peerConnection;
    this.onModeChange = onModeChange; // Callback when network forces audio-first or recovers
    this.onStatsUpdate = onStatsUpdate;

    this.timer = null;
    this.lastBytesReceived = 0;
    this.lastBytesSent = 0;
    this.lastTimestamp = 0;

    this.manualLowSignalMode = false;
    this.isAudioFirstActive = false;
    this.consecutivePoorCount = 0;
    this.consecutiveGoodCount = 0;

    // Metrics
    this.stats = {
      bars: 5,               // 1 to 5 bars
      label: 'Optimal',      // Optimal, Good, Moderate, Weak, Critical
      rtt: 0,                // ms
      packetLossPct: 0,      // %
      downloadBitrateKbps: 0,// kbps
      uploadBitrateKbps: 0,  // kbps
      jitter: 0,             // ms
      videoResolution: '--',
      fps: 0,
      mode: 'HD Dynamic'     // 'HD Dynamic', 'Adaptive Low', 'Audio Only Fallback'
    };
  }

  setPeerConnection(pc) {
    this.pc = pc;
  }

  start() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.pollStats(), 1500);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setManualLowSignalMode(enabled) {
    this.manualLowSignalMode = enabled;
    if (enabled) {
      this.stats.mode = 'Forced Low-Signal Saver';
      if (this.onModeChange) this.onModeChange({ audioOnly: true, reason: 'manual' });
    } else {
      this.stats.mode = 'HD Dynamic';
      if (this.onModeChange) this.onModeChange({ audioOnly: false, reason: 'manual' });
    }
  }

  async pollStats() {
    if (!this.pc || this.pc.connectionState !== 'connected') {
      return;
    }

    try {
      const reports = await this.pc.getStats();
      let currentRtt = 0;
      let packetsLost = 0;
      let totalPackets = 0;
      let totalBytesReceived = 0;
      let totalBytesSent = 0;
      let videoWidth = 0;
      let videoHeight = 0;
      let currentFps = 0;
      let currentJitter = 0;
      let now = performance.now();

      reports.forEach(report => {
        // Candidate pair info for RTT
        if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
          if (report.currentRoundTripTime) {
            currentRtt = Math.round(report.currentRoundTripTime * 1000);
          }
        }

        // Inbound RTP streams (Audio and Video)
        if (report.type === 'inbound-rtp') {
          if (report.packetsLost) packetsLost += report.packetsLost;
          if (report.packetsReceived) totalPackets += (report.packetsReceived + (report.packetsLost || 0));
          if (report.bytesReceived) totalBytesReceived += report.bytesReceived;
          if (report.jitter) currentJitter = Math.round(report.jitter * 1000);

          if (report.kind === 'video') {
            if (report.frameWidth) videoWidth = report.frameWidth;
            if (report.frameHeight) videoHeight = report.frameHeight;
            if (report.framesPerSecond) currentFps = Math.round(report.framesPerSecond);
          }
        }

        // Outbound RTP
        if (report.type === 'outbound-rtp') {
          if (report.bytesSent) totalBytesSent += report.bytesSent;
        }
      });

      // Calculate Bitrate
      let timeDiff = (now - (this.lastTimestamp || now)) / 1000;
      if (timeDiff > 0 && this.lastTimestamp > 0) {
        this.stats.downloadBitrateKbps = Math.max(0, Math.round(((totalBytesReceived - this.lastBytesReceived) * 8) / (timeDiff * 1000)));
        this.stats.uploadBitrateKbps = Math.max(0, Math.round(((totalBytesSent - this.lastBytesSent) * 8) / (timeDiff * 1000)));
      }

      this.lastBytesReceived = totalBytesReceived;
      this.lastBytesSent = totalBytesSent;
      this.lastTimestamp = now;

      this.stats.rtt = currentRtt;
      this.stats.jitter = currentJitter;
      this.stats.fps = currentFps;
      this.stats.videoResolution = (videoWidth && videoHeight) ? `${videoWidth}x${videoHeight}` : 'Audio Only';

      // Packet Loss Calculation
      if (totalPackets > 0) {
        this.stats.packetLossPct = Math.min(100, Math.max(0, Math.round((packetsLost / totalPackets) * 100)));
      }

      // Compute Tower Signal Strength (1-5 Bars)
      this.evaluateSignalStrength();

      // Trigger automatic network adaptation if not in manual mode
      if (!this.manualLowSignalMode) {
        this.handleAutoAdaptation();
      }

      if (this.onStatsUpdate) {
        this.onStatsUpdate(this.stats);
      }
    } catch (e) {
      console.warn('Stats polling error:', e);
    }
  }

  evaluateSignalStrength() {
    const { rtt, packetLossPct } = this.stats;

    if (rtt === 0 && packetLossPct === 0) {
      // Connecting or local
      this.stats.bars = 5;
      this.stats.label = 'HD Connected';
      return;
    }

    // Cellular Tower Signal degradation logic:
    if (rtt > 450 || packetLossPct > 18) {
      this.stats.bars = 1;
      this.stats.label = 'Low Signal (Critical)';
    } else if (rtt > 300 || packetLossPct > 10) {
      this.stats.bars = 2;
      this.stats.label = 'Weak Signal';
    } else if (rtt > 180 || packetLossPct > 5) {
      this.stats.bars = 3;
      this.stats.label = 'Fair Cellular';
    } else if (rtt > 100 || packetLossPct > 2) {
      this.stats.bars = 4;
      this.stats.label = 'Good 4G/5G';
    } else {
      this.stats.bars = 5;
      this.stats.label = 'HD Broadband / 5G';
    }
  }

  handleAutoAdaptation() {
    const { bars } = this.stats;

    // If signal is weak or critical for multiple consecutive polls
    if (bars <= 2) {
      this.consecutivePoorCount++;
      this.consecutiveGoodCount = 0;

      // After 2 consecutive poor readings (~3s), fall back to audio priority to protect call
      if (this.consecutivePoorCount >= 2 && !this.isAudioFirstActive) {
        this.isAudioFirstActive = true;
        this.stats.mode = 'Auto Audio-First (Low Signal Guard)';
        if (this.onModeChange) {
          this.onModeChange({
            audioOnly: true,
            reason: 'auto-low-signal',
            message: 'Weak signal detected. Temporarily switching to HD Voice Priority to prevent call drop.'
          });
        }
      }
    } else if (bars >= 4) {
      this.consecutiveGoodCount++;
      this.consecutivePoorCount = 0;

      // After 3 consecutive good readings (~4.5s), recover HD video
      if (this.consecutiveGoodCount >= 3 && this.isAudioFirstActive) {
        this.isAudioFirstActive = false;
        this.stats.mode = 'HD Dynamic';
        if (this.onModeChange) {
          this.onModeChange({
            audioOnly: false,
            reason: 'auto-recovered',
            message: 'Signal stabilized. HD Video resumed.'
          });
        }
      }
    } else {
      this.consecutivePoorCount = 0;
      this.consecutiveGoodCount = 0;
    }
  }
}

window.SignalHUD = SignalHUD;
