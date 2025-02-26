import { useEffect, useState } from 'react';
import { useAppContext } from '../../context/ContextProvider';
import { PhoneOff, User, Loader2, PhoneCall } from 'lucide-react';

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
  const [connectionId, setConnectionId] = useState(null);
  const [adminId, setAdminId] = useState(() => {
    const savedId = localStorage.getItem('adminId');
    if (savedId) return savedId;
    
    const newId = 'admin-' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('adminId', newId);
    return newId;
  });

  useEffect(() => {
    if (!socket || !peerConnection) return;

    // Set up audio handling
    peerConnection.ontrack = (event) => {
      console.log("Received remote track:", event.streams[0]);
      
      // Remove existing audio element if it exists
      if (remoteAudioElement) {
        remoteAudioElement.srcObject = null;
        remoteAudioElement.remove();
      }
      
      // Create new audio element
      const remoteAudio = document.createElement("audio");
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.autoplay = true;
      remoteAudio.controls = true; // Add controls for debugging
      remoteAudio.style.display = "none"; // Hide it but keep it accessible
      document.body.appendChild(remoteAudio);
      
      // Try playing it immediately
      remoteAudio.play().catch(e => {
        console.error("Error auto-playing audio:", e);
        // Make visible if autoplay fails
        remoteAudio.style.display = "block";
      });
      
      setRemoteAudioElement(remoteAudio);
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.send(JSON.stringify({ 
          type: 'candidate', 
          candidate: event.candidate,
          connectionId: connectionId 
        }));
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

    // Add more event listeners for debugging
    peerConnection.onsignalingstatechange = () => {
      console.log("Signaling state changed:", peerConnection.signalingState);
    };

    peerConnection.onicegatheringstatechange = () => {
      console.log("ICE gathering state changed:", peerConnection.iceGatheringState);
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log("ICE connection state changed:", peerConnection.iceConnectionState);
    };

    socket.onopen = () => {
      // Include the clientId in the connection:admin message
      socket.send(JSON.stringify({ 
        type: 'connection:admin',
        clientId: adminId
      }));
      console.log("Admin registered with ID:", adminId);
    };

    socket.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      console.log("Received message:", data);

      if (data.type === "call:incoming") {
        setIncomingCall(true);
        setClientName(data.userName || "Anonymous User");
        setClientStatus("connecting");
        setConnectionId(data.connectionId);
      }

      if (data.type === "offer") {
        try {
          console.log("Received offer, accessing media...");
          const localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            } 
          });
          console.log("Media access successful", localStream);

          // Reset the peer connection to ensure a clean state
          peerConnection.getSenders().forEach(sender => {
            if (sender.track) {
              sender.track.stop();
            }
            peerConnection.removeTrack(sender);
          });

          // Add all tracks from local stream
          localStream.getTracks().forEach(track => {
            console.log("Adding track to connection:", track.kind, track.id);
            peerConnection.addTrack(track, localStream);
          });

          console.log("Setting remote description");
          await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
          
          console.log("Creating answer");
          const answer = await peerConnection.createAnswer();
          
          console.log("Setting local description");
          await peerConnection.setLocalDescription(answer);
          
          console.log("Sending answer");
          socket.send(JSON.stringify({ 
            type: "answer", 
            answer,
            connectionId: data.connectionId
          }));

          setStream(localStream);
          setIsCallActive(true);
          setIncomingCall(false);
          
          console.log("Call setup complete");
          
          const id = setInterval(() => {
            setCallDuration(prev => prev + 1);
          }, 1000);
          setIntervalId(id);
        } catch (err) {
          console.error("Error setting up call:", err);
          socket.send(JSON.stringify({ 
            type: "error", 
            message: "Failed to setup call: " + err.message,
            connectionId: data.connectionId
          }));
        }
      }

      if (data.type === 'candidate' && data.candidate) {
        try {
          console.log("Adding ICE candidate");
          await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          console.error("Error adding ICE candidate:", e);
        }
      }

      if (data.type === "call:terminated") {
        handleConnectionEnd("Client ended the call");
      }
    };

    return () => {
      cleanupCall();
    };
  }, [socket, peerConnection, connectionId, adminId, remoteAudioElement]);

  const cleanupCall = () => {
    console.log("Cleaning up call...");
    
    if (intervalId) {
      clearInterval(intervalId);
      setIntervalId(null);
    }

    if (stream) {
      console.log("Stopping local tracks...");
      stream.getTracks().forEach(track => {
        console.log("Stopping track:", track.kind, track.id);
        track.stop();
      });
      setStream(null);
    }

    if (peerConnection) {
      console.log("Cleaning up peer connection...");
      
      if (peerConnection.getTransceivers) {
        peerConnection.getTransceivers().forEach(transceiver => {
          if (transceiver.stop) {
            transceiver.stop();
          }
        });
      }

      // Remove tracks and close connection
      peerConnection.getSenders().forEach(sender => {
        if (sender.track) {
          sender.track.stop();
        }
      });

      peerConnection.close();
      
      // Reset event handlers
      peerConnection.onicecandidate = null;
      peerConnection.ontrack = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.onsignalingstatechange = null;
      peerConnection.onicegatheringstatechange = null;
      peerConnection.oniceconnectionstatechange = null;
    }

    if (remoteAudioElement) {
      console.log("Removing remote audio element");
      remoteAudioElement.pause();
      remoteAudioElement.srcObject = null;
      remoteAudioElement.remove();
      setRemoteAudioElement(null);
    }
  };

  const handleConnectionEnd = (reason = "") => {
    console.log("Connection ended:", reason);
    cleanupCall();
    setIsCallActive(false);
    setIncomingCall(false);
    setCallDuration(0);
    setClientName("");
    setClientStatus("waiting");
    setConnectionId(null);
  };

  const handleDisconnection = () => {
    console.log("Initiating disconnection");
    socket.send(JSON.stringify({ 
      type: "call:terminated",
      connectionId: connectionId,
      timestamp: new Date().toISOString(),
      reason: "admin_initiated"
    }));
    
    handleConnectionEnd("Call ended by admin");
  };

  const handleAcceptCall = async () => {
    if (!connectionId) return;
    
    console.log("Accepting call with connection ID:", connectionId);
    
    // Pre-request audio permission before accepting
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop()); // Just testing access
      console.log("Audio permission granted");
    } catch (err) {
      console.error("Failed to get audio permission:", err);
      alert("Please grant microphone permission to accept calls");
      return;
    }
    
    socket.send(JSON.stringify({
      type: "call:accepted",
      connectionId: connectionId
    }));
    
    setClientStatus("accepted");
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Debug button to check audio
  const checkAudio = async () => {
    if (isCallActive) {
      console.log("Current audio tracks:");
      if (stream) {
        stream.getAudioTracks().forEach(track => {
          console.log("Local track:", track.id, "enabled:", track.enabled, "readyState:", track.readyState);
        });
      }
      if (remoteAudioElement && remoteAudioElement.srcObject) {
        const remoteTracks = remoteAudioElement.srcObject.getAudioTracks();
        remoteTracks.forEach(track => {
          console.log("Remote track:", track.id, "enabled:", track.enabled, "readyState:", track.readyState);
        });
        
        // Try to restart the audio
        if (remoteTracks.length > 0) {
          remoteAudioElement.play().catch(e => console.error("Cannot play:", e));
        }
      }
    }
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
                    <p className="text-xs text-gray-500">ID: {adminId}</p>
                    {isCallActive && (
                      <div className="space-y-1 mt-2">
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
                    <div className="flex items-center justify-between mb-4">
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
                    
                    <div className="flex space-x-3">
                      <button
                        onClick={handleAcceptCall}
                        className="flex-1 flex items-center justify-center space-x-2 bg-green-600 hover:bg-green-700 text-white p-3 rounded-lg transition-colors duration-300"
                      >
                        <PhoneCall className="w-5 h-5" />
                        <span className="font-medium">Accept Call</span>
                      </button>
                      
                      <button
                        onClick={handleDisconnection}
                        className="flex-1 flex items-center justify-center space-x-2 bg-red-600 hover:bg-red-700 text-white p-3 rounded-lg transition-colors duration-300"
                      >
                        <PhoneOff className="w-5 h-5" />
                        <span className="font-medium">Decline</span>
                      </button>
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

                    <div className="flex flex-col space-y-3">
                      <button
                        onClick={handleDisconnection}
                        className="w-full flex items-center justify-center space-x-2 bg-red-600 hover:bg-red-700 text-white p-4 rounded-xl transition-colors duration-300"
                      >
                        <PhoneOff className="w-5 h-5" />
                        <span className="font-medium">End Call</span>
                      </button>
                      
                      <button
                        onClick={checkAudio}
                        className="w-full flex items-center justify-center space-x-2 bg-gray-200 hover:bg-gray-300 text-gray-800 p-2 rounded-xl transition-colors duration-300 text-sm"
                      >
                        <span className="font-medium">Check Audio</span>
                      </button>
                    </div>
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