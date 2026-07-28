require('dotenv').config();
const { GoogleGenAI, Modality } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function main() {
    const session = await ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
            responseModalities: [Modality.AUDIO],
            outputAudioTranscription: {},
            systemInstruction: 'You are Mavis, a warm and encouraging mock interview coach.',
        },
        callbacks: {
            onopen: () => console.log('Connected to Gemini Live'),
            onmessage: (message) => {
                if (message.serverContent?.outputTranscription?.text) {
                    console.log('Mavis said:', message.serverContent.outputTranscription.text);
                }
                if (message.data) {
                    console.log('Received audio chunk, length:', message.data.length);
                }
                if (message.serverContent?.turnComplete) {
                    console.log('Turn complete');
                }
            },
            onerror: (err) => console.error('Gemini error:', err),
            onclose: (event) => console.log('Session closed:', event.reason),
        },
    });

    session.sendClientContent({
        turns: 'Hello Mavis, please introduce yourself in one sentence.',
    });

    setTimeout(() => {
        session.close();
        process.exit(0);
    }, 8000);
}

main().catch((err) => console.error('Fatal error:', err));