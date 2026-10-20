/** Annular pie slices share geometry between the live wheel and settings preview. */
export function radialSectorPath(angle: number, count: number): string {
  const half = 180 / Math.max(2, count) - 1.5;
  const point = (radius: number, degrees: number) => {
    const radians = degrees * Math.PI / 180;
    return `${(180 + Math.cos(radians) * radius).toFixed(3)} ${(180 + Math.sin(radians) * radius).toFixed(3)}`;
  };
  return `M ${point(180, angle - half)} A 180 180 0 0 1 ${point(180, angle + half)} L ${point(54, angle + half)} A 54 54 0 0 0 ${point(54, angle - half)} Z`;
}
