import type http from 'node:http'
import { ProxyAgent } from 'proxy-agent'

type RequestOptions = {
  timeout?: number
  timeoutErrorMessage?: string
  transitional?: { clarifyTimeoutError?: boolean }
}

/** What https-proxy-agent reports for the proxy's answer to CONNECT. */
type ProxyConnectResponse = { statusCode: number; statusText?: string; headers?: http.IncomingHttpHeaders }

/** Axios starts its socket timeout only after the agent finishes CONNECT.
 * Bound that pending handshake too, and give its socket a request-local signal. */
export class FeishuProxyAgent extends ProxyAgent {
  timeoutError?: Error & { code: string }
  /**
   * The proxy's answer when it refused CONNECT (407 and the like).
   * https-proxy-agent replays that answer onto a stand-in socket so Axios can
   * read it; Bun on Windows closes that socket first, so the request fails with
   * "Socket is closed" and the status is lost. The client puts it back.
   */
  proxyRefusal?: ProxyConnectResponse

  constructor(private requestOptions: RequestOptions, private controller: AbortController) {
    super({ signal: controller.signal })
  }

  async connect(request: http.ClientRequest, options: Parameters<ProxyAgent['connect']>[1]): Promise<http.Agent> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onProxyConnect = (response: ProxyConnectResponse) => {
      if (response.statusCode !== 200) this.proxyRefusal = response
    }
    // Emitted on the request by the inner proxy agent, before the socket.
    request.once('proxyConnect', onProxyConnect)
    const cleanup = () => {
      clearTimeout(timer)
      request.removeListener('socket', cleanup)
      request.removeListener('error', cleanup)
      request.removeListener('close', cancel)
      request.removeListener('proxyConnect', onProxyConnect)
    }
    const cancel = () => {
      cleanup()
      this.controller.abort()
    }
    request.once('socket', cleanup)
    request.once('error', cleanup)
    request.once('close', cancel)
    const timeout = Number(this.requestOptions.timeout)
    if (Number.isFinite(timeout) && timeout > 0) {
      timer = setTimeout(() => {
        this.timeoutError = Object.assign(new Error(
          this.requestOptions.timeoutErrorMessage ?? `timeout of ${timeout}ms exceeded`,
        ), {
          code: this.requestOptions.transitional?.clarifyTimeoutError ? 'ETIMEDOUT' : 'ECONNABORTED',
        })
        request.destroy(this.timeoutError)
        this.controller.abort(this.timeoutError)
        cleanup()
      }, timeout)
    }
    try {
      return await super.connect(request, options)
    } catch (error) {
      cleanup()
      throw error
    }
  }
}
