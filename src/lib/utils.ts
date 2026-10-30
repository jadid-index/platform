import { createCn } from "cn/config";

// The type scale in globals.css (text-display, text-h1, ...) is a font size, not a text color:
// tell the merger, or `cn("text-h1", "text-primary-strong")` would drop the size.
export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: ["display", "h1", "h2", "body", "small"] }] } },
});
