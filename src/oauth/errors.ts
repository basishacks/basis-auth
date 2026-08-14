import { APIResponse } from "../api.js";

export class APIError extends Error implements APIResponse {
  /**
   *
   * @param error Machine readable namespaced error
   * @param message Human readable descriptive error
   * @param status HTTP Request Status Code (Assertion should match the error type)
   * @param code Machine readable integer code
   */
  constructor(
    public readonly error: string,
    message: string,
    public readonly status = 400,
    readonly code = status
  ) {
    super(message);
    this.name = new.target.name;
  }

  toJSON() {
    return {
      status: this.status,
      error: this.error,
      code: this.code,
      error_description: this.message,
    };
  }
}

export class OAuthError extends APIError {}
