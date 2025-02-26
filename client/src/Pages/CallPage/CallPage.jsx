import { useState, useEffect, useRef } from 'react';
import { PhoneOff, Mic, MicOff, Video, VideoOff } from 'lucide-react';

const CallPage = () => {
  const [callStatus, setCallStatus] = useState('connecting'); // connecting, ongoing, ended
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [error, setError] = useState(null);
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const wsRef = useRef(null);
  
  // Parse URL to get connectionId and clientId
  const getConnectionParams = () => {
    const pathParts = window.location.pathname.split('/');
    return {
      connectionId: pathParts[2],
      clientId: pathParts[3]
    };
  };
  
  const { connectionId, clientId } = getConnectionParams();

  // Clean up resources
  const cleanup = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }
  };
  
  // Connect to WebSocket with retry mechanism
  const connectWebSocket = (retryCount = 0, maxRetries = 5) => {
    const wsUrl = import.meta.env.VITE_SERVER_URL;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    
    ws.onopen = () => {
      console.log('WebSocket connection established');
      // Send connection:client message to initiate call
      console.log(clientId);
      
      ws.send(JSON.stringify({
        type: 'connection:client',
        targetClientId: clientId,
        connectionId
      }));
    };
    
    ws.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      console.log('Received message:', message);
      
      switch (message.type) {
        case 'call:waiting':
          setCallStatus('connecting');
          break;
          
        case 'offer':
          await handleOffer(message);
          break;
          
        case 'answer':
          await handleAnswer(message);
          break;
          
        case 'candidate':
          handleCandidate(message);
          break;
          
        case 'call:accepted':
          await startLocalMedia()
          break;
          
        case 'call:terminated':
          endCall();
          break;
          
        case 'error':
          setError(message.message);
          setCallStatus('ended');
          break;
          
        default:
          console.log('Unknown message type:', message.type);
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setError('Connection error. Please try again.');
      setCallStatus('ended');
    };
    
    ws.onclose = () => {
      console.log('WebSocket connection closed');
      if (callStatus !== 'ended' && retryCount < maxRetries) {
        console.log(`Attempting to reconnect (${retryCount + 1}/${maxRetries})...`);
        setTimeout(() => connectWebSocket(retryCount + 1, maxRetries), 2000);
      } else if (retryCount >= maxRetries) {
        setError('Could not establish connection after multiple attempts');
        setCallStatus('ended');
      }
    };
  };
  
  useEffect(() => {
    connectWebSocket();
    
    return () => {
      cleanup();
    };
  }, []);
  
  // Set up local media
  const startLocalMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      setLocalStream(stream);
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      
      initializePeerConnection(stream);
    } catch (err) {
      console.error('Error accessing media devices:', err);
      setError('Could not access camera or microphone. Please check permissions.');
      setCallStatus('ended');
    }
  };
  
  // Initialize WebRTC peer connection
  const initializePeerConnection = (stream) => {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };
    
    const pc = new RTCPeerConnection(configuration);
    peerConnectionRef.current = pc;
    
    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    pc.ontrack = (event) => {
  
      const audioTrack = event.streams[0].getAudioTracks()[0];
      if (!audioTrack) {
          console.error("🚨 No audio track received!");
          return;
      }
  
      
      // Ensure audio is enabled
      audioTrack.enabled = true;
      const remoteAudio = document.createElement("audio");
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.autoplay = true;
      remoteAudio.controls = true;
      remoteAudio.muted = false;
      remoteAudio.style.display = "none"; 
      document.body.appendChild(remoteAudio);
  
      remoteAudio.play().catch(e => {
          console.error("❌ Autoplay blocked! User interaction required:", e);
          remoteAudio.style.display = "block";
      });
  
  };

    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const message = {
          type: 'candidate',
          candidate: event.candidate,
          connectionId
        };
        wsRef.current.send(JSON.stringify(message));
      }
    };

    
    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'disconnected' || 
          pc.iceConnectionState === 'failed' || 
          pc.iceConnectionState === 'closed') {
        setCallStatus('ended');
      }
    };
    
    createOffer(pc);
  };
  
  // Create and send WebRTC offer
  const createOffer = async (pc) => {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const message = {
          type: 'offer',
          sdp: offer,
          connectionId
        };
        
        wsRef.current.send(JSON.stringify(message));
      } else {
        throw new Error("WebSocket not connected");
      }
    } catch (error) {
      console.error('Error creating offer:', error);
      setError('Failed to create call offer. Please try again.');
      setCallStatus('ended');
    }
  };
  
  // Handle WebRTC answer
  const handleAnswer = async (message) => {
    try {
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(message.answer));
      }
    } catch (error) {
      console.error('Error handling answer:', error);
      setError('Failed to process call answer. Please try again.');
      setCallStatus('ended');
    }
  };
  
  // Handle WebRTC ICE candidate
  const handleCandidate = (message) => {
    try {
      if (peerConnectionRef.current) {
        const candidate = new RTCIceCandidate(message.candidate);
        peerConnectionRef.current.addIceCandidate(candidate);
      }
    } catch (error) {
      console.error('Error handling ICE candidate:', error);
    }
  };
  
  // Toggle audio mute
  const toggleMute = () => {
    if (localStream) {
      const audioTracks = localStream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };
  
  // Toggle video on/off
  const toggleVideo = () => {
    if (localStream) {
      const videoTracks = localStream.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };
  
  // End call
  const endCall = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'call:terminated',
        connectionId
      }));
    }
    
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }
    
    setCallStatus('ended');
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header with logo */}
      <header className="bg-white p-4 shadow-md">
        <div className="container mx-auto flex items-center">
          {/* Replace with your actual logo */}
          <div className="flex items-center">
            <div className="bg-blue-600 text-white font-bold rounded-full h-10 w-10 flex items-center justify-center mr-2">
              <img src="https://dowellfileuploader.uxlivinglab.online/hr/logo-2-min-min.png" alt="logo" />
            </div>
            <span className="text-xl font-bold text-blue-600">DoWell UX Living Lab</span>
          </div>
        </div>
      </header>
      
      {/* Main content */}
      <main className="flex-1 container mx-auto p-4 flex flex-col items-center justify-center">
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 w-full max-w-2xl">
            {error}
          </div>
        )}
        
        <div className="w-full max-w-4xl bg-white rounded-lg shadow-lg overflow-hidden">
          {/* Call status indicator */}
          <div className={`p-2 text-center text-white font-medium ${
            callStatus === 'connecting' ? 'bg-yellow-500' : 
            callStatus === 'ongoing' ? 'bg-green-500' : 'bg-red-500'
          }`}>
            {callStatus === 'connecting' ? 'Connecting...' : 
             callStatus === 'ongoing' ? 'Call in Progress' : 'Call Ended'}
          </div>
          
          {/* Video containers */}
          <div className="relative aspect-video bg-gray-900">
            {/* Remote video (large) */}
            {callStatus !== 'ended' && (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
            )}
            
            {/* Local video (small overlay) */}
            {callStatus !== 'ended' && localStream && (
              <div className="absolute bottom-4 right-4 w-1/4 border-2 border-white rounded-lg overflow-hidden shadow-lg">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            
            {/* Call ended message */}
            {callStatus === 'ended' && (
              <div className="flex items-center justify-center h-full">
                <div className="text-white text-center p-8">
                  <h2 className="text-2xl font-bold mb-2">Call Ended</h2>
                  <p>Thank you for using our service.</p>
                  <button 
                    onClick={() => window.location.reload()}
                    className="mt-4 bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded"
                  >
                    Reconnect
                  </button>
                </div>
              </div>
            )}
          </div>
          
          {/* Call controls */}
          {callStatus !== 'ended' && (
            <div className="bg-gray-800 p-4 flex justify-center space-x-6">
              <button 
                onClick={toggleMute}
                className={`rounded-full p-4 ${isMuted ? 'bg-red-500 text-white' : 'bg-gray-600 text-white hover:bg-gray-500'}`}
              >
                {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
              </button>
              
              <button 
                onClick={endCall}
                className="rounded-full p-4 bg-red-600 text-white hover:bg-red-700"
              >
                <PhoneOff size={24} />
              </button>
              
              <button 
                onClick={toggleVideo}
                className={`rounded-full p-4 ${isVideoOff ? 'bg-red-500 text-white' : 'bg-gray-600 text-white hover:bg-gray-500'}`}
              >
                {isVideoOff ? <VideoOff size={24} /> : <Video size={24} />}
              </button>
            </div>
          )}
        </div>
      </main>
      
      {/* Footer */}
      <footer className="bg-gray-800 text-white p-4 text-center">
        <p className="text-sm">© DoWell UX Living Lab. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default CallPage;