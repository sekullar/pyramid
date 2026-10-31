// Live sync replaces the text under the cursor when the other device types. Keeping the cursor where the
// user was (instead of jumping to the end) is what makes that bearable. Same rule as TextMap.kt on the phone.
export function mapCursor(oldText, newText, pos) {
  const limit = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < limit && oldText[prefix] === newText[prefix]) prefix++;
  let suffix = 0;
  while (suffix < limit - prefix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) suffix++;
  if (pos <= prefix) return pos;
  if (pos >= oldText.length - suffix) return pos + (newText.length - oldText.length);
  return newText.length - suffix; // inside the part that was rewritten: put it after the new text
}
