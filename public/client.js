const socket = io();

const adminLoginBtn = document.getElementById('adminLoginBtn');
const userLoginBtn = document.getElementById('userLoginBtn');
const startCallBtn = document.getElementById('startCall');
const endCallBtn = document.getElementById('endCall');
const localAudio = document.getElementById('localAudio');
const remoteAudio = document.getElementById('remoteAudio');
const callTimer = document.getElementById('callTimer');

let localStream;
let peerConnection;
let isAdmin = false;
let callStartTime;
let callInterval;
let recognition;

const configuration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

function startTimer() {
    callStartTime = Date.now();
    callTimer.style.display = 'block';
    callInterval = setInterval(() => {
        const elapsedTime = Date.now() - callStartTime;
        const minutes = Math.floor(elapsedTime / 60000);
        const seconds = Math.floor((elapsedTime % 60000) / 1000);
        callTimer.textContent = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(callInterval);
    callTimer.textContent = '00:00';
    callTimer.style.display = 'none';
}

adminLoginBtn.addEventListener('click', () => {
    const adminId = prompt('Enter admin ID:');
    if (adminId) {
        socket.emit('adminLogin', adminId);
        isAdmin = true;
        endCallBtn.style.display = 'none'; // Hide end call button for admin
    }
});

userLoginBtn.addEventListener('click', () => {
    socket.emit('login');
});

startCallBtn.addEventListener('click', async () => {
    if (isAdmin) {
        console.log('Admin does not need to access media devices.');
        return;
    }

    if (!localStream) {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                localAudio.srcObject = localStream;
                localAudio.muted = true;
            } catch (error) {
                console.error('Error accessing media devices.', error);
                return;
            }
        } else {
            console.error('getUserMedia is not supported in this browser.');
            return;
        }
    }

    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('candidate', event.candidate);
        }
    };

    peerConnection.ontrack = event => {
        remoteAudio.srcObject = event.streams[0];
        if (isAdmin) {
            startTranscription(event.streams[0]);
        }
    };

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', offer);
});

endCallBtn.addEventListener('click', () => {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
        localAudio.srcObject = null;
        remoteAudio.srcObject = null;
        socket.emit('endCall');
        console.log('User ended the call');
    }
    stopTimer();
    if (recognition) {
        recognition.stop();
    }
});

socket.on('offer', async (offer) => {
    if (!isAdmin) {
        return;
    }

    if (!peerConnection) {
        peerConnection = new RTCPeerConnection(configuration);

        peerConnection.onicecandidate = event => {
            if (event.candidate) {
                socket.emit('candidate', event.candidate);
            }
        };

        peerConnection.ontrack = event => {
            remoteAudio.srcObject = event.streams[0];
            startTranscription(event.streams[0]);
        };

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', answer);
    }
});

socket.on('answer', async (answer) => {
    if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        socket.emit('callStarted');
    }
});

socket.on('candidate', async (candidate) => {
    if (peerConnection) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error('Error adding received ice candidate', e);
        }
    }
});

socket.on('endCall', () => {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
        localAudio.srcObject = null;
        remoteAudio.srcObject = null;
    }
    stopTimer();
    if (recognition) {
        recognition.stop();
    }
});

socket.on('adminLoginSuccess', () => {
    alert('Admin logged in successfully');
    endCallBtn.disabled = false;
});

socket.on('adminLoginFailure', (errorMessage) => {
    alert(errorMessage);
});

socket.on('adminNotAvailable', () => {
    alert('No available admin at the moment');
});

socket.on('loginSuccess', () => {
    alert('User logged in successfully');
    startCallBtn.disabled = false;
    endCallBtn.disabled = false;
});

socket.on('callStarted', () => {
    startTimer();
});

function startTranscription(stream) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.error('SpeechRecognition is not supported in this browser.');
        return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = event => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            transcript += event.results[i][0].transcript;
        }
        console.log('Transcript:', transcript);
        // Send the transcript to the admin's console
        socket.emit('transcript', transcript);
    };

    recognition.onerror = event => {
        console.error('SpeechRecognition error:', event.error);
        if (event.error === 'network') {
            // Handle network errors separately if needed
        }
    };

    recognition.onend = () => {
        console.log('SpeechRecognition service disconnected, restarting...');
        if (peerConnection) { // Only restart if the call is still active
            recognition.start();
        }
    };

    recognition.start();
}
