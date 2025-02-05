// Manager.js
import { useEffect, useState } from 'react';
import { useAppContext } from '../../context/ContextProvider';
import { PhoneOff, User, Loader2 } from 'lucide-react';

function Manager() {
  const { socket, peerConnection } = useAppContext();
  const [stream, setStream] = useState(null);
  const [incomingCall, setIncomingCall] = useState(false);
  const [isCallActive, setIsCallActive] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [intervalId, setIntervalId] = useState(null);
  const [remoteAudioElement, setRemoteAudioElement] = useState(null);
  const [clientName, setClientName] = useState("");
  const [clientStatus, setClientStatus] = useState("waiting");

  useEffect(() => {
    if (!socket || !peerConnection) return;

    peerConnection.ontrack = (event) => {
      console.log("Received remote track:", event.streams[0]);
      const remoteAudio = document.createElement("audio");
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.autoplay = true;
      document.body.appendChild(remoteAudio);
      setRemoteAudioElement(remoteAudio);
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
      }
    };

    peerConnection.onconnectionstatechange = () => {
      console.log("Connection state changed:", peerConnection.connectionState);
      if (peerConnection.connectionState === 'disconnected' || 
          peerConnection.connectionState === 'failed' ||
          peerConnection.connectionState === 'closed') {
        handleConnectionEnd("Call disconnected");
      }
    };

    // Manager.js (continued)
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'connection:admin' }));
    };

    socket.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "connection:client") {
        setIncomingCall(true);
        setClientName(data.userName || "Anonymous User");
        setClientStatus("connecting");
        socket.send(JSON.stringify({ type: "call:ready" }));
      }

      if (data.type === "offer") {
        try {
          const localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              sampleRate: 160000,
              channelCount: 2
            } 
          });

          localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

          await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(new RTCSessionDescription(answer));
          socket.send(JSON.stringify({ type: "answer", answer }));

          setStream(localStream);
          setIsCallActive(true);
          setIncomingCall(false);

          const id = setInterval(() => {
            setCallDuration(prev => prev + 1);
          }, 1000);
          setIntervalId(id);
        } catch (err) {
          console.error("Error accessing microphone:", err);
          socket.send(JSON.stringify({ type: "error", message: "Failed to access microphone" }));
        }
      }

      if (data.type === 'candidate') {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      }

      if (data.type === "call:terminated") {
        handleConnectionEnd("Client ended the call");
      }
    };

    return () => {
      cleanupCall();
    };
  }, [socket, peerConnection]);

  const cleanupCall = () => {
    if (intervalId) {
      clearInterval(intervalId);
      setIntervalId(null);
    }

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }

    if (peerConnection) {
      if (peerConnection.getTransceivers) {
        peerConnection.getTransceivers().forEach(transceiver => {
          if (transceiver.stop) {
            transceiver.stop();
          }
        });
      }

      peerConnection.getSenders().forEach(sender => {
        if (sender.track) {
          sender.track.stop();
        }
      });

      peerConnection.getSenders().forEach(sender => {
        peerConnection.removeTrack(sender);
      });

      peerConnection.onicecandidate = null;
      peerConnection.ontrack = null;
      peerConnection.onconnectionstatechange = null;

      peerConnection.close();
    }

    if (remoteAudioElement) {
      remoteAudioElement.srcObject = null;
      remoteAudioElement.remove();
      setRemoteAudioElement(null);
    }
  };

  const handleConnectionEnd = (reason = "") => {
    cleanupCall();
    setIsCallActive(false);
    setIncomingCall(false);
    setCallDuration(0);
    setClientName("");
    setClientStatus("waiting");
  };

  const handleDisconnection = () => {
    socket.send(JSON.stringify({ 
      type: "call:terminated",
      timestamp: new Date().toISOString(),
      reason: "admin_initiated"
    }));
    
    handleConnectionEnd("Call ended by admin");
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="fixed inset-0 flex overflow-hidden">
      <div className="flex-1 bg-white">
        <div className="h-full flex items-center justify-center p-8">
          <div className="w-full max-w-2xl">
            <div className="space-y-6">
              <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100">
                <div className="flex items-center space-x-4 mb-6">
                  <div className="w-16 h-16 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-full flex items-center justify-center">
                    <User className="w-8 h-8 text-white" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-xl font-semibold text-gray-800">Support Admin</h2>
                    {isCallActive && (
                      <div className="space-y-1">
                        <p className="text-gray-500">Duration: {formatTime(callDuration)}</p>
                        <div className="flex items-center space-x-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                          <p className="text-gray-600 font-medium">
                            Connected with: <span className="text-violet-600">{clientName}</span>
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {incomingCall && (
                  <div className="bg-violet-50 rounded-lg p-4 mb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <Loader2 className="w-5 h-5 animate-spin text-violet-600" />
                        <div>
                          <p className="text-sm font-medium text-violet-700">
                            Incoming call from:
                          </p>
                          <p className="text-violet-800 font-semibold">
                            {clientName}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {isCallActive && (
                  <>
                    <div className="bg-green-50 rounded-lg p-4 mb-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-green-700">
                          Active call with {clientName}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={handleDisconnection}
                      className="w-full flex items-center justify-center space-x-2 bg-red-600 hover:bg-red-700 text-white p-4 rounded-xl transition-colors duration-300"
                    >
                      <PhoneOff className="w-5 h-5" />
                      <span className="font-medium">End Call</span>
                    </button>
                  </>
                )}

                {!isCallActive && !incomingCall && (
                  <div className="bg-gray-50 rounded-lg p-4 flex items-center justify-center">
                    <p className="text-sm text-gray-600">
                      Waiting for incoming calls...
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Manager;