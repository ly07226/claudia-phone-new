# Float memory trigger: verified upstream call site

Upstream: https://github.com/POPCORNqy/float-android/blob/main/lib/chat-engine.ts#L2636-L2648
Source SHA: e7d0ef1a4db61d9beb29c36a3c99fe339557ba1a
License: AGPL-3.0

This file documents the upstream implementation. It is not wired into Claudia Phone.

```ts
                }
            }
        }
    }

    // Memory: increment event counter + check if summarization needed (non-blocking)
    (async () => {
        try {
            incrementEventCounter(character.id); // user message
            incrementEventCounter(character.id); // AI reply
            await maybeRunSummarization(character.id, character.name);
        } catch (err) {
            console.warn("[ChatEngine] Memory counter/summarization failed:", err);
        }
    })();

    return { parts };
}

```

The chat engine increments the per-character counter for both user and AI messages and invokes maybeRunSummarization without awaiting the surrounding asynchronous function. The summarizer checks autoSummarizeEnabled, event threshold and a per-character in-memory lock, then resolves main or auxiliary API, reads the native timeline since the last successful summary, generates and saves long-term memories, and updates the timestamp/counter. The upstream code alone does not prove a startup resume hook exists.
