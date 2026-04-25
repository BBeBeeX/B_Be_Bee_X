import type { NetworkTransport, TransportRequest } from "./types"

export class FetchTransport implements NetworkTransport {
  async request(request: TransportRequest) {
    return fetch(request.url, {
      body: request.body,
      headers: request.headers,
      method: request.method,
      signal: request.signal,
    })
  }
}
