export class ServiceUnavailableError extends Error {
  constructor(readonly originalError: unknown) {
    super("Authentication service unavailable");
    this.name = "ServiceUnavailableError";
  }
}
