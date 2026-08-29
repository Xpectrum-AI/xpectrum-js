# xpectrum

> Official Xpectrum AI SDK — add AI chat and real-time voice to any website or app.

```bash
npm install xpectrum
```

Two capabilities, one package:

| | class | talks to |
|---|---|---|
**Chat** | `XpectrumChat` | your Xpectrum API — OpenAI-compatible endpoint |
**Voice** | `XpectrumVoice` | Xpectrum API + LiveKit WebRTC |

Both need only a **base URL** and an **API key**, both shown in your console.

---

## Quick Start — Chat

```typescript
import { XpectrumChat } from 'xpectrum';

const chat = new XpectrumChat({
  baseUrl: 'https://app.yourserver.com/v1',   // "API Server" value from the console
  apiKey: 'app-xxxxxxxxxxxx',
  user: 'user-456',                           // optional — separates conversation history
});

// Promise style — resolves with the finished reply
const res = await chat.send('What are your business hours?');
console.log(res.content);
console.log(res.threadId);         // pass back in to continue the thread

// Token by token
await chat.stream('Tell me a story', {
  onToken: (delta, full) => {
    document.getElementById('answer').textContent = full;
  },
  onDone: (result) => console.log('Usage:', result.usage),
  onError: (err) => console.error(err.message),
});
```

### Continuing a conversation

History lives server-side — you never resend it:

```typescript
const first = await chat.send('My name is Vijay.');
const second = await chat.send('What is my name?', {
  threadId: first.threadId,
});
// → "Your name is Vijay."
```

### Images

```typescript
await chat.send([
  {
    role: 'user',
    content: [
      { type: 'text', text: 'What is in this image?' },
      { type: 'image_url', image_url: { url: 'https://example.com/photo.jpg' } },
    ],
  },
]);
```

Both a remote URL and a base64 `data:` URI work.

### Attachments and variables

```typescript
await chat.send('Summarise this', {
  attachments: [
    { type: 'document', url: 'https://example.com/report.pdf' },
    { type: 'image', file_id: '<previously uploaded file id>' },
  ],
  variables: { language: 'en' },   // the agent's input variables
});
```

### Cancelling

```typescript
const controller = new AbortController();
chat.stream('Long question…', {
  getAbortController: (c) => c.abort(),   // or keep it and abort later
});

chat.destroy();   // aborts every in-flight stream
```

### Who the conversation belongs to

Each unique `user` value gets its own private history. **Omit it and the SDK
issues a random anonymous id**, stored per browser, so a visitor keeps their
history without logging in:

```typescript
// Logged in — use your own account id, set on your server
new XpectrumChat({ baseUrl, apiKey, user: session.userId });

// Anonymous — the SDK generates and persists `anon_<uuid>` for you
new XpectrumChat({ baseUrl, apiKey });

chat.getUser();     // 'anon_1a8e8643-2668-4f3e-8b2c-7222d0b872c3'
chat.resetUser();   // forget it and start fresh — "clear my history" / logout
```

The id lives in `localStorage`, scoped to the API base URL so two apps on one
page never share an identity. It expires after 30 days of inactivity
(`anonymousTtlDays` to change), and the clock resets on every use, so an active
visitor is never forgotten.

> **Don't use an IP address for this.** Addresses are shared behind NAT — an
> office, a café, a mobile carrier — so everyone on one connection would land in
> the same history and read each other's conversations. They also change when a
> network changes, silently losing history, and count as personal data. A random
> id is unique per visitor and unguessable, which is what keeps one person's
> history private from another's.

> **For logged-in users, set `user` on your server** from your own session —
> never from something the browser sent you. The API key is the only thing the
> server verifies, so a browser that can choose `user` freely can read any
> user's history. Anonymous ids are self-protecting because they're random;
> account ids usually aren't.

### Past conversations

History lives server-side. List a user's previous conversations, load one, and
carry on where they left off:

```typescript
// Previous conversations, newest first. Titles are generated automatically.
const { data: threads } = await chat.listThreads({ limit: 20 });
// → [{ id, title: 'Learning to count to 5', createdAt, updatedAt }, …]

// Load one transcript, oldest message first
const { data: messages } = await chat.getMessages(threads[0].id);
// → [{ id, role: 'user', content: '…' }, { id, role: 'assistant', content: '…' }]

// Continue that conversation
await chat.send('And what about weekends?', { threadId: threads[0].id });
```

Both are paginated. Pass the previous page's cursor to go further back:

```typescript
const older = await chat.listThreads({ after: page.lastId });
const earlier = await chat.getMessages(threadId, { before: page.firstId });
```

> Cursors address stored rows, so use `page.firstId` / `page.lastId` — not an id
> from `data`.

### Stopping a reply

```typescript
let runId;
chat.stream('Write a long essay', {
  onToken: (d, full) => render(full),
  onDone: (result) => { runId = result.runId; },
});

await chat.cancel(runId);   // tells the server to stop
```

Aborting client-side only stops you *reading* the reply — the model keeps
generating and keeps consuming tokens until `cancel()` is called. For an
immediate UI response, do both:

```typescript
let controller;
const promise = chat.stream(prompt, {
  getAbortController: (c) => { controller = c; },
  onDone: (r) => { runId = r.runId; },
});
controller.abort();          // UI stops now
await chat.cancel(runId);    // server stops too
```

### Follow-up suggestions

Questions the user is likely to ask next, generated from the thread so far.
Costs one model call, so ask only when you're about to show them. Requires the
agent's follow-up suggestions feature to be enabled in the console.

```typescript
const res = await chat.send('How do refunds work?');
const { questions } = await chat.getSuggestions(res.messageId);
// → ['How long does a refund take?', 'Can I get store credit instead?']
```

### Agent info

Describe the agent behind the key — its title, greeting and starter questions —
so a client renders itself from what was configured in the console:

```typescript
const agent = await chat.getAgent();

console.log(agent.title);              // header title
console.log(agent.greeting);           // opening message from the console
console.log(agent.starterQuestions);   // suggested prompts
console.log(agent.mode);               // 'chatbot' | 'agent' | 'flow' | 'workflow'
```

### Chat API

| method | returns |
|---|---|
`getUser()` | `string` — the identity requests are attributed to |
`resetUser()` | `void` — issue a fresh anonymous identity |
`send(prompt, options?)` | `Promise<ChatResult>` — the complete reply |
`stream(prompt, options?)` | `Promise<ChatResult>` — plus `onToken` per token |
`listThreads(options?)` | `Promise<Page<Thread>>` — past conversations |
`getMessages(threadId, options?)` | `Promise<Page<ThreadMessage>>` — one transcript |
`cancel(runId)` | `Promise<void>` — stop a reply server-side |
`getSuggestions(messageId)` | `Promise<Suggestions>` — follow-up questions |
`getAgent()` | `Promise<AgentInfo>` — title, greeting, starter questions |
`listModels()` | `Promise<ModelInfo[]>` — OpenAI-style, one entry: the agent |
`destroy()` | aborts in-flight streams |

`ChatResult` carries `content`, `threadId`, `messageId`, `runId`, `mode`, `usage`, `finishReason`, and `citations` when the agent has retrieval enabled.

Errors go to `onError` if you supply it; otherwise they throw, so promise-style
callers never get a silently empty result.

> **Note:** `send()` streams internally and assembles the reply, so it works for
> chatbot, agent and flow apps alike. Passing `blocking: true` issues a single
> non-streaming request instead — slightly cheaper, but the API rejects blocking
> mode for **agent** apps, so leave it off unless you know the app type.

---

## Workflows

Workflow apps take variables and return outputs rather than chatting:

```typescript
import { XpectrumWorkflow } from 'xpectrum';

const wf = new XpectrumWorkflow({ baseUrl, apiKey: 'workflow app key' });

// Wait for the result
const run = await wf.run({ variables: { topic: 'pricing' } });
console.log(run.status, run.outputs);

// Or follow progress step by step
await wf.stream({
  variables: { topic: 'pricing' },
  onStart: (r) => console.log('run', r.id),
  onStepStart: (s) => console.log('→', s.title),
  onStepComplete: (s) => console.log('✓', s.title, s.status),
  onDone: (run) => console.log(run.outputs),
});

await wf.cancel(runId);   // stop a run in progress
```

`attachments` work the same as in chat.

---

## Knowledge search

Query a knowledge base directly with a **knowledge** API key (workspace-scoped,
not an app key):

```typescript
import { XpectrumKnowledge } from 'xpectrum';

const kb = new XpectrumKnowledge({ baseUrl, apiKey: 'knowledge key' });
const { data } = await kb.search('<knowledge id>', 'refund policy', { limit: 5 });
// → [{ score, content, document_id, chunk_id, position }, …]
```

---

## Quick Start — Voice

```typescript
import { XpectrumVoice } from 'xpectrum';

const voice = new XpectrumVoice({
  baseUrl: 'https://app.yourserver.com/v1',  // same API base + key as chat
  apiKey: 'app-...',
  // The voice agent is determined by the API key.
});

await voice.connect({
  onConnected: (roomName) => console.log('Call started:', roomName),
  onTranscription: (seg) => {
    // seg.speaker = 'user' | 'agent', seg.text, seg.isFinal
    console.log(`${seg.speaker}: ${seg.text}`);
  },
  onAgentSpeaking: (isSpeaking) => setStatus(isSpeaking ? 'Speaking…' : 'Listening'),
  onDisconnected: (reason) => console.log('Ended:', reason),
  onError: (err) => console.error(err.message),
});

await voice.setMicEnabled(false);   // mute
await voice.disconnect();
```

`connect()` fetches a room token from your server, joins over WebRTC, and enables
the microphone. Audio, transcription and speaking detection all arrive through
LiveKit — not HTTP.

### Voice API

| method | purpose |
|---|---|
`connect(callbacks?)` | start a call |
`disconnect()` | end the call |
`setMicEnabled(bool)` / `isMicEnabled()` | mute control |
`getConnectionState()` / `isConnected()` / `getRoomName()` | state |
`destroy()` | hang up and remove listeners |

Also `on()` / `off()` if you prefer events over the `connect()` callbacks.

`livekit-client` installs automatically and is imported **dynamically**, so
chat-only users never download it.

---

## Pre-built widgets

Skip building a UI:

```typescript
import { ChatWidget, VoiceWidget, OmnichannelWidget } from 'xpectrum';

new ChatWidget({
  apiKey: 'app-xxxxxxxxxxxx',
  baseUrl: 'https://app.yourserver.com/v1',
  welcomeMessage: 'Hi! How can I help?',
  position: 'bottom-right',
  buttonColor: '#7C3AED',
  theme: 'light',
});
```

Widgets render inside a **Shadow DOM**, so your page's CSS and theirs can't
interfere with each other. `open()`, `close()`, `toggle()`, `destroy()`.

---

## No-code embed

For sites without a build step:

```html
<script>
  window.XpectrumChatConfig = {
    apiKey: 'YOUR_API_KEY',
    baseUrl: 'https://app.yourserver.com/v1',
    welcomeMessage: 'Hi! How can I help?',
  };
</script>
<script src="https://unpkg.com/xpectrum@1.0.0/dist/chat-embed.min.js" defer></script>
```

**Always pin the version** (`@1.0.0`). An unpinned URL resolves to whatever is
latest, so a future release would reach your live site without you upgrading.

---

## Endpoints used

The whole SDK talks to ten routes:

```
POST /chat/completions              chat      — send a message, stream the reply
GET  /models                        chat      — the agent behind this key (name, greeting, starters)
GET  /threads                       chat      — past conversations
GET  /threads/{id}/messages         chat      — one transcript
GET  /messages/{id}/suggestions     chat      — follow-up questions
POST /runs                          workflow  — run a workflow (blocking or streamed)
POST /runs/{run_id}/cancel          both      — stop a reply or a run
POST /knowledge/{id}/search         knowledge — search a knowledge base
POST /voice/tokens/generate         voice     — get a LiveKit room token
POST /voice/call-control/end-call   voice     — end a call
```

The chat endpoint is **OpenAI-compatible**, so you can also point the official
`openai` package at the same base URL and API key if you'd rather not use this SDK.

---

## Security

The API key is sent from wherever the SDK runs. In a browser that means **any
visitor can read it** in DevTools, so treat a browser-side key as public: scope
it narrowly and rotate it if leaked. For anything sensitive, proxy requests
through your own server so the key never reaches the client.

---

## Requirements

Node 18+ (for built-in `fetch`) or any modern browser. Voice additionally needs
microphone permission and WebRTC.

---

## Migrating from `@xpectrum/sdk`

`@xpectrum/sdk` is the previous package and keeps working — nothing forces you to
move. If you do:

| before | now |
|---|---|
`chat.sendMessage(q, { onMessage })` | `chat.stream(q, { onToken })` |
— | `chat.send(q)` for a plain promise |
`onMessage(text, id, convId)` | `onToken(delta, full)`; ids are on the result |
`onMessageEnd(meta)` | `onDone(result)` |
`chat.getAppParams()` | `chat.getAgent()` |
`chat.stopResponse(taskId)` | `chat.cancel(runId)` |
`chat.getConversations()` | `chat.listThreads()` |
`chat.getMessages(convId)` | `chat.getMessages(threadId)` — now returns one message per turn side |
`onThought` / `onFile` / `onTTSChunk` | not available |
`chat.getSuggestedQuestions(msgId)` | `chat.getSuggestions(messageId)` |
feedback / speech-to-text | not available |

---

## License

MIT © Xpectrum AI
