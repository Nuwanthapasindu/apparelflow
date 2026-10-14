// Pure functions: no database, no framework. Shared by the server and the order modal preview.

/** Expected pieces of one component for a batch: pieces per garment x garments in the batch. */
export function expectedQty(piecesPerGarment: number, targetQty: number): number {
  return piecesPerGarment * targetQty;
}

export function expectedCounts<T extends { piecesPerGarment: number }>(
  components: readonly T[],
  targetQty: number,
): (T & { expectedQty: number })[] {
  return components.map((c) => ({ ...c, expectedQty: expectedQty(c.piecesPerGarment, targetQty) }));
}
