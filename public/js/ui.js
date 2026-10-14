// The state icon. Sets the picture to match what Nion is doing; the CSS does the
// rest (which picture to show, and how it moves).

const LABELS = {
  off: "Nion is off",
  waiting: "Nion is waiting",
  listening: "Nion is listening",
  thinking: "Nion is thinking",
  speaking: "Nion is speaking",
};

/** Show the icon for `state`: off, waiting, listening, thinking or speaking. */
export function showState(state) {
  const orb = document.getElementById("orb");
  if (!orb) return;
  orb.dataset.state = state;
  orb.setAttribute("aria-label", LABELS[state] ?? "");
}

// Handy for trying the icons from the browser's console: nionUI.showState("thinking")
window.nionUI = { showState };
