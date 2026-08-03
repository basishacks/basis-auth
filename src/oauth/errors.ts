export class OAuthError extends Error {
  constructor(
    public readonly error: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }

  toJSON() {
    return { error: this.error, error_description: this.message };
  }
}
