import type { IncomingMessage, ServerResponse } from "node:http";
import { handleAdminActionRequest } from "../../server/bookingHttp";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return handleAdminActionRequest(req, res);
}
