const { SearchClient, AzureKeyCredential } = require("@azure/search-documents");
const OpenAI = require("openai");

const searchClient = new SearchClient(
  `${process.env.AZURE_SEARCH_SERVICE}.search.windows.net`,
  process.env.AZURE_SEARCH_INDEX,
  new AzureKeyCredential(process.env.AZURE_SEARCH_KEY)
);

const openai = new OpenAI.OpenAI({
  azure: {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    deploymentName: process.env.AZURE_OPENAI_MODEL_NAME
  },
  apiKey: process.env.AZURE_OPENAI_KEY
});

module.exports = async function (context, req) {
  const { source, question } = req.body || {};
  if (!question) {
    context.res = { status: 400, body: "Missing question." };
    return;
  }

  const topN = parseInt(process.env.AZURE_SEARCH_TOP_K, 10) || 5;
  const searchPages = await searchClient.search(question, { top: topN }).byPage().next();
  const docs = searchPages.value.results
    .map(r => r.document.content)
    .filter(Boolean)
    .join("\n---\n");

  const prompt = [
    { role: "system", content: process.env.AZURE_OPENAI_SYSTEM_MESSAGE },
    { role: "user", content: `Source: ${source}\nQuestion: ${question}\n\nDocs:\n${docs}` }
  ];

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
};
