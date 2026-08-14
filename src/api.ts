/**
 * Base class for every HTTP API response.
 *
 * All API responses must be built from an APIResponse (directly or via a
 * subclass) so that every serialized payload is guaranteed to carry a
 * machine-readable `status`.
 */
export class APIResponse {
  constructor(public readonly status: number = 200) {}

  toJSON(): { status: number } {
    return { status: this.status };
  }
}
