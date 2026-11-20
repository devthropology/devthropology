export class IssueDeleted extends Error {
  constructor(num: number) {
    super(`Issue ${num} has been deleted`);
  }
}
