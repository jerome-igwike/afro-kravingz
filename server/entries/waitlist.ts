import type { IncomingMessage, ServerResponse } from "node:http";
import { handleWaitlistRequest } from "../bookingHttp";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return handleWaitlistRequest(req, res);
}
