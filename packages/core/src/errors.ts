/** Thrown when plan input is missing or malformed. Safe to show to end users. */
export class JetLagInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JetLagInputError';
  }
}
