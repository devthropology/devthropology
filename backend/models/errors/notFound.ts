export class NotFound extends Error {
  constructor(num: number, url: string) {
    super(`Entity ${num} not found for url ${url}`);
  }
}
