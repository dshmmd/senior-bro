/** Error whose `status` is propagated to the HTTP response by the route handler. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
