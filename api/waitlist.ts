import type { IncomingMessage, ServerResponse } from "node:http";
import { handleWaitlistRequest } from "../server/bookingHttp";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return handleWaitlistRequest(req, res);
}
