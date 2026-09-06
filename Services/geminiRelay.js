require("dotenv").config();
const path = require("node:path");
const { cli, defineAgent, ServerOptions, voice } = require("@livekit/agents");
const google = require("@livekit/agents-plugin-google");

const { ROLE_SYSTEM_INSTRUCTION } = require("../Config/roleSystemInstruction.local");

const parseMetadata = (metadata) => {
  try {
    return JSON.parse(metadata || "{}");
  } catch {
    return {};
  }
};

const buildSystemInstruction = (metadata) => `${ROLE_SYSTEM_INSTRUCTION}

# INTERVIEW CONTEXT
You are Mavis, conducting a structured mock interview for the role: ${metadata.jobTitle || "Junior Developer"}.

Job Description: ${metadata.jobDescription || "Not provided"}

Candidate Background:
${metadata.cvText || "Not provided"}`;

const agentDefinition = defineAgent({
  async entry(ctx) {
    await ctx.connect();
    console.log("Mavis joined the interview room:", ctx.room.name);

    const metadata = parseMetadata(ctx.room.metadata || ctx.job.metadata);
    const systemInstruction = buildSystemInstruction(metadata);

    const gemini = new google.realtime.RealtimeModel({
      model:
        process.env.GEMINI_LIVE_MODEL ||
        "gemini-2.5-flash-native-audio-preview-12-2025",
      apiKey: process.env.GOOGLE_API_KEY,
      instructions: systemInstruction,
      voice: "Aoede",
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    });

    const session = new voice.AgentSession({
      llm: gemini,
      turnHandling: {
        turnDetection: "realtime_llm",
        endpointing: {
          minDelay: 300,
          maxDelay: 900,
        },
        interruption: {
          mode: "adaptive",
          minDuration: 300,
          resumeFalseInterruption: true,
        },
      },
    });

    // Stream transcripts as room attributes so the client/UI can render live captions
    // and so the full transcript is available afterward for the offline scoring pass.
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (event) => {
      if (event.isFinal && event.transcript) {
        ctx.room.localParticipant.setAttributes({
          candidate_text: event.transcript,
        });
      }
    });

    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (event) => {
      const text = event.item?.textContent;
      if (event.item?.role === "assistant" && text) {
        ctx.room.localParticipant.setAttributes({ mavis_text: text });
      }
    });

    await session.start({
      agent: new voice.Agent({ instructions: systemInstruction }),
      room: ctx.room,
    });

    session.generateReply({
      instructions:
        "Briefly introduce yourself as the interviewer and ask the first question. No warm-up small talk — get straight into it.",
      allowInterruptions: true,
    });
  },
});

module.exports = agentDefinition;

if (require.main === module) {
  cli.runApp(new ServerOptions({ agent: path.resolve(__filename) }));
}