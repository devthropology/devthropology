export class IssueMoved extends Error {
  constructor(num: number) {
    super(`Issue ${num} has been moved`);
  }
}
