// The word classifier plus man-page features, with the slot filler (lib/context.mjs).
import { trainedBaseline } from "./lib/context.mjs";

export default trainedBaseline("classifier", { man: true });
