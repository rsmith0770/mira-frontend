// api/chat/index.js

const { SearchClient, AzureKeyCredential } = require("@azure/search-documents");
const OpenAI = require("openai");

module.exports = async function (context, req) {
  try {
    const { source, question } = req.body || {};
    if (!question) {
      context.res = { status: 400, body: "Missing question." };
      return;
    }

    // Resolve full search endpoint
    const searchEndpoint = process.env.AZURE_SEARCH_SERVICE.startsWith("https://")
      ? process.env.AZURE_SEARCH_SERVICE
      : `https://${process.env.AZURE_SEARCH_SERVICE}.search.windows.net`;

    const searchClient = new SearchClient(
      searchEndpoint,
      process.env.AZURE_SEARCH_INDEX,
      new AzureKeyCredential(process.env.AZURE_SEARCH_KEY)
    );

    // Fetch top-K documents
    const topN = parseInt(process.env.AZURE_SEARCH_TOP_K, 10) || 5;
    const searchPages = await searchClient
      .search(question, { top: topN })
      .byPage()
      .next();

    const docs = searchPages.value.results
      .map(r => r.document.content)
      .filter(Boolean)
      .join("\n---\n");

    // Initialize OpenAI client
    const openai = new OpenAI.OpenAI({
      azure: {
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        deploymentName: process.env.AZURE_OPENAI_MODEL_NAME
      },
      apiKey: process.env.AZURE_OPENAI_KEY
    });

    // Build chat prompt
    const prompt = [
      { role: "system", content: process.env.AZURE_OPENAI_SYSTEM_MESSAGE },
      {
        role: "user",
        content: `Source: ${source}\nQuestion: ${question}\n\nDocs:\n${docs}`
      }
    ];

    // Call Azure OpenAI
    const completion = await openai.chat.completions.create({
      messages: prompt,
      maxTokens: parseInt(process.env.AZURE_OPENAI_MAX_TOKENS, 10),
      temperature: parseFloat(process.env.AZURE_OPENAI_TEMPERATURE),
      topP: parseFloat(process.env.AZURE_OPENAI_TOP_P)
    });

    const answer = completion.choices[0]?.message?.content || "";

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { answer }
    };
  } catch (err) {
    context.log.error("Chat function error:", err);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: {
        error: err.message,
        stack: err.stack
      }
    };
  }
};
