const { GoogleGenAI, Modality } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 *
 * @param {WebSocket} clientSocket - the browser's WebSocket connection to OUR server
 * @param {Object} context - { jobTitle, jobDescription, cvText }
 * @param {Function} onSessionEnd - callback(transcript) fired when the session closes
 */
async function startMavisSession(clientSocket, context, onSessionEnd) {
    let fullTranscript = '';

    const systemInstruction = `You are Mavis, a warm and encouraging mock interview coach.
    Interview role: ${context.jobTitle || 'Not specified'}
    Job description: ${context.jobDescription || 'Not provided'}
    Candidate's CV summary: ${context.cvText || 'Not provided'}
    Ask relevant interview questions one at a time, listen to the candidate's spoken answers, and respond naturally like a real interviewer would.`;

    const geminiSession = await ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
            responseModalities: [Modality.AUDIO],
            outputAudioTranscription: {},
            inputAudioTranscription: {}, // also transcribe the CANDIDATE's speech, not just Mavis's
            systemInstruction,
        },
        callbacks: {
            onopen: () => {
                console.log('Gemini session opened for client');
                clientSocket.send(JSON.stringify({ type: 'ready' }));
            },
            onmessage: (message) => {
                // Mavis's spoken response, transcribed
                if (message.serverContent?.outputTranscription?.text) {
                    const text = message.serverContent.outputTranscription.text;
                    fullTranscript += `Mavis: ${text}`;
                    clientSocket.send(JSON.stringify({ type: 'mavis_transcript', text }));
                }

                // Candidate's spoken input, transcribed (so we can log their answers too)
                if (message.serverContent?.inputTranscription?.text) {
                    const text = message.serverContent.inputTranscription.text;
                    fullTranscript += `Candidate: ${text}`;
                    clientSocket.send(JSON.stringify({ type: 'candidate_transcript', text }));
                }

                // Raw audio bytes to play in the browser
                if (message.data) {
                    clientSocket.send(JSON.stringify({ type: 'audio', data: message.data }));
                }

                if (message.serverContent?.turnComplete) {
                    clientSocket.send(JSON.stringify({ type: 'turn_complete' }));
                }
            },
            onerror: (err) => {
                console.error('Gemini error:', err);
                clientSocket.send(JSON.stringify({ type: 'error', message: err.message }));
            },
            onclose: (event) => {
                console.log('Gemini session closed:', event.reason);
                onSessionEnd(fullTranscript); // hand the finished transcript back to whoever called this
            },
        },
    });

    // Messages coming FROM the browser (mic audio chunks, or a manual "end" signal)
    clientSocket.on('message', (rawMessage) => {
        const msg = JSON.parse(rawMessage);

        if (msg.type === 'audio_chunk') {
            // msg.data is expected to be base64-encoded PCM audio from the browser mic
            geminiSession.sendRealtimeInput({
                audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' },
            });
        }

        if (msg.type === 'end_session') {
            geminiSession.close();
        }
    });

    clientSocket.on('close', () => {
        geminiSession.close(); // clean up the Gemini session if the browser disconnects
    });
}

module.exports = { startMavisSession };