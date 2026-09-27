require("dotenv").config();
const path = require("node:path");
const { cli, defineAgent, ServerOptions, voice, llm } = require("@livekit/agents");
const google = require("@livekit/agents-plugin-google");
const { z } = require("zod");

const { ROLE_SYSTEM_INSTRUCTION } = require("../Config/roleSystemInstruction.local");

const DEFAULT_AGENT_MODE = "realtime";
const DEFAULT_GEMINI_LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";
const DEFAULT_GEMINI_LLM_MODEL = "gemini-2.5-flash";
const DEFAULT_GEMINI_STT_MODEL = "gemini-3.5-transcribe-live";
const DEFAULT_GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview";
const DEFAULT_GEMINI_VOICE = "Aoede";
const DEFAULT_LIVE_TRANSCRIPTION_ENABLED = true;
const DEFAULT_USER_AWAY_TIMEOUT_SECONDS = null;
const DEFAULT_AWAY_NUDGE_COOLDOWN_SECONDS = 45;
const DEFAULT_ENDPOINTING_MIN_DELAY_MS = 650;
const DEFAULT_ENDPOINTING_MAX_DELAY_MS = 2500;
const DEFAULT_INTERRUPTION_MIN_DURATION_MS = 900;
const DEFAULT_INTERRUPTION_MIN_WORDS = 2;
const DEFAULT_TTS_READ_IDLE_TIMEOUT_MS = 45000;
const DEFAULT_FORWARD_AUDIO_IDLE_TIMEOUT_MS = 45000;

const parsePositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseOptionalPositiveNumber = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;

  return parsePositiveNumber(value, fallback);
};

const parseNonNegativeInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const parseBoolean = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;

  return fallback;
};

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
You are Mavis, conducting a structured mock interview for the role: ${metadata.jobTitle || "Not provided"}.

Job Description: ${metadata.jobDescription || "Not provided"}

Candidate Background:
${metadata.cvText || "Not provided"}`;

// Sends this interview's collected per-answer evaluations to the backend so
// they're actually persisted, since the agent process has no direct
// database access of its own. Uses a shared internal API key rather than a
// user JWT, since there's no logged-in user context inside the agent.
const flushEvaluationsToBackend = async (interviewId, answerEvaluations) => {
  if (!interviewId || !answerEvaluations?.length) return true;

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
      return false;
    }

    console.log("Flushed answer evaluations to backend:", {
      interviewId,
      count: answerEvaluations.length,
    });
    return true;
  } catch (err) {
    console.error("Error flushing answer evaluations to backend:", err);
    return false;
  }
};

const flushTokenUsageToBackend = async (userId, tokenUsage) => {
  if (!userId || !tokenUsage?.totalTokens) return true;

  const backendUrl =
    process.env.BACKEND_INTERNAL_URL || "http://localhost:5000";

  try {
    const res = await fetch(
      `${backendUrl}/users/${userId}/token-usage`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-internal-api-key": process.env.INTERNAL_API_KEY || "",
        },
        body: JSON.stringify(tokenUsage),
      }
    );

    if (!res.ok) {
      console.error(
        "Failed to flush token usage:",
        res.status,
        await res.text().catch(() => "")
      );
      return false;
    }

    console.log("Flushed token usage to backend:", {
      userId,
      totalTokens: tokenUsage.totalTokens,
    });
    return true;
  } catch (err) {
    console.error("Error flushing token usage to backend:", err);
    return false;
  }
};

const addTokenUsage = (target, usage) => {
  target.promptTokens += usage.promptTokens;
  target.responseTokens += usage.responseTokens;
  target.thoughtsTokens += usage.thoughtsTokens;
  target.totalTokens += usage.totalTokens;
};

const emptyTokenUsage = () => ({
  promptTokens: 0,
  responseTokens: 0,
  thoughtsTokens: 0,
  totalTokens: 0,
});

const buildTurnHandling = (turnDetection) => ({
  turnDetection,
  endpointing: {
    mode: "dynamic",
    minDelay: parsePositiveNumber(
      process.env.MAVIS_ENDPOINTING_MIN_DELAY_MS,
      DEFAULT_ENDPOINTING_MIN_DELAY_MS
    ),
    maxDelay: parsePositiveNumber(
      process.env.MAVIS_ENDPOINTING_MAX_DELAY_MS,
      DEFAULT_ENDPOINTING_MAX_DELAY_MS
    ),
  },
  interruption: {
    mode: "adaptive",
    minDuration: parsePositiveNumber(
      process.env.MAVIS_INTERRUPTION_MIN_DURATION_MS,
      DEFAULT_INTERRUPTION_MIN_DURATION_MS
    ),
    minWords: parseNonNegativeInteger(
      process.env.MAVIS_INTERRUPTION_MIN_WORDS,
      DEFAULT_INTERRUPTION_MIN_WORDS
    ),
    resumeFalseInterruption: true,
  },
});

const buildVoiceSessionOptions = (systemInstruction) => {
  const mode = (process.env.MAVIS_AGENT_MODE || DEFAULT_AGENT_MODE).toLowerCase();
  const voiceName = process.env.MAVIS_GEMINI_VOICE || DEFAULT_GEMINI_VOICE;
  const userAwayTimeout = parseOptionalPositiveNumber(
    process.env.MAVIS_USER_AWAY_TIMEOUT_SECONDS,
    DEFAULT_USER_AWAY_TIMEOUT_SECONDS
  );
  const liveTranscriptionEnabled = parseBoolean(
    process.env.MAVIS_ENABLE_LIVE_TRANSCRIPTION,
    DEFAULT_LIVE_TRANSCRIPTION_ENABLED
  );
  const startOptions = {
    outputOptions: {
      transcriptionEnabled: liveTranscriptionEnabled,
      syncTranscription: liveTranscriptionEnabled,
    },
  };
  const idleTimeoutOptions = {
    ttsReadIdleTimeout: parsePositiveNumber(
      process.env.MAVIS_TTS_READ_IDLE_TIMEOUT_MS,
      DEFAULT_TTS_READ_IDLE_TIMEOUT_MS
    ),
    forwardAudioIdleTimeout: parsePositiveNumber(
      process.env.MAVIS_FORWARD_AUDIO_IDLE_TIMEOUT_MS,
      DEFAULT_FORWARD_AUDIO_IDLE_TIMEOUT_MS
    ),
  };

  if (mode === "realtime") {
    const realtimeModel = new google.realtime.RealtimeModel({
      model: process.env.GEMINI_LIVE_MODEL || DEFAULT_GEMINI_LIVE_MODEL,
      apiKey: process.env.GOOGLE_API_KEY,
      instructions: systemInstruction,
      voice: voiceName,
      inputAudioTranscription: liveTranscriptionEnabled ? {} : null,
      outputAudioTranscription: liveTranscriptionEnabled ? {} : null,
      thinkingConfig: {
        thinkingBudget: parseNonNegativeInteger(
          process.env.MAVIS_GEMINI_THINKING_BUDGET,
          0
        ),
      },
    });

    return {
      mode,
      liveTranscriptionEnabled,
      sessionOptions: {
        llm: realtimeModel,
        turnHandling: buildTurnHandling("realtime_llm"),
        userAwayTimeout,
        ...idleTimeoutOptions,
      },
      startOptions,
    };
  }

  console.warn(
    "MAVIS_AGENT_MODE=pipeline is experimental with the Gemini Developer API. " +
      "If Gemini STT fails with languageCodes errors, unset MAVIS_AGENT_MODE to use realtime mode."
  );

  const llmModel = new google.LLM({
    model: process.env.MAVIS_LLM_MODEL || DEFAULT_GEMINI_LLM_MODEL,
    apiKey: process.env.GOOGLE_API_KEY,
    temperature: parsePositiveNumber(process.env.MAVIS_LLM_TEMPERATURE, 0.4),
    maxOutputTokens: parsePositiveNumber(process.env.MAVIS_LLM_MAX_OUTPUT_TOKENS, 600),
    thinkingConfig: {
      thinkingBudget: parseNonNegativeInteger(
        process.env.MAVIS_GEMINI_THINKING_BUDGET,
        0
      ),
    },
  });

  const sttModel = new google.beta.GeminiSTT({
    model: process.env.MAVIS_STT_MODEL || DEFAULT_GEMINI_STT_MODEL,
    language: process.env.MAVIS_STT_LANGUAGE || "en-US",
    apiKey: process.env.GOOGLE_API_KEY,
  });

  const ttsModel = new google.beta.TTS({
    model: process.env.MAVIS_TTS_MODEL || DEFAULT_GEMINI_TTS_MODEL,
    voiceName,
    apiKey: process.env.GOOGLE_API_KEY,
    instructions:
      process.env.MAVIS_TTS_INSTRUCTIONS ||
      "Speak naturally and clearly. Do not add words that are not in the text.",
  });

  return {
    mode: "pipeline",
    liveTranscriptionEnabled,
    sessionOptions: {
      stt: sttModel,
      llm: llmModel,
      tts: ttsModel,
      turnHandling: buildTurnHandling("stt"),
      userAwayTimeout,
      ...idleTimeoutOptions,
    },
    startOptions,
  };
};

const metricsToTokenUsage = (metrics) => {
  if (metrics?.type === "realtime_model_metrics") {
    const promptTokens = Number(metrics.inputTokens || 0);
    const responseTokens = Number(metrics.outputTokens || 0);
    const totalTokens = Number(metrics.totalTokens || 0);
    const thoughtsTokens = Math.max(totalTokens - promptTokens - responseTokens, 0);

    return {
      promptTokens,
      responseTokens,
      thoughtsTokens,
      totalTokens,
    };
  }

  if (metrics?.type === "llm_metrics") {
    const promptTokens = Number(metrics.promptTokens || 0);
    const responseTokens = Number(metrics.completionTokens || 0);
    const totalTokens = Number(metrics.totalTokens || promptTokens + responseTokens);

    return {
      promptTokens,
      responseTokens,
      thoughtsTokens: 0,
      totalTokens,
    };
  }

  if (metrics?.type === "stt_metrics" || metrics?.type === "tts_metrics") {
    const promptTokens = Number(metrics.inputTokens || 0);
    const responseTokens = Number(metrics.outputTokens || 0);
    const totalTokens = promptTokens + responseTokens;

    return {
      promptTokens,
      responseTokens,
      thoughtsTokens: 0,
      totalTokens,
    };
  }

  return null;
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
    const userId = metadata.userId;

    ctx.userData = ctx.userData || {};
    ctx.userData.answerEvaluations = [];
    ctx.userData.pendingAnswerEvaluations = [];
    ctx.userData.tokenUsage = emptyTokenUsage();
    ctx.userData.pendingTokenUsage = emptyTokenUsage();

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
        const recordedEvaluation = {
          ...evaluation,
          timestamp: new Date().toISOString(),
        };

        ctx.userData.answerEvaluations.push(recordedEvaluation);
        ctx.userData.pendingAnswerEvaluations.push(recordedEvaluation);

        const saved = await flushEvaluationsToBackend(interviewId, [recordedEvaluation]);
        if (saved) {
          ctx.userData.pendingAnswerEvaluations =
            ctx.userData.pendingAnswerEvaluations.filter(
              (pendingEvaluation) => pendingEvaluation !== recordedEvaluation
            );
        }

        return { recorded: true, saved };
      },
    });

    const {
      mode: agentMode,
      liveTranscriptionEnabled,
      sessionOptions,
      startOptions,
    } = buildVoiceSessionOptions(systemInstruction);
    console.log("Starting Mavis voice session:", {
      mode: agentMode,
      liveTranscriptionEnabled,
    });

    const session = new voice.AgentSession({
      ...sessionOptions,
    });

    let candidateIsAway = false;
    let previousAgentState = null;
    let pendingReminderMetrics = false;
    let lastAwayNudgeAt = 0;
    let sessionClosed = false;
    const awayNudgeCooldownMs =
      parsePositiveNumber(
        process.env.MAVIS_AWAY_NUDGE_COOLDOWN_SECONDS,
        DEFAULT_AWAY_NUDGE_COOLDOWN_SECONDS
      ) * 1000;
    const isSessionRunning = () => (
      !sessionClosed
      && !session._closing
      && Boolean(session._activity)
    );
    let transcriptSequence = 0;
    const publishTranscriptAttributes = (role, text, options = {}) => {
      const cleanedText = String(text || "").trim();
      if (!cleanedText) return;

      transcriptSequence += 1;
      const transcriptEvent = {
        id: options.id || `${role}-${transcriptSequence}`,
        role,
        text: cleanedText,
        final: Boolean(options.final),
        sequence: transcriptSequence,
        timestamp: new Date().toISOString(),
      };
      const legacyTextKey = role === "candidate" ? "candidate_text" : "mavis_text";
      const eventKey =
        role === "candidate" ? "candidate_transcript_event" : "mavis_transcript_event";

      ctx.room.localParticipant.setAttributes({
        [legacyTextKey]: cleanedText,
        [eventKey]: JSON.stringify(transcriptEvent),
        transcript_event: JSON.stringify(transcriptEvent),
      }).catch((err) => {
        console.error("Failed to publish transcript attributes:", err);
      });
    };

    // Stream transcripts as room attributes so the client/UI can render live captions
    // and so the full transcript is available afterward for the offline scoring pass.
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (event) => {
      if (event.isFinal && event.transcript) {
        candidateIsAway = false;
        publishTranscriptAttributes("candidate", event.transcript, {
          id: event.itemId,
          final: true,
        });
      }
    });

    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (event) => {
      const text = event.item?.textContent;
      if (event.item?.role === "assistant" && text) {
        publishTranscriptAttributes("mavis", text, {
          id: event.item?.id,
          final: true,
        });
      }
    });

    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (event) => {
      if (event.newState === "speaking" && previousAgentState !== "speaking") {
        console.log("Gemini response started");
      }
      if (event.newState === "listening" && previousAgentState === "speaking") {
        console.log("Gemini response completed");
      }
      previousAgentState = event.newState;
    });

    session.on(voice.AgentSessionEventTypes.MetricsCollected, async (event) => {
      const usageDelta = metricsToTokenUsage(event.metrics);
      if (!usageDelta?.totalTokens) return;

      addTokenUsage(ctx.userData.tokenUsage, usageDelta);

      if (pendingReminderMetrics) {
        console.log("Flushed reminder token usage:", usageDelta);
        pendingReminderMetrics = false;
      }

      const saved = await flushTokenUsageToBackend(userId, usageDelta);
      if (!saved) {
        addTokenUsage(ctx.userData.pendingTokenUsage, usageDelta);
      }
    });

    session.on(voice.AgentSessionEventTypes.Error, (event) => {
      const sessionError = event.error || {};
      const sourceLabel =
        typeof event.source?.label === "function"
          ? event.source.label()
          : event.source?.label;

      console.error("Mavis voice session error:", {
        type: sessionError.type,
        label: sessionError.label || sourceLabel,
        recoverable: sessionError.recoverable,
        message: sessionError.error?.message || sessionError.message,
        statusCode: sessionError.error?.statusCode || sessionError.statusCode,
      });

      ctx.room.localParticipant.setAttributes({
        mavis_error: JSON.stringify({
          type: sessionError.type || "voice_error",
          label: sessionError.label || sourceLabel,
          recoverable: Boolean(sessionError.recoverable),
          message:
            sessionError.error?.message ||
            sessionError.message ||
            "Voice session error",
        }),
      });
    });

    session.on(voice.AgentSessionEventTypes.UserStateChanged, async (event) => {
      if (event.newState === "away") {
        if (!isSessionRunning()) {
          console.log("Away nudge skipped because the agent session is not running");
          return;
        }

        if (candidateIsAway) return;

        const now = Date.now();
        if (now - lastAwayNudgeAt < awayNudgeCooldownMs) {
          candidateIsAway = true;
          console.log("Candidate became quiet; away nudge skipped due to cooldown");
          return;
        }

        candidateIsAway = true;
        lastAwayNudgeAt = now;
        console.log("Candidate became quiet");
        console.log("Reminder requested");

        try {
          if (typeof session.say === "function") {
            await session.say("Take your time. When you're ready, keep going from where you left off.");
          } else {
            pendingReminderMetrics = true;
            await session.generateReply({
              instructions:
                "The candidate has gone quiet. Gently check in with one short line. " +
                "Do not repeat the previous question and do not ask multiple questions.",
              allowInterruptions: true,
            });
          }
        } catch (err) {
          pendingReminderMetrics = false;
          console.error("Away nudge failed:", err);
        }
        return;
      }

      if (candidateIsAway) {
        candidateIsAway = false;
        console.log("Candidate returned");
      }
    });

    // Flush whatever evaluations were collected once the session actually
    // closes, e.g. the candidate ends the call normally.
    session.on(voice.AgentSessionEventTypes.Close, async () => {
      sessionClosed = true;
      ctx.room.localParticipant.setAttributes({
        mavis_session_state: "closed",
      });

      const saved = await flushEvaluationsToBackend(
        interviewId,
        ctx.userData.pendingAnswerEvaluations
      );

      if (saved) {
        ctx.userData.pendingAnswerEvaluations = [];
      }

      const tokenUsageSaved = await flushTokenUsageToBackend(userId, ctx.userData.pendingTokenUsage);
      if (tokenUsageSaved) {
        ctx.userData.pendingTokenUsage = emptyTokenUsage();
      }
    });

    await session.start({
      agent: new voice.Agent({
        instructions: systemInstruction,
        tools: { submitAnswerEvaluation },
      }),
      room: ctx.room,
      ...startOptions,
    });

    console.log(
      `Mavis ${agentMode} voice session is active; the initial response will start when the candidate speaks.`
    );
  },
});

module.exports = agentDefinition;

if (require.main === module) {
  cli.runApp(new ServerOptions({ agent: path.resolve(__filename) }));
}
