// PLACEHOLDER: the runtime owner replaces this file with the real assistant.

import type { Assistant } from "../serve/assistant.js";

export function createAssistant(): Assistant {
  return {
    name: "noodle",
    async *reply() {
      yield "I can't understand messages yet: ";
      yield "my runtime is ";
      yield "still being built.";
    },
  };
}
