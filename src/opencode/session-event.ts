export type SessionEventLike = {
  type: string;
  properties?: unknown;
};

export function isTopLevelSessionCreated(event: SessionEventLike): boolean {
  if (event.type !== "session.created") {
    return false;
  }

  const parentID = (event.properties as { info?: { parentID?: string } } | undefined)?.info?.parentID;
  return !parentID;
}
