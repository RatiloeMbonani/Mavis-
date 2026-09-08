require("dotenv").config();
const path = require("node:path");
const { cli, defineAgent, ServerOptions, voice, llm } = require("@livekit/agents");
const google = require("@livekit/agents-plugin-google");
const { z } = require("zod");

const { ROLE_SYSTEM_INSTRUCTION } = require("../Config/roleSystemInstruction.local");

const parseMetadata = (metadata) => {
  try {
    return JSON.parse(metadata || "{}");
  } catch {
    return {};
  }
};

// Combines the shared interviewer persona/behavior rules (ROLE_SYSTEM_INSTRUCTION)
// with the per-interview context (role, job description, candidate CV). The
// persona rules themselves live in Config/roleSystemInstruction.local so they
// aren't duplicated or drift out of sync across files.
const buildSystemInstruction = (metadata) => `${ROLE_SYSTEM_INSTRUCTION}

# INTERVIEW CONTEXT
You are Mavis, conducting a structured mock interview for the role: ${metadata.jobTitle || "Junior Developer"}.

Job Description: ${metadata.jobDescription || "Not provided"}

Candidate Background:
${metadata.cvText || "Not provided"}`;

// Sends this interview's collected per-answer evaluations to the backend so
// they're actually persisted, since the agent process has no direct
// database access of its own. Uses a shared internal API key rather than a
// user JWT, since there's no logged-in user context inside the agent.
const flushEvaluationsToBackend = async (interviewId, answerEvaluations) => {
  if (!interviewId || !answerEvaluations?.length) return;

  const backendUrl =
    process.env.BACKEND_INTERNAL_URL || "http://localhost:5000";

  try {
    const res = await fetch(
      `${backendUrl}/interviews/${interviewId}/evaluations`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-internal-api-key": process.env.INTERNAL_API_KEY || "",
        },
        body: JSON.stringify({ answerEvaluations }),
      }
    );

    if (!res.ok) {
      console.error(
        "Failed to flush answer evaluations:",
        res.status,
        await res.text().catch(() => "")
      );
    }
  } catch (err) {
    console.error("Error flushing answer evaluations to backend:", err);
  }
};

const agentDefinition = defineAgent({
  async entry(ctx) {
    await ctx.connect();
    console.log("Mavis joined the interview room:", ctx.room.name);

    const metadata = parseMetadata(ctx.room.metadata || ctx.job.metadata);
    const systemInstruction = buildSystemInstruction(metadata);

    // Room names are created as `mavis-interview-<interviewId>` — reused
    // here to know which interview these evaluations belong to.
    const interviewId = ctx.room.name?.replace("mavis-interview-", "");

    ctx.userData = ctx.userData || {};
    ctx.userData.answerEvaluations = [];

    const submitAnswerEvaluation = llm.tool({
      description:
        "Call this immediately after evaluating a candidate's answer to a question, whether or not the answer was fully complete. Do not wait until the end of the interview.",
      parameters: z.object({
        questionText: z.string().describe("The exact question that was asked."),
        hasSituation: z
          .boolean()
          .describe("Did the answer describe a real, specific situation or context?"),
        hasAction: z
          .boolean()
          .describe("Did the answer describe what the candidate personally did?"),
        hasResult: z
          .boolean()
          .describe("Did the answer describe a concrete outcome or result?"),
        structureScore: z
          .number()
          .min(0)
          .max(10)
          .describe("How well-structured the answer was, 0-10."),
        specificityScore: z
          .number()
          .min(0)
          .max(10)
          .describe("How specific/concrete vs. vague the answer was, 0-10."),
        relevanceScore: z
          .number()
          .min(0)
          .max(10)
          .describe("How relevant the answer was to the question asked, 0-10."),
        followUpNeeded: z
          .boolean()
          .describe("Whether a follow-up probe is needed before moving on."),
        notes: z.string().describe("Brief internal note on why this score was given."),
      }),
      execute: async (evaluation) => {
        ctx.userData.answerEvaluations.push({
          ...evaluation,
          timestamp: new Date().toISOString(),
        });

        return { recorded: true };
      },
    });

    const gemini = new google.realtime.RealtimeModel({
      model:
        process.env.GEMINI_LIVE_MODEL ||
        "gemini-3.1-flash-live-preview",
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
      userAwayTimeout: 8,
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

    let candidateIsAway = false;
    let previousAgentState = null;

    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (event) => {
      if (event.newState === "speaking" && previousAgentState !== "speaking") {
        console.log("Gemini response started");
      }
      if (event.newState === "listening" && previousAgentState === "speaking") {
        console.log("Gemini response completed");
      }
      previousAgentState = event.newState;
    });

    session.on(voice.AgentSessionEventTypes.UserStateChanged, (event) => {
      if (event.newState === "away") {
        if (candidateIsAway) return;

        candidateIsAway = true;
        console.log("Candidate became quiet");
        console.log("Reminder requested");
        console.log(
          "Gemini realtime does not expose a proactive response method in the installed SDK; waiting for the candidate to speak."
        );
        return;
      }

      if (candidateIsAway) {
        candidateIsAway = false;
        console.log("Candidate returned");
      }
    });

    // Flush whatever evaluations were collected once the session actually
    // closes, e.g. the candidate ends the call normally.
    session.on(voice.AgentSessionEventTypes.SessionClosed, async () => {
      await flushEvaluationsToBackend(interviewId, ctx.userData.answerEvaluations);
    });

    await session.start({
      agent: new voice.Agent({
        instructions: systemInstruction,
        tools: { submitAnswerEvaluation },
      }),
      room: ctx.room,
    });

    console.log(
      "Gemini realtime session is active; the initial response will start when the candidate speaks."
    );
  },
});

module.exports = agentDefinition;

if (require.main === module) {
  cli.runApp(new ServerOptions({ agent: path.resolve(__filename) }));
}
