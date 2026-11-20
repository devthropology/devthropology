export function getNiceStepSize(maxValue: number, range: number) {
  if (maxValue <= 1) return 0.1;
  if (maxValue <= 2) return 0.25;
  if (maxValue <= 5) return 0.5;
  if (maxValue <= 20) return 1;
  if (maxValue <= 60) return 5;
  if (maxValue <= 150) return 10;
  if (maxValue <= 300) return 25;
  if (maxValue <= 600) return 50;
  if (range <= 200) return 25;
  if (range <= 500) return 50;
  return 100;
}

export function getBufferedBounds(
  minValue: number,
  maxValue: number,
  stepSize: number,
  floorAtZero = true,
) {
  const minStep = Math.floor(minValue / stepSize) - 1;
  const maxStep = Math.ceil(maxValue / stepSize) + 1;

  return {
    min: floorAtZero ? Math.max(0, minStep * stepSize) : minStep * stepSize,
    max: maxStep * stepSize,
    stepSize,
  };
}
