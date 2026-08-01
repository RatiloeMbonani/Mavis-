const { GoogleGenAI, Modality } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function startMavisSession(clientSocket, context, onSessionEnd) {
  let fullTranscript = "";
  let currentSpeaker = null;

  const systemInstruction = `You are Mavis, a warm, patient, and highly empathetic mock interview coach.
Interview Role: ${context.jobTitle || "Junior Developer"}
Job Description: ${context.jobDescription || "Not provided"}
Candidate CV Summary: ${context.cvText || "Not provided"}

# CORE PERSONALITY & VOICE TONE
- Speak in a calm, encouraging, and unhurried tone.
- Keep your answers concise (1 to 3 short sentences max) for low latency.

# HANDLING NERVOUSNESS, STUTTERING & HESITATION
1. PATIENT LISTENING:
   - Candidates may stutter, repeat words, or take long mid-sentence pauses (e.g., "I... I think... um...").
   - DO NOT interrupt or finish their sentences while they are struggling to speak. Allow them space.

2. GENTLE REASSURANCE:
   - If the candidate stutters heavily, expresses nerves, or blocks in silence, offer warm reassurance before asking your question (e.g., "No rush at all! Take a breath, you're doing great.").

# INTERVIEW FLOW
- Ask one relevant question at a time tailored to the job description.
- Keep the interaction feeling like a supportive conversation.`;

  try {
    const geminiSession = await ai.live.connect({
      model: "gemini-2.5-flash-native-audio-preview-12-2025",
      config: {
        responseModalities: [Modality.AUDIO],
        outputAudioTranscription: {},
        inputAudioTranscription: {},
        systemInstruction,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Aoede" },
          },
        },
      },
      callbacks: {
        onopen: () => {
          console.log("Gemini session opened");
          if (clientSocket.readyState === 1) {
            clientSocket.send(JSON.stringify({ type: "ready" }));
          }
        },
        onmessage: (message) => {
          if (clientSocket.readyState !== 1) return;

          const serverContent = message.serverContent;

          // Handle interruption
          if (serverContent?.interrupted) {
            clientSocket.send(JSON.stringify({ type: "interrupted" }));
            return;
          }

          // Mavis spoken response transcript
          if (serverContent?.outputTranscription?.text) {
            const text = serverContent.outputTranscription.text;
            if (currentSpeaker !== "Mavis") {
              fullTranscript += `\nMavis: `;
              currentSpeaker = "Mavis";
            }
            fullTranscript += text;
            clientSocket.send(
              JSON.stringify({ type: "mavis_transcript", text }),
            );
          }

          // Candidate spoken input transcript
          if (serverContent?.inputTranscription?.text) {
            const text = serverContent.inputTranscription.text;
            if (currentSpeaker !== "Candidate") {
              fullTranscript += `\nCandidate: `;
              currentSpeaker = "Candidate";
            }
            fullTranscript += text;
            clientSocket.send(
              JSON.stringify({ type: "candidate_transcript", text }),
            );
          }

          // Audio output
          if (message.data) {
            clientSocket.send(
              JSON.stringify({ type: "audio", data: message.data }),
            );
          }

          if (serverContent?.turnComplete) {
            clientSocket.send(JSON.stringify({ type: "turn_complete" }));
          }
        },
        onerror: (err) => {
          console.error("Gemini Live error:", err);
          if (clientSocket.readyState === 1) {
            clientSocket.send(
              JSON.stringify({ type: "error", message: err.message }),
            );
          }
        },
        onclose: (event) => {
          console.log(
            "Gemini session closed:",
            event?.reason || "normal close",
          );
          onSessionEnd(fullTranscript.trim());
        },
      },
    });

    clientSocket.on("message", (rawMessage) => {
      try {
        const msg = JSON.parse(rawMessage);

        if (msg.type === "audio_chunk" && msg.data) {
          geminiSession.sendRealtimeInput({
            audio: {
              data: msg.data,
              mimeType: "audio/pcm;rate=16000",
            },
          });
        }

        if (msg.type === "end_session") {
          geminiSession.close();
        }
      } catch (err) {
        console.error("WS parse error:", err);
      }
    });

    clientSocket.on("close", () => {
      geminiSession.close();
    });
  } catch (err) {
    console.error("Failed to start Gemini session:", err);
    clientSocket.send(
      JSON.stringify({
        type: "error",
        message: "Failed to connect to Gemini Live API.",
      }),
    );
  }
}

module.exports = { startMavisSession };
