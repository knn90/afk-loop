import { loopMarker } from "./loop-rules.js";

interface Signed {
  readonly authorAssociation: string;
  readonly body: string;
}

const writeAccess = ["OWNER", "COLLABORATOR"];

export function hasWriteAccess(comment: Pick<Signed, "authorAssociation">): boolean {
  return writeAccess.includes(comment.authorAssociation);
}

export function isLoopComment(comment: Signed): boolean {
  return hasWriteAccess(comment) && comment.body.startsWith(loopMarker);
}
