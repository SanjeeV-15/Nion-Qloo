// Hearing. Wraps Chrome's built-in speech recognition, which turns what the
// microphone hears into text. Chrome sends the audio to its own speech service
// to do this, so it needs an internet connection.

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const speechInSupported = Boolean(SpeechRecognition);

/**
 * Creates a listener.
 *   onText(text):      called each time Chrome finishes hearing a phrase
 *   onInterim(text):   called with the first few words as soon as someone starts
 *                      talking, before the phrase is finished (lets Nion react
 *                      quickly when it is interrupted)
 *   onProblem(reason): called with "mic-blocked" or "network" when listening can't work
 *   onEvent(name):     called when Chrome's recogniser starts, stops, hears sound or
 *                      speech, or fails. Only used to show what is happening when
 *                      something doesn't work.
 * Returns { start(), stop() }.
 */
export function createListener({ onText, onInterim, onProblem, onEvent }) {
  let recognition = null;
  let wanted = false; // do we want to be listening right now?
  let restartTimer = null;

  function build() {
    const r = new SpeechRecognition();
    r.lang = "en-US";
    r.continuous = true; // keep listening after each phrase
    r.interimResults = true; // also report words as they are being said

    r.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (result.isFinal) onText(text);
        else if (text) onInterim?.(text);
      }
    };

    r.onstart = () => onEvent?.("recogniser started");
    r.onspeechstart = () => onEvent?.("speech detected");
    r.onspeechend = () => onEvent?.("speech ended");

    r.onerror = (event) => {
      onEvent?.(`recogniser error: ${event.error}`);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        wanted = false;
        onProblem("mic-blocked");
      } else if (event.error === "network") {
        onProblem("network");
      }
      // "no-speech" and "aborted" are normal and need no action.
    };

    // Chrome stops listening by itself every so often. If we still want to be
    // listening, start again a moment later.
    r.onend = () => {
      onEvent?.("recogniser stopped");
      if (wanted) restartTimer = setTimeout(startQuietly, 250);
    };

    return r;
  }

  function startQuietly() {
    try {
      recognition.start();
    } catch {
      // Already running: nothing to do.
    }
  }

  return {
    start() {
      wanted = true;
      recognition ??= build();
      startQuietly();
    },
    stop() {
      wanted = false;
      clearTimeout(restartTimer);
      try {
        recognition?.abort(); // abort drops anything half-heard instead of reporting it
      } catch {
        // Not running: nothing to do.
      }
    },
  };
}
