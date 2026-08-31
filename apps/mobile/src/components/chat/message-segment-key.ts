export function messageSegmentRenderKey(segment: { kind: "code" | "markdown" }, index: number) {
  return `${segment.kind}-${index}`;
}
