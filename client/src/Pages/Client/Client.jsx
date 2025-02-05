// Client.js
import { useEffect, useState } from "react";
import { useAppContext } from "../../context/ContextProvider";
import {
  Phone,
  PhoneOff,
  Loader2,
  User,
  ChevronRight,
} from "lucide-react";

function Client() {
  const { socket, peerConnection } = useAppContext();
  const [message, setMessage] = useState("");
  const [isCalled, setIsCalled] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [intervalId, setIntervalId] = useState(null);
  const [remoteAudioElement, setRemoteAudioElement] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [userName, setUserName] = useState("");
  const [isNameEntered, setIsNameEntered] = useState(false);

  useEffect(() => {
    if (!peerConnection || !socket) return;

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.send(
          JSON.stringify({ type: "candidate", candidate: event.candidate })
        );
      }
    };

    peerConnection.ontrack = (event) => {
      console.log("Received remote track:", event.streams[0]);
      const remoteAudio = document.createElement("audio");
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.autoplay = true;
      document.body.appendChild(remoteAudio);
      setRemoteAudioElement(remoteAudio);

      setIsConnecting(false);
      setMessage("Connected to support agent");

      const id = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
      setIntervalId(id);
    };

    peerConnection.onconnectionstatechange = () => {
      console.log("Connection state changed:", peerConnection.connectionState);
      if (peerConnection.connectionState === 'disconnected' || 
          peerConnection.connectionState === 'failed' ||
          peerConnection.connectionState === 'closed') {
        endCall("Call disconnected");
      }
    };

    socket.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "manager:inactive") {
        endCall("There is no admin available right now. Please try again later.");
      }

      if (data.type === "call:ready") {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              sampleRate: 160000,
              channelCount: 2,
            },
          });
          
          setLocalStream(stream);

          stream.getTracks().forEach((track) => 
            peerConnection.addTrack(track, stream)
          );

          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(
            new RTCSessionDescription(offer)
          );
          socket.send(JSON.stringify({ type: "offer", offer }));
        } catch (err) {
          console.error("Error accessing microphone:", err);
          endCall("Error accessing microphone. Please check your permissions.");
        }
      }

      if (data.type === "answer") {
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(data.answer)
        );
      }

      if (data.type === "candidate") {
        await peerConnection.addIceCandidate(
          new RTCIceCandidate(data.candidate)
        );
      }

      if (data.type === "disconnection:admin" || data.type === "call:terminated") {
        endCall("Support agent has disconnected");
      }
    };

    return () => {
      cleanupCall();
    };
  }, [peerConnection, socket]);

  const cleanupCall = () => {
    if (intervalId) {
      clearInterval(intervalId);
      setIntervalId(null);
    }

    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
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

  function startCall() {
    if (!userName.trim()) {
      setMessage("Please enter your name first");
      return;
    }
    setIsConnecting(true);
    setIsCalled(true);
    setMessage("Connecting you to the admin...");
    socket.send(JSON.stringify({ 
      type: "connection:client",
      timestamp: new Date().toISOString(),
      userName: userName.trim()
    }));
  }

  function endCall(customMessage = "") {
    socket.send(JSON.stringify({ 
      type: "call:terminated",
      timestamp: new Date().toISOString(),
      reason: "user_initiated"
    }));
    
    cleanupCall();
    setIsCalled(false);
    setIsConnecting(false);
    setMessage(customMessage || "");
    setCallDuration(0);
  }

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  return (
    <div className="fixed inset-0 flex overflow-hidden">
      <div className="flex-1 bg-white">
        <div className="h-full flex items-center justify-center p-8">
          <div className="w-full max-w-2xl">
            {!isCalled ? (
              <div className="space-y-8">
                <div>
                  <h2 className="text-4xl font-bold text-gray-900">
                    Start a Voice Call
                  </h2>
                  <p className="mt-3 text-lg text-gray-600">
                    Connect with our support team instantly
                  </p>
                </div>

                <div className="space-y-4">
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => {
                      setUserName(e.target.value);
                      setIsNameEntered(!!e.target.value.trim());
                    }}
                    placeholder="Enter your name"
                    className="w-full p-4 border text-black border-gray-300 rounded-xl focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                  />

                  <button
                    onClick={startCall}
                    disabled={!isNameEntered}
                    className={`w-full group relative flex items-center justify-between ${
                      isNameEntered 
                        ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700" 
                        : "bg-gray-300 cursor-not-allowed"
                    } text-white p-6 rounded-xl transition-all duration-300`}
                  >
                    <div className="flex items-center space-x-4">
                      <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                        <Phone className="w-6 h-6" />
                      </div>
                      <div className="text-left">
                        <span className="block font-semibold text-lg">
                          Start Voice Call
                        </span>
                        <span className="text-sm text-white/80">
                          Connect with an agent
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="w-6 h-6 transform group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100">
                  <div className="flex items-center space-x-4 mb-6">
                    <div className="w-16 h-16 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-full flex items-center justify-center">
                      <User className="w-8 h-8 text-white" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-gray-800">
                        Support Agent
                      </h2>
                      {callDuration > 0 && (
                        <p className="text-gray-500">
                          Duration: {formatTime(callDuration)}
                        </p>
                      )}
                    </div>
                  </div>

                  {isConnecting ? (
                    <div className="bg-violet-50 rounded-lg p-4 flex items-center justify-center space-x-3">
                      <Loader2 className="w-5 h-5 animate-spin text-violet-600" />
                      <p className="text-sm font-medium text-violet-700">
                        {message}
                      </p>
                    </div>
                  ) : (
                    <div className="bg-green-50 rounded-lg p-4">
                      <p className="text-sm font-medium text-green-700">
                        {message}
                      </p>
                    </div>
                  )}
                </div>

                <button
                  onClick={endCall}
                  className="w-full flex items-center justify-center space-x-2 bg-red-600 hover:bg-red-700 text-white p-4 rounded-xl transition-colors duration-300"
                >
                  <PhoneOff className="w-5 h-5" />
                  <span className="font-medium">End Call</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {isCalled && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
            <div className="bg-violet-600 p-4 rounded-t-2xl">
              <h3 className="text-xl font-semibold text-white text-center">
                Voice Support
              </h3>
            </div>

            <div className="p-8 space-y-8">
              <div className="flex flex-col items-center text-center space-y-4">
                {isConnecting ? (
                  <>
                    <div className="w-16 h-16 bg-violet-100 rounded-full flex items-center justify-center">
                      <Loader2 className="w-8 h-8 text-violet-600 animate-spin" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-lg font-medium text-gray-900">
                        Connecting...
                      </h4>
                      <p className="text-sm text-gray-500">{message}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                      <div className="w-8 h-8 bg-green-500 rounded-full" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-lg font-medium text-gray-900">
                        Connected
                      </h4>
                      <p className="text-sm text-gray-500">{message}</p>
                    </div>
                  </>
                )}
              </div>

              <button
                onClick={endCall}
                className="w-full flex items-center justify-center gap-2 bg-black hover:bg-gray-800 text-white p-3 rounded-xl transition-colors duration-200"
              >
                <PhoneOff className="w-5 h-5" />
                <span className="font-medium">End Call</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Client;