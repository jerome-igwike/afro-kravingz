import type { IncomingMessage, ServerResponse } from "node:http";
import { handleAdminOrdersRequest } from "../bookingHttp";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return handleAdminOrdersRequest(req, res);
}
