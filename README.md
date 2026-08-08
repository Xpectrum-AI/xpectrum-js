# xpectrum

> Official Xpectrum AI SDK — add AI chat and real-time voice to any website or app.

```bash
npm install xpectrum
```

Two capabilities, one package:

| | class | talks to |
|---|---|---|
**Chat** | `XpectrumChat` | your Xpectrum API — OpenAI-compatible endpoint |
**Voice** | `XpectrumVoice` | your voice server + LiveKit WebRTC |

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
console.log(res.conversationId);   // pass back in to continue the conversation

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
  conversationId: first.conversationId,
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

### Cancelling

```typescript
const controller = new AbortController();
chat.stream('Long question…', {
  getAbortController: (c) => c.abort(),   // or keep it and abort later
});

chat.destroy();   // aborts every in-flight stream
```

### Chat API

| method | returns |
|---|---|
`send(prompt, options?)` | `Promise<ChatResult>` — the complete reply |
`stream(prompt, options?)` | `Promise<ChatResult>` — plus `onToken` per token |
`listModels()` | `Promise<ModelInfo[]>` |
`destroy()` | aborts in-flight streams |

`ChatResult` carries `content`, `conversationId`, `messageId`, `taskId`, `usage`, `finishReason`, and `retrieverResources` when the app has retrieval enabled.

Errors go to `onError` if you supply it; otherwise they throw, so promise-style
callers never get a silently empty result.

> **Note:** `send()` streams internally and assembles the reply, so it works for
> chatbot, agent and chatflow apps alike. Passing `blocking: true` issues a single
> non-streaming request instead — slightly cheaper, but the API rejects blocking
> mode for **agent** apps, so leave it off unless you know the app type.

---

## Quick Start — Voice

```typescript
import { XpectrumVoice } from 'xpectrum';

const voice = new XpectrumVoice({
  baseUrl: 'https://voice.yourserver.com',   // your voice server
  apiKey: 'xpectrum_ai_sk_...',
  agentName: 'my-sales-agent',
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

The whole SDK talks to four routes:

```
POST /chat/completions        chat — send a message, stream the reply
GET  /models                  chat — list the model this key reaches
POST /tokens/generate         voice — get a LiveKit room token
POST /call-control/end-call   voice — end a call
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
`chat.getAppParams()` | removed — set `welcomeMessage` in config |
`onThought` / `onFile` / `onTTSChunk` | not available |
conversation list / feedback / speech-to-text | not available |

---

## License

MIT © Xpectrum AI
