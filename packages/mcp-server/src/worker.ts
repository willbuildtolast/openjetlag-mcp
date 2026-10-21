// Cloudflare Workers entry point.
import { handleRequest } from './http.js';

export default {
  fetch(request: Request): Promise<Response> {
    return handleRequest(request);
  },
};
