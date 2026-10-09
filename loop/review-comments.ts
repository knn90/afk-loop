import { handedOff, loopMarker } from "./loop-rules.js";

const writeAccess = ["OWNER", "COLLABORATOR"];

export function hasWriteAccess(comment: { readonly authorAssociation: string }): boolean {
  return writeAccess.includes(comment.authorAssociation);
}

export function isLoopComment(comment: { readonly body: string }): boolean {
  return comment.body.startsWith(loopMarker) || comment.body.startsWith(handedOff);
}
