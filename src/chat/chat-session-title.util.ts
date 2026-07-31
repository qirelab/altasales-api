const SESSION_TITLE_MAX_LENGTH = 60;

// Auto-title helper for platform sessions. Called from both the non-streaming
// (ChatService.sendPlatformMessage) and streaming (ChatStreamingService.runStream)
// paths so a client's very first message becomes the sidebar entry regardless
// of which endpoint they hit.
export function derivePlatformSessionTitle(text: string): string | null {
  const collapsed = text.trim().replace(/\s+/g, ' ');
  if (!collapsed) return null;
  if (collapsed.length <= SESSION_TITLE_MAX_LENGTH) return collapsed;
  return `${collapsed.slice(0, SESSION_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}
