const { GoogleGenAI } = require("@google/genai");
const { MAVIS_SYSTEM_INSTRUCTION } = require("../Config/systemInstruction.local");

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

async function handleMarketingChatStream(req, res) {
  const t0 = Date.now();
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Invalid messages payload." });
    }

    const contents = messages.map((msg) => ({
      role: msg.role === "assistant" ? "model" : msg.role,
      parts: [{ text: msg.content }],
    }));

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const t1 = Date.now();
    console.log(`[timing] setup: ${t1 - t0}ms`);

    const responseStream = await ai.models.generateContentStream({
      model: process.env.GEMINI_TEXT_MODEL || "gemini-3.6-flash",
      contents,
      config: {
        systemInstruction: MAVIS_SYSTEM_INSTRUCTION,
      },
    });

    const t2 = Date.now();
    console.log(`[timing] time to get stream object: ${t2 - t1}ms`);

    let firstChunkLogged = false;
    for await (const chunk of responseStream) {
      if (!firstChunkLogged) {
        console.log(`[timing] time to FIRST chunk: ${Date.now() - t2}ms`);
        firstChunkLogged = true;
      }
      const textChunk = chunk.text;
      if (textChunk) {
        res.write(`data: ${JSON.stringify({ text: textChunk })}\n\n`);
      }
    }

    console.log(`[timing] TOTAL stream duration: ${Date.now() - t2}ms`);
    console.log(`[timing] TOTAL request duration: ${Date.now() - t0}ms`);

    res.write(`data: [DONE]\n\n`);
  } catch (error) {
    console.error("Error in chatbot stream controller:", error);
    res.write(`data: ${JSON.stringify({ error: "Stream interrupted." })}\n\n`);
  } finally {
    res.end();
  }
}

module.exports = { handleMarketingChatStream };