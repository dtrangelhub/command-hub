// Proxies chat messages to the Anthropic API using a server-side key.
// The key lives only in this function's environment (set in Netlify's
// dashboard under Site settings > Environment variables as ANTHROPIC_API_KEY)
// and is never sent to the browser.
//
// Supports tool use so the assistant can log a completed activity as a
// done-task-with-points, or add a new to-do task, directly from chat.
// The actual dashboard state mutation happens client-side — this function
// only forwards the model's tool_use request back to the browser.

const SYSTEM_PROMPT = `You are embedded in Daniel's personal command-center dashboard, in a small chat card.
Be concise and conversational.
If Daniel describes something he already did (e.g. "I went on a run", "I finished the report"), call the log_activity tool to record it as a completed task and award points (10 for a normal/routine activity, 25 for a notable or "best self" level accomplishment), AND include a short natural-language sentence confirming what you logged.
If he describes something he wants to do later (not yet done), call the add_task tool instead, and confirm briefly.
For anything else, just respond normally — don't force a tool call when one isn't relevant.`;

const TOOLS = [
  {
    name: 'log_activity',
    description:
      'Log something the user has already completed today as a done task on the dashboard, awarding points. Use this when the user describes a finished action (past tense / completed), not something planned for later.',
    input_schema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Short label for the completed activity, e.g. "Went on a run"' },
        category: { type: 'string', enum: ['biz', 'ft', 'personal'], description: 'biz = business/work, ft = fitness/health, personal = personal life. Default personal.' },
        points: { type: 'integer', description: 'Points to award. 10 for a normal activity, 25 for a notable/best-self-level one. Default 10.' },
      },
      required: ['description'],
    },
  },
  {
    name: 'add_task',
    description: 'Add a new to-do task to the dashboard for something the user plans to do, not yet completed.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The task text' },
        category: { type: 'string', enum: ['biz', 'ft', 'personal'], description: 'Default biz.' },
      },
      required: ['text'],
    },
  },
];

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server is missing ANTHROPIC_API_KEY. Add it in Netlify > Site settings > Environment variables.' }),
    };
  }

  let messages;
  try {
    const body = JSON.parse(event.body || '{}');
    messages = body.messages;
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: '"messages" array is required' }) };
  }

  // Only forward role + content, last 30 turns max, to keep payload sane.
  const trimmed = messages.slice(-30).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || ''),
  }));

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: trimmed,
      }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) || 'Anthropic API error';
      return { statusCode: resp.status, body: JSON.stringify({ error: msg }) };
    }

    // Return the raw content blocks (text + any tool_use) — the browser
    // decides how to render text and which dashboard mutation to run for
    // each tool_use block.
    return { statusCode: 200, body: JSON.stringify({ content: data.content || [] }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Request failed' }) };
  }
};
