export const TRANSPORT_MODES = {
  auto: "auto",
  webrtc: "webrtc",
  compatibility: "compatibility"
};

const STORAGE_KEY = "nexforce.transportMode";

export const getTransportMode = () => {
  const value = localStorage.getItem(STORAGE_KEY);
  if (value === TRANSPORT_MODES.webrtc || value === TRANSPORT_MODES.compatibility) {
    return value;
  }
  return TRANSPORT_MODES.auto;
};

export const setTransportMode = (value) => {
  const normalized =
    value === TRANSPORT_MODES.webrtc || value === TRANSPORT_MODES.compatibility
      ? value
      : TRANSPORT_MODES.auto;
  localStorage.setItem(STORAGE_KEY, normalized);
};

export const isWebRTCSupported = () => {
  return typeof window !== "undefined" && typeof window.RTCPeerConnection === "function";
};

export const probeWebRTCAvailability = async (timeoutMs = 3000) => {
  if (!isWebRTCSupported()) {
    return { available: false, reason: "not_supported" };
  }

  const peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  let resolved = false;

  return new Promise(async (resolve) => {
    const finalize = (available, reason) => {
      if (resolved) {
        return;
      }
      resolved = true;
      try {
        peerConnection.close();
      } catch {
      }
      resolve({ available, reason });
    };

    const timer = setTimeout(() => {
      finalize(false, "ice_timeout");
    }, timeoutMs);

    try {
      peerConnection.createDataChannel("nexforce_probe");
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          clearTimeout(timer);
          finalize(true, "ok");
        }
      };

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
    } catch {
      clearTimeout(timer);
      finalize(false, "probe_failed");
    }
  });
};

export const resolveTransportMode = async () => {
  const mode = getTransportMode();
  if (mode === TRANSPORT_MODES.compatibility) {
    return { mode: TRANSPORT_MODES.compatibility, reason: "forced_compatibility" };
  }

  const probe = await probeWebRTCAvailability();

  if (mode === TRANSPORT_MODES.webrtc) {
    return probe.available
      ? { mode: TRANSPORT_MODES.webrtc, reason: "forced_webrtc" }
      : { mode: TRANSPORT_MODES.compatibility, reason: probe.reason };
  }

  return probe.available
    ? { mode: TRANSPORT_MODES.webrtc, reason: "auto_webrtc" }
    : { mode: TRANSPORT_MODES.compatibility, reason: probe.reason };
};
